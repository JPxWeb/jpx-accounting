import { getWebServerRuntimeConfig } from "../../../lib/server-runtime-config";

/**
 * Reverse proxy to the Accounting API for same-origin browser calls (`/api-proxy/...`).
 * Target base URL comes from `ACCOUNTING_API_BASE_URL` (see `apps/web/lib/server-runtime-config.ts` and docs/CONTRIBUTING.md).
 * Strips hop-by-hop headers; forwards a small allowlist only.
 */

const responseHeaders = new Set([
  "content-type",
  "content-disposition",
  "cache-control",
  // AI SDK UI-message stream marker (advisor chat SSE) — clients sniff this
  // to pick the stream protocol, so the proxy must not strip it.
  "x-vercel-ai-ui-message-stream",
]);

const requestHeaders = ["accept", "authorization", "content-type", "x-request-id"] as const;

function getApiBaseUrl() {
  return getWebServerRuntimeConfig().apiBaseUrl;
}

async function proxyRequest(request: Request, path: string[]) {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    const { runtimeMode } = getWebServerRuntimeConfig();
    return Response.json(
      {
        error: "Accounting API base URL is not configured for the proxy route.",
        runtimeMode,
      },
      { status: 503 },
    );
  }

  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(`${baseUrl.replace(/\/$/, "")}/${path.join("/")}${incomingUrl.search}`);
  const headers = new Headers();
  for (const header of requestHeaders) {
    const value = request.headers.get(header);
    if (value) {
      headers.set(header, value);
    }
  }
  const init: RequestInit = {
    method: request.method,
    headers,
    cache: "no-store",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  const response = await fetch(targetUrl, init);

  const nextHeaders = new Headers();
  for (const [key, value] of response.headers.entries()) {
    if (responseHeaders.has(key.toLowerCase())) {
      nextHeaders.set(key, value);
    }
  }

  // Stream the upstream body through unbuffered (finding 1): SSE responses
  // (advisor chat) would hang behind an arrayBuffer() drain, and streaming is
  // byte-identical for every buffered JSON route.
  return new Response(response.body, {
    status: response.status,
    headers: nextHeaders,
  });
}

async function handler(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxyRequest(request, path);
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
