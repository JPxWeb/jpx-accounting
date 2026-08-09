import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createMcpHttpAdapter, createMcpHttpSessionStore } from "../../packages/mcp-server/src/http-adapter.ts";
import { createMcpHttpToolHandlers } from "../../packages/mcp-server/src/http-tools.ts";
import { MCP_TOOL_NAMES } from "../../packages/mcp-server/src/tools/index.ts";

const initializeRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1.0.0" },
  },
};

function request(body: unknown, sessionId?: string) {
  return new Request("http://localhost:3001/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      origin: "http://localhost:3002",
      ...(sessionId === undefined ? {} : { "Mcp-Session-Id": sessionId }),
    },
    body: JSON.stringify(body),
  });
}

function adapter(options: { ttlMs?: number; now?: () => number } = {}) {
  return createMcpHttpAdapter({
    sessions: createMcpHttpSessionStore({
      ttlMs: options.ttlMs ?? 60_000,
      ...(options.now === undefined ? {} : { now: options.now }),
    }),
    allowedOrigins: ["http://localhost:3002"],
    allowedHosts: ["localhost:3001"],
    resourceUrl: "http://localhost:3001/api/mcp",
    authorizationServers: ["https://project.supabase.test/auth/v1"],
    toolHandlers: {
      list: async () => [
        { name: "list_reviews", description: "List pending reviews.", inputSchema: { type: "object" } },
      ],
      call: async (name, input) => ({ content: [{ type: "text", text: JSON.stringify({ name, input }) }] }),
    },
  });
}

test("POST initialize issues Mcp-Session-Id", async () => {
  const response = await adapter().handlePost(request(initializeRequest));

  assert.equal(response.status, 200);
  assert.ok(response.headers.get("Mcp-Session-Id"));
  const body = (await response.json()) as {
    jsonrpc: string;
    id: number;
    result: { protocolVersion: string };
  };
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.id, 1);
  assert.equal(body.result.protocolVersion, "2025-06-18");
});

test("session-bound tools/list is returned and buffered for SSE replay", async () => {
  const http = adapter();
  const initialized = await http.handlePost(request(initializeRequest));
  const sessionId = initialized.headers.get("Mcp-Session-Id");
  assert.ok(sessionId);

  const tools = await http.handlePost(request({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, sessionId));
  assert.equal(tools.status, 200);
  const toolsBody = (await tools.json()) as { result: { tools: Array<{ name: string }> } };
  assert.deepEqual(
    toolsBody.result.tools.map((tool) => tool.name),
    ["list_reviews"],
  );

  const stream = http.handleGet(
    new Request("http://localhost:3001/api/mcp", {
      headers: {
        accept: "text/event-stream",
        origin: "http://localhost:3002",
        "Mcp-Session-Id": sessionId,
        "Last-Event-ID": "0",
      },
    }),
  );
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get("content-type") ?? "", /^text\/event-stream/);
  assert.equal(stream.headers.get("Mcp-Session-Id"), sessionId);
  const reader = stream.body?.getReader();
  assert.ok(reader);
  const first = await reader.read();
  assert.equal(first.done, false);
  const frame = new TextDecoder().decode(first.value);
  assert.match(frame, /^id: 1$/m);
  assert.match(frame, /list_reviews/);
  await reader.cancel();
});

test("GET without Mcp-Session-Id is 400", async () => {
  const response = adapter().handleGet(
    new Request("http://localhost:3001/api/mcp", {
      headers: { accept: "text/event-stream", origin: "http://localhost:3002" },
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    code: "mcp_session_required",
    error: "Mcp-Session-Id is required.",
  });
});

test("expired sessions fail closed", async () => {
  let now = 1_000;
  const http = adapter({ ttlMs: 10, now: () => now });
  const initialized = await http.handlePost(request(initializeRequest));
  const sessionId = initialized.headers.get("Mcp-Session-Id");
  assert.ok(sessionId);
  now += 11;

  const response = await http.handlePost(
    request({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, sessionId),
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    code: "mcp_session_not_found",
    error: "MCP session was not found or has expired.",
  });
});

test("invalid JSON-RPC and unsupported methods return protocol errors", async () => {
  const http = adapter();
  const invalid = await http.handlePost(request({ jsonrpc: "1.0", id: 1, method: "initialize" }));
  assert.equal(((await invalid.json()) as { error: { code: number } }).error.code, -32600);

  const initialized = await http.handlePost(request(initializeRequest));
  const sessionId = initialized.headers.get("Mcp-Session-Id");
  assert.ok(sessionId);
  const unsupported = await http.handlePost(
    request({ jsonrpc: "2.0", id: 3, method: "approve_review", params: {} }, sessionId),
  );
  assert.equal(((await unsupported.json()) as { error: { code: number } }).error.code, -32601);
});

test("v1 does not register DELETE handler", () => {
  const source = readFileSync("services/api/src/routes/mcp-http.ts", "utf8");
  assert.equal(/\bapp\.delete\s*\(\s*["'`]\/api\/mcp/.test(source), false);
});

test("HTTP exposes the same fixed proposal/read tool inventory as stdio", async () => {
  const handlers = createMcpHttpToolHandlers(() => {
    throw new Error("tools/list must not construct an API client");
  });

  const listed = await handlers.list();
  assert.deepEqual(
    listed.map((tool) => tool.name),
    [...MCP_TOOL_NAMES],
  );
  assert.equal(
    listed.some((tool) => /approve|confirm|post/.test(tool.name)),
    false,
  );
});

test("concurrent session requests are buffered in arrival order", async () => {
  let releaseFirst!: () => void;
  const firstCanFinish = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const http = createMcpHttpAdapter({
    sessions: createMcpHttpSessionStore({ ttlMs: 60_000 }),
    allowedOrigins: ["http://localhost:3002"],
    allowedHosts: ["localhost:3001"],
    resourceUrl: "http://localhost:3001/api/mcp",
    authorizationServers: [],
    toolHandlers: {
      list: async () => [],
      call: async () => {
        await firstCanFinish;
        return { content: [] };
      },
    },
  });
  const initialized = await http.handlePost(request(initializeRequest));
  const sessionId = initialized.headers.get("Mcp-Session-Id");
  assert.ok(sessionId);

  const first = http.handlePost(
    request(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_reviews", arguments: {} } },
      sessionId,
    ),
  );
  const second = http.handlePost(request({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} }, sessionId));
  await new Promise((resolve) => setTimeout(resolve, 0));
  releaseFirst();
  await Promise.all([first, second]);

  const stream = http.handleGet(
    new Request("http://localhost:3001/api/mcp", {
      headers: { "Mcp-Session-Id": sessionId, "Last-Event-ID": "0" },
    }),
  );
  const reader = stream.body?.getReader();
  assert.ok(reader);
  const firstFrame = new TextDecoder().decode((await reader.read()).value);
  const secondFrame = new TextDecoder().decode((await reader.read()).value);
  assert.match(firstFrame, /"method":"tools\/call"/);
  assert.match(secondFrame, /"method":"tools\/list"/);
  await reader.cancel();
});
