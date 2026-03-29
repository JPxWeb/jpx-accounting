import { getWebServerRuntimeConfig } from "../../../lib/server-runtime-config";

const responseHeaders = new Set(["content-type", "content-disposition", "cache-control"]);

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

  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: nextHeaders,
  });
}

// The browser talks to a same-origin route so API targeting stays runtime-configurable in Azure and during e2e runs.
export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxyRequest(request, path);
}

export async function POST(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxyRequest(request, path);
}
