"use client";

import { useEffect } from "react";

import { webRuntimeConfig } from "../../lib/runtime-config";

async function unregisterServiceWorkers() {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));

  if (!("caches" in window)) {
    return;
  }

  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.filter((cacheName) => cacheName.startsWith("jpx-accounting-static-")).map((cacheName) => caches.delete(cacheName)));
}

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    // Debug and e2e builds actively unregister prior workers so cache-policy changes are applied immediately.
    if (webRuntimeConfig.disableServiceWorker) {
      if (typeof window !== "undefined" && "serviceWorker" in navigator) {
        void unregisterServiceWorkers();
      }
      return;
    }

    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    void navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
  }, []);

  return null;
}
