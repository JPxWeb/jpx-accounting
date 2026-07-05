"use client";

import { useEffect, useMemo } from "react";

/**
 * Returns an object URL for `blob`; the URL for the previous blob is revoked when the blob
 * changes and the current one on unmount. SSR-safe: server renders yield `undefined`.
 *
 * Note: `useState` + set-in-effect is the classic shape here, but this repo's
 * `react-hooks/set-state-in-effect` rule forbids it — deriving in render keeps the URL
 * available on the very first client render, and the effect owns revocation only.
 */
export function useObjectUrl(blob: Blob | null | undefined): string | undefined {
  const url = useMemo(() => {
    if (!blob || typeof window === "undefined") {
      return undefined;
    }

    return URL.createObjectURL(blob);
  }, [blob]);

  useEffect(() => {
    if (!url) {
      return undefined;
    }

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [url]);

  return url;
}
