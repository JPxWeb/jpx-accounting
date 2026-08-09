import type { Hono } from "hono";

import type { McpHttpAdapter } from "@jpx-accounting/mcp-server/http-adapter";

import type { ApiRouteEnv } from "../route-types";

function validateMcpRequest(
  request: Request,
  allowedOrigins: ReadonlySet<string>,
  allowedHosts: ReadonlySet<string>,
): Response | undefined {
  const origin = request.headers.get("origin");
  if (origin === null || !allowedOrigins.has(origin)) {
    return Response.json({ code: "mcp_origin_forbidden", error: "Origin is not allowed." }, { status: 403 });
  }

  const host = request.headers.get("host")?.toLowerCase();
  if (host === undefined || !allowedHosts.has(host)) {
    return Response.json({ code: "mcp_host_forbidden", error: "Host is not allowed." }, { status: 403 });
  }
}

export function registerMcpHttpRoutes(app: Hono<ApiRouteEnv>, adapter: McpHttpAdapter) {
  app.get("/.well-known/oauth-protected-resource", (context) =>
    context.json({
      resource: adapter.resourceUrl,
      authorization_servers: adapter.authorizationServers,
      bearer_methods_supported: ["header"],
    }),
  );

  app.post("/api/mcp", (context) => {
    const forbidden = validateMcpRequest(context.req.raw, adapter.allowedOrigins, adapter.allowedHosts);
    return forbidden ?? adapter.handlePost(context.req.raw);
  });
  app.get("/api/mcp", (context) => {
    const forbidden = validateMcpRequest(context.req.raw, adapter.allowedOrigins, adapter.allowedHosts);
    return forbidden ?? adapter.handleGet(context.req.raw);
  });
}
