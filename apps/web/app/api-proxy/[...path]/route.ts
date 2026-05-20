import { getWebServerRuntimeConfig } from "../../../lib/server-runtime-config";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

const responseHeaders = new Set(["content-type", "content-disposition", "cache-control"]);

const requestHeaders = ["accept", "authorization", "content-type", "x-request-id"] as const;

function getApiBaseUrl() {
  return getWebServerRuntimeConfig().apiBaseUrl;
}

async function proxyRequest(request: Request, path: string[]) {
  // The browser talks to this same-origin route so API targeting stays runtime-configurable
  // in Azure and during e2e runs. In normal mode it attaches the Supabase access token; the
  // Hono API then re-verifies that token (getClaims). The double validation is intentional and
  // accepted: it keeps the browser from ever holding an API-trusted credential directly.
  const { runtimeMode } = getWebServerRuntimeConfig();
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
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

  if (runtimeMode === "normal") {
    try {
      const supabase = await createSupabaseServerClient();
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) {
        return Response.json({ error: "Authentication required" }, { status: 401 });
      }
      headers.set("authorization", `Bearer ${accessToken}`);
    } catch {
      return Response.json({ error: "Supabase auth is not configured" }, { status: 503 });
    }
  }

  for (const header of requestHeaders) {
    if (header === "authorization" && headers.has("authorization")) continue;
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

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxyRequest(request, path);
}

export async function POST(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxyRequest(request, path);
}

export async function PUT(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxyRequest(request, path);
}
