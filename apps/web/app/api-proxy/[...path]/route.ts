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

/** Cap on proxied request bodies; the API's own upload limit is 16 MB. */
const MAX_PROXY_BODY_BYTES = 25 * 1024 * 1024;

/**
 * The proxy exposes strictly the upstream's `/api/*` surface. Next decodes
 * percent-encodings per segment (`%2e%2e` → `..`, `%2F` → `/`), and WHATWG
 * `new URL(...)` both treats `\` as `/` and normalizes dot segments — so any
 * of these could otherwise reassemble into upstream paths outside `/api/*`
 * (`/health`, `/ready`, anything else the Hono server serves).
 */
function isProxyablePath(path: string[]): boolean {
  if (path[0] !== "api") {
    return false;
  }
  return path.every(
    (segment) =>
      segment.length > 0 && segment !== "." && segment !== ".." && !segment.includes("/") && !segment.includes("\\"),
  );
}

function getApiBaseUrl() {
  return getWebServerRuntimeConfig().apiBaseUrl;
}

async function proxyRequest(request: Request, path: string[]) {
  if (!isProxyablePath(path)) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > MAX_PROXY_BODY_BYTES) {
    return Response.json({ error: "Request body too large." }, { status: 413 });
  }

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
  // Belt and braces: whatever the segments contained, the normalized upstream
  // path must still live under /api/.
  const upstreamApiRoot = `${new URL(baseUrl).pathname.replace(/\/$/, "")}/api`;
  if (targetUrl.pathname !== upstreamApiRoot && !targetUrl.pathname.startsWith(`${upstreamApiRoot}/`)) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
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
    const body = await request.arrayBuffer();
    // Re-check after buffering: chunked requests carry no content-length header.
    if (body.byteLength > MAX_PROXY_BODY_BYTES) {
      return Response.json({ error: "Request body too large." }, { status: 413 });
    }
    init.body = body;
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
