// The cache version below is stamped with a git SHA at build time (see prebuild script).
const staticAssetCacheName = "jpx-accounting-static-__BUILD_HASH__";
const exactCacheablePaths = new Set(["/manifest.webmanifest", "/favicon.ico", "/apple-icon.png", "/icon.png"]);

function shouldCacheStaticAsset(request) {
  if (request.method !== "GET") {
    return false;
  }

  const url = new URL(request.url);
  const acceptHeader = request.headers.get("accept") ?? "";

  if (url.origin !== self.location.origin) {
    return false;
  }

  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/api-proxy/")) {
    return false;
  }

  if (request.mode === "navigate" || request.destination === "document" || acceptHeader.includes("text/html")) {
    return false;
  }

  if (request.headers.get("authorization")) {
    return false;
  }

  return url.pathname.startsWith("/_next/static/") || exactCacheablePaths.has(url.pathname);
}

function shouldCacheStaticResponse(response) {
  const cacheControl = response.headers.get("cache-control") ?? "";
  return response.ok && !/no-store|private/i.test(cacheControl);
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith("jpx-accounting-static-") && cacheName !== staticAssetCacheName)
          .map((cacheName) => caches.delete(cacheName)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  if (!shouldCacheStaticAsset(event.request)) {
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(staticAssetCacheName);
      const cached = await cache.match(event.request);
      if (cached) {
        return cached;
      }

      const response = await fetch(event.request);
      if (shouldCacheStaticResponse(response)) {
        await cache.put(event.request, response.clone());
      }
      return response;
    })(),
  );
});
