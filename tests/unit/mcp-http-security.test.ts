import assert from "node:assert/strict";
import { test } from "node:test";

import { createApp } from "../../services/api/src/app.ts";
import { createApiRuntimeDependencies } from "../../services/api/src/runtime.ts";

function createTestApp(options: { jwksUrl?: string } = {}) {
  const deps = createApiRuntimeDependencies({
    port: 0,
    runtimeMode: "demo",
    allowTestReset: false,
    corsPolicy: { kind: "allowlist", origins: ["http://localhost:3002"] },
    azureOpenAi: {},
    database: { poolMode: "direct", poolMax: 10 },
    azureStorage: {},
    azureDocumentIntelligence: {},
    auth: { jwksUrl: options.jwksUrl },
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

const initializeBody = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1.0.0" },
  },
});

const allowedHeaders = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  origin: "http://localhost:3002",
  host: "localhost",
};

test("POST /api/mcp rejects disallowed Origin", async () => {
  const response = await createTestApp().request("http://localhost/api/mcp", {
    method: "POST",
    headers: { ...allowedHeaders, origin: "http://evil.example" },
    body: initializeBody,
  });

  assert.equal(response.status, 403);
  assert.equal(((await response.json()) as { code: string }).code, "mcp_origin_forbidden");
});

test("POST /api/mcp rejects Host not on allowlist (DNS rebinding)", async () => {
  const response = await createTestApp().request("http://evil.example/api/mcp", {
    method: "POST",
    headers: { ...allowedHeaders, host: "evil.example" },
    body: initializeBody,
  });

  assert.equal(response.status, 403);
  assert.equal(((await response.json()) as { code: string }).code, "mcp_host_forbidden");
});

test("GET /api/mcp applies the same Origin and Host guards", async () => {
  const app = createTestApp();
  const forbiddenOrigin = await app.request("http://localhost/api/mcp", {
    headers: { origin: "http://evil.example", host: "localhost", "Mcp-Session-Id": "session" },
  });
  assert.equal(forbiddenOrigin.status, 403);
  assert.equal(((await forbiddenOrigin.json()) as { code: string }).code, "mcp_origin_forbidden");

  const forbiddenHost = await app.request("http://evil.example/api/mcp", {
    headers: { origin: "http://localhost:3002", host: "evil.example", "Mcp-Session-Id": "session" },
  });
  assert.equal(forbiddenHost.status, 403);
  assert.equal(((await forbiddenHost.json()) as { code: string }).code, "mcp_host_forbidden");
});

test("POST /api/mcp requires JWT when JWKS configured", async () => {
  const response = await createTestApp({ jwksUrl: "https://project.supabase.test/auth/v1/keys" }).request(
    "http://localhost/api/mcp",
    {
      method: "POST",
      headers: allowedHeaders,
      body: initializeBody,
    },
  );

  assert.equal(response.status, 401);
  assert.match(((await response.json()) as { error: string }).error, /authorization|token/i);
});

test("POST /api/mcp uses the existing mutation limiter", async () => {
  const app = createTestApp();
  let response: Response | undefined;
  for (let index = 0; index < 61; index += 1) {
    response = await app.request("http://localhost/api/mcp", {
      method: "POST",
      headers: allowedHeaders,
      body: initializeBody,
    });
  }

  assert.ok(response);
  assert.equal(response.status, 429);
  assert.equal(((await response.json()) as { error: string }).error, "Too many requests.");
});

test("RFC 9728 protected-resource metadata is served", async () => {
  const response = await createTestApp().request("http://localhost/.well-known/oauth-protected-resource");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    resource: "http://localhost/api/mcp",
    authorization_servers: ["https://project.supabase.test/auth/v1"],
    bearer_methods_supported: ["header"],
  });
});

test("/ready checks unchanged (ledger/ai/blob/docintel) — not an auth probe", async () => {
  const response = await createTestApp().request("http://localhost/ready");

  assert.equal(response.status, 200);
  const body = (await response.json()) as { checks: Record<string, boolean> };
  assert.deepEqual(Object.keys(body.checks).sort(), ["ai", "blob", "docintel", "ledger"]);
});
