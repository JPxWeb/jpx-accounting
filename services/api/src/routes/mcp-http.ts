import type { Hono } from "hono";

import type { McpHttpAdapter } from "@jpx-accounting/mcp-server/http-adapter";

import type { ApiRouteEnv } from "../route-types";

export function registerMcpHttpRoutes(app: Hono<ApiRouteEnv>, adapter: McpHttpAdapter) {
  app.post("/api/mcp", (context) => adapter.handlePost(context.req.raw));
  app.get("/api/mcp", (context) => adapter.handleGet(context.req.raw));
}
