import assert from "node:assert/strict";
import test from "node:test";

import {
  getObsoleteStaticCaches,
  shouldCacheStaticAsset,
  shouldCacheStaticResponse,
  staticAssetCacheName,
} from "../../apps/web/lib/service-worker-cache";

test("service worker only caches immutable shell assets", () => {
  assert.equal(
    shouldCacheStaticAsset({
      url: "https://example.com/_next/static/chunks/main.js",
      origin: "https://example.com",
    }),
    true,
  );

  assert.equal(
    shouldCacheStaticAsset({
      url: "https://example.com/api-proxy/api/workspace",
      origin: "https://example.com",
    }),
    false,
  );

  assert.equal(
    shouldCacheStaticAsset({
      url: "https://example.com/reports",
      origin: "https://example.com",
      mode: "navigate",
      headers: {
        accept: "text/html",
      },
    }),
    false,
  );
});

test("service worker respects response cache-control", () => {
  assert.equal(
    shouldCacheStaticResponse({
      ok: true,
      headers: {
        "cache-control": "public, max-age=31536000, immutable",
      },
    }),
    true,
  );

  assert.equal(
    shouldCacheStaticResponse({
      ok: true,
      headers: {
        "cache-control": "no-store",
      },
    }),
    false,
  );
});

test("service worker removes obsolete cache versions", () => {
  assert.deepEqual(getObsoleteStaticCaches(["jpx-accounting-static-v1", staticAssetCacheName]), ["jpx-accounting-static-v1"]);
});
