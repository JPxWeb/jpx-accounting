import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../../services/api/src/app";
import { createApiRuntimeDependencies } from "../../services/api/src/runtime";

function createTestApiApp(runtimeMode: "demo" | "normal") {
  const corsPolicy =
    runtimeMode === "demo"
      ? { kind: "wildcard" as const }
      : ({ kind: "allowlist", origins: ["http://localhost:3002"] } as const);

  const dependencies = createApiRuntimeDependencies({
    port: 0,
    runtimeMode,
    allowTestReset: false,
    corsPolicy,
    azureOpenAi: {},
    supabase: { poolerTransactionMode: false },
    azureStorage: {},
    azureDocumentIntelligence: {},
    auth: {},
  });

  return createApp({ ...dependencies, allowTestReset: false });
}

test("demo runtime exposes the seeded workspace", async () => {
  const app = createTestApiApp("demo");

  const response = await app.request("http://localhost/api/workspace");
  assert.equal(response.status, 200);

  const payload = (await response.json()) as { reviews: unknown[] };
  assert.equal(payload.reviews.length, 1);

  const ready = await app.request("http://localhost/ready");
  assert.equal(ready.status, 200);
  const readyBody = (await ready.json()) as { ready: boolean; checks: { ledger: boolean; ai: boolean } };
  assert.equal(readyBody.ready, true);
  assert.equal(readyBody.checks.ledger, true);
  assert.equal(readyBody.checks.ai, true);
});

test("normal runtime fails closed instead of returning demo data", async () => {
  const app = createTestApiApp("normal");

  const workspace = await app.request("http://localhost/api/workspace");
  assert.equal(workspace.status, 503);
  const wsBody = (await workspace.json()) as { error: string; requestId: string; runtimeMode: string };
  assert.match(wsBody.error, /unavailable/i);
  assert.ok(typeof wsBody.requestId === "string" && wsBody.requestId.length > 0);

  const health = await app.request("http://localhost/health");
  assert.equal(health.status, 200);
  assert.match(await health.text(), /normal/);

  const ready = await app.request("http://localhost/ready");
  assert.equal(ready.status, 200);
  const readyBody = (await ready.json()) as { ready: boolean; checks: { ledger: boolean; ai: boolean } };
  assert.equal(readyBody.ready, false);
  assert.equal(readyBody.checks.ledger, false);
  assert.equal(readyBody.checks.ai, false);
});

test("JSON validation failures return structured issues and requestId", async () => {
  const app = createTestApiApp("demo");

  const response = await app.request("http://localhost/api/evidence", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": "test-fixture-id",
    },
    body: "{}",
  });

  assert.equal(response.status, 400);
  assert.equal(response.headers.get("x-request-id"), "test-fixture-id");
  const body = (await response.json()) as {
    code: string;
    issues: unknown[];
    requestId: string;
    error: string;
  };
  assert.equal(body.code, "validation_error");
  assert.ok(Array.isArray(body.issues) && body.issues.length > 0);
  assert.equal(body.requestId, "test-fixture-id");
});
