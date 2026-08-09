import assert from "node:assert/strict";
import { test } from "node:test";

import { createMcpServer, createMcpServerFromEnv } from "../../packages/mcp-server/src/server.ts";
import { MCP_TOOL_NAMES } from "../../packages/mcp-server/src/tools/index.ts";

test("MCP server registers the complete fixed tool surface", () => {
  const server = createMcpServer({} as never);
  const registeredTools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;

  assert.deepEqual(Object.keys(registeredTools).sort(), [...MCP_TOOL_NAMES].sort());
});

test("MCP server construction fails closed before registration without required environment", () => {
  assert.throws(() => createMcpServerFromEnv({ JPX_MCP_BEARER_TOKEN: "token" }), /ACCOUNTING_API_BASE_URL/);
  assert.throws(
    () => createMcpServerFromEnv({ ACCOUNTING_API_BASE_URL: "https://api.example" }),
    /JPX_MCP_BEARER_TOKEN/,
  );
});
