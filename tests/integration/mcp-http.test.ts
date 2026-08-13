import assert from "node:assert/strict";
import { test } from "node:test";

import { createApp } from "../../services/api/src/app";
import { createApiRuntimeDependencies } from "../../services/api/src/runtime";

function createTestApiApp() {
  const deps = createApiRuntimeDependencies({
    port: 0,
    runtimeMode: "demo",
    allowTestReset: false,
    corsPolicy: { kind: "allowlist", origins: ["http://localhost:3002"] },
    azureOpenAi: {},
    database: { poolMode: "direct", poolMax: 10 },
    azureStorage: {},
    azureDocumentIntelligence: {},
    auth: {},
    advisor: { toolApprovalSecret: "test-secret", maxOutputTokens: 2048, streamTimeoutMs: 90_000 },
    mcp: {
      allowedHosts: ["localhost"],
      resourceUrl: "http://localhost/api/mcp",
      authorizationServers: ["https://project.supabase.test/auth/v1"],
      sessionTtlMs: 60_000,
    },
  });
  return createApp({ ...deps, allowTestReset: false });
}

const commonHeaders = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  origin: "http://localhost:3002",
  host: "localhost",
};

async function initializeSession(app: ReturnType<typeof createTestApiApp>) {
  const response = await app.request("http://localhost/api/mcp", {
    method: "POST",
    headers: commonHeaders,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "integration", version: "1.0.0" },
      },
    }),
  });
  assert.equal(response.status, 200);
  const sessionId = response.headers.get("Mcp-Session-Id");
  assert.ok(sessionId);
  return sessionId;
}

test("MCP HTTP session SSE resumes with Last-Event-ID", async () => {
  const app = createTestApiApp();
  const sessionId = await initializeSession(app);

  const tools = await app.request("http://localhost/api/mcp", {
    method: "POST",
    headers: { ...commonHeaders, "Mcp-Session-Id": sessionId },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  });
  assert.equal(tools.status, 200);
  const toolsBody = (await tools.json()) as { result: { tools: Array<{ name: string }> } };
  assert.equal(toolsBody.result.tools.length, 13);
  assert.ok(toolsBody.result.tools.some((tool) => tool.name === "submit_enrichment_proposal"));
  assert.equal(
    toolsBody.result.tools.some((tool) => /approve|confirm|post/.test(tool.name)),
    false,
  );

  const stream = await app.request("http://localhost/api/mcp", {
    headers: {
      accept: "text/event-stream",
      origin: "http://localhost:3002",
      host: "localhost",
      "Mcp-Session-Id": sessionId,
      "Last-Event-ID": "0",
    },
  });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get("content-type") ?? "", /^text\/event-stream/);
  assert.equal(stream.headers.get("Mcp-Session-Id"), sessionId);
  const reader = stream.body?.getReader();
  assert.ok(reader);
  const first = await reader.read();
  assert.equal(first.done, false);
  const frame = new TextDecoder().decode(first.value);
  assert.match(frame, /^id: 1$/m);
  assert.match(frame, /^event: message$/m);
  assert.match(frame, /"method":"tools\/list"/);
  await reader.cancel();

  const resumed = await app.request("http://localhost/api/mcp", {
    headers: {
      accept: "text/event-stream",
      origin: "http://localhost:3002",
      host: "localhost",
      "Mcp-Session-Id": sessionId,
      "Last-Event-ID": "1",
    },
  });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.headers.get("Mcp-Session-Id"), sessionId);
  await resumed.body?.cancel();
});

test("open session SSE receives events appended after connection", async () => {
  const app = createTestApiApp();
  const sessionId = await initializeSession(app);
  const stream = await app.request("http://localhost/api/mcp", {
    headers: {
      accept: "text/event-stream",
      origin: "http://localhost:3002",
      host: "localhost",
      "Mcp-Session-Id": sessionId,
      "Last-Event-ID": "0",
    },
  });
  const reader = stream.body?.getReader();
  assert.ok(reader);

  const nextFrame = reader.read();
  const tools = await app.request("http://localhost/api/mcp", {
    method: "POST",
    headers: { ...commonHeaders, "Mcp-Session-Id": sessionId },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  });
  assert.equal(tools.status, 200);

  const first = await Promise.race([
    nextFrame,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("live SSE event timed out")), 100)),
  ]);
  assert.equal(first.done, false);
  assert.match(new TextDecoder().decode(first.value), /"method":"tools\/list"/);
  await reader.cancel();
});
