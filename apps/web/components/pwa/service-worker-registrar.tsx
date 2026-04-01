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
  await Promise.all(
    cacheNames
      .filter((cacheName) => cacheName.startsWith("jpx-accounting-static-"))
      .map((cacheName) => caches.delete(cacheName)),
  );
}

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    // In development, unregister service workers to prevent stale Turbopack chunks.
    if (process.env.NODE_ENV === "development" || webRuntimeConfig.disableServiceWorker) {
      void unregisterServiceWorkers();
      return;
    }

    // In production, register the SW. The prebuild script stamps a git SHA into
    // the SW cache name, so each deploy invalidates the old cache automatically.
    void navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
  }, []);

  return null;
}
