import { expect, test } from "@playwright/test";

import { resetApiState } from "./test-helpers";

test.skip(({ isMobile }) => isMobile, "Service-worker smoke coverage only needs one desktop project.");

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

test("service worker caches static assets without caching workspace API responses", async ({ page }) => {
  await page.goto("/");

  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    await navigator.serviceWorker.ready;
    await registration.update();
  });

  await page.reload();
  await page.evaluate(() => fetch("/api-proxy/api/workspace", { headers: { accept: "application/json" } }));

  await expect
    .poll(async () => {
      return page.evaluate(async () => {
        return (await caches.keys()).filter((cacheName) => cacheName.startsWith("jpx-accounting-static-")).length;
      });
    })
    .toBeGreaterThan(0);

  const cachedUrls = await page.evaluate(async () => {
    const cacheNames = await caches.keys();
    const matchingCache = cacheNames.find((cacheName) => cacheName.startsWith("jpx-accounting-static-"));
    if (!matchingCache) {
      return [];
    }

    const cache = await caches.open(matchingCache);
    const requests = await cache.keys();
    return requests.map((request) => request.url);
  });

  expect(cachedUrls.some((url) => url.includes("/_next/static/"))).toBeTruthy();
  expect(cachedUrls.some((url) => url.includes("/api-proxy/api/workspace"))).toBeFalsy();
});
