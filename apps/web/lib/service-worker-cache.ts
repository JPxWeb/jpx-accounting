const cachePrefix = "jpx-accounting-static-";

export const staticAssetCacheName = `${cachePrefix}v2`;

const exactCacheablePaths = new Set(["/manifest.webmanifest", "/favicon.ico", "/apple-icon.png", "/icon.png"]);

type HeaderShape = Headers | Record<string, string | undefined>;

type RequestLike = {
  url: string;
  method?: string;
  mode?: string;
  destination?: string;
  headers?: HeaderShape;
  origin?: string;
};

type ResponseLike = {
  ok: boolean;
  headers?: HeaderShape;
};

function readHeader(headers: HeaderShape | undefined, name: string) {
  if (!headers) {
    return undefined;
  }

  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }

  return headers[name];
}

export function shouldCacheStaticAsset(request: RequestLike) {
  if ((request.method ?? "GET") !== "GET") {
    return false;
  }

  const url = new URL(request.url);
  const origin = request.origin ?? url.origin;
  const acceptHeader = readHeader(request.headers, "accept") ?? "";
  const authorizationHeader = readHeader(request.headers, "authorization");

  if (url.origin !== origin) {
    return false;
  }

  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/api-proxy/")) {
    return false;
  }

  if (request.mode === "navigate" || request.destination === "document" || acceptHeader.includes("text/html")) {
    return false;
  }

  if (authorizationHeader) {
    return false;
  }

  return url.pathname.startsWith("/_next/static/") || exactCacheablePaths.has(url.pathname);
}

export function shouldCacheStaticResponse(response: ResponseLike) {
  const cacheControl = readHeader(response.headers, "cache-control") ?? "";
  return response.ok && !/no-store|private/i.test(cacheControl);
}

export function getObsoleteStaticCaches(cacheNames: string[]) {
  return cacheNames.filter((cacheName) => cacheName.startsWith(cachePrefix) && cacheName !== staticAssetCacheName);
}
