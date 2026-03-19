"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    // E2E runs disable the service worker so assertions are never affected by cached development assets.
    if (process.env.NEXT_PUBLIC_DISABLE_SW === "true") {
      return;
    }

    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    void navigator.serviceWorker.register("/sw.js");
  }, []);

  return null;
}
