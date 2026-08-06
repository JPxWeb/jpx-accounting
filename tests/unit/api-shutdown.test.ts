import assert from "node:assert/strict";
import test from "node:test";

import { registerGracefulShutdown } from "../../services/api/src/shutdown";

type FakeProc = {
  once: (signal: string, fn: () => void) => void;
  exit: (code: number) => void;
};

function createFakeProc(): { proc: FakeProc; exits: number[]; handlers: Map<string, () => void> } {
  const exits: number[] = [];
  const handlers = new Map<string, () => void>();
  const proc: FakeProc = {
    once: (signal, fn) => handlers.set(signal, fn),
    exit: (code) => exits.push(code),
  };
  return { proc, exits, handlers };
}

test("shutdown drains server then database then exits 0", async () => {
  const order: string[] = [];
  let serverClosed = false;
  let idleClosed = false;
  const server = {
    close: (cb?: (err?: Error) => void) => {
      order.push("server.close");
      serverClosed = true;
      cb?.();
    },
    closeIdleConnections: () => {
      order.push("closeIdleConnections");
      idleClosed = true;
    },
  };
  const closeDatabase = async () => {
    order.push("closeDatabase");
  };
  const { proc, exits } = createFakeProc();

  const shutdown = registerGracefulShutdown({ server, closeDatabase, proc, watchdogMs: 60_000 });
  await shutdown("SIGTERM");

  assert.equal(serverClosed, true);
  assert.equal(idleClosed, true);
  assert.deepEqual(order, ["server.close", "closeIdleConnections", "closeDatabase"]);
  assert.deepEqual(exits, [0]);
});

test("shutdown is idempotent — closeDatabase runs once", async () => {
  let closeCount = 0;
  const server = {
    close: (cb?: (err?: Error) => void) => cb?.(),
  };
  const closeDatabase = async () => {
    closeCount += 1;
  };
  const { proc, exits } = createFakeProc();

  const shutdown = registerGracefulShutdown({ server, closeDatabase, proc, watchdogMs: 60_000 });
  await shutdown("SIGINT");
  await shutdown("SIGINT");

  assert.equal(closeCount, 1);
  assert.deepEqual(exits, [0]);
});

test("closeDatabase rejection still exits 0 and logs error", async () => {
  const server = {
    close: (cb?: (err?: Error) => void) => cb?.(),
  };
  const closeDatabase = async () => {
    throw new Error("pool drain failed");
  };
  const { proc, exits } = createFakeProc();

  const originalError = console.error;
  const errorLines: string[] = [];
  console.error = (...args: unknown[]) => {
    errorLines.push(String(args[0]));
  };
  try {
    const shutdown = registerGracefulShutdown({ server, closeDatabase, proc, watchdogMs: 60_000 });
    await shutdown("SIGTERM");
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(exits, [0]);
  assert.equal(errorLines.length, 1);
  const parsed = JSON.parse(errorLines[0]!) as { level: string; component: string; message: string };
  assert.equal(parsed.level, "error");
  assert.equal(parsed.component, "api.shutdown");
  assert.equal(parsed.message, "pool drain failed");
});

test("registers SIGTERM and SIGINT handlers on proc", () => {
  const server = { close: (cb?: (err?: Error) => void) => cb?.() };
  const { proc, handlers } = createFakeProc();

  registerGracefulShutdown({ server, closeDatabase: async () => {}, proc, watchdogMs: 60_000 });

  assert.ok(handlers.has("SIGTERM"));
  assert.ok(handlers.has("SIGINT"));
});
