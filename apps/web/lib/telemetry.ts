/**
 * Browser telemetry seam (WS-A5 observability half) — deliberately NOT wired to an SDK yet.
 *
 * Decision (2026-07-19): we did not add `@microsoft/applicationinsights-web`. Two reasons:
 *
 * 1. **CSP.** The production CSP in `next.config.ts` pins `connect-src` to `'self'` plus the
 *    explicitly configured storage/Supabase origins. Browser App Insights POSTs beacons to the
 *    region-specific `IngestionEndpoint` origin embedded in the connection string (e.g.
 *    `https://<region>.in.applicationinsights.azure.com`), so enabling it without a CSP change
 *    would silently drop every beacon. The CSP needs the same normalize-and-append treatment as
 *    `resolveStorageOrigin` / `resolveSupabaseAuthOrigin` before the SDK is worth its bytes.
 * 2. **Bundle cost for zero current consumers.** Server-side API telemetry (see
 *    `services/api/src/telemetry.ts`) already covers request rates/failures/latency — the
 *    signals the remediation plan actually needs. Client pageview analytics has no consumer
 *    today, so even a lazy ~30KB chunk is pure cost.
 *
 * The seam below is what the eventual wiring plugs into: call `initWebTelemetry()` once from a
 * client component (e.g. a tiny `"use client"` hook mounted in the root layout). It reads
 * `NEXT_PUBLIC_APPINSIGHTS_CONNECTION_STRING` (must be inlined at build time — `NEXT_PUBLIC_*`
 * vars are baked into the client bundle) and stays a no-op when unset, mirroring the API side.
 *
 * To enable later:
 * 1. `pnpm --filter web add --save-exact @microsoft/applicationinsights-web` (exact pin, Rule 28;
 *    confine imports to THIS file).
 * 2. Inside `initWebTelemetry()`, lazy `await import("@microsoft/applicationinsights-web")`,
 *    `new ApplicationInsights({ config: { connectionString, enableAutoRouteTracking: true } })`,
 *    `.loadAppInsights()` — keeping the SDK out of the critical-path chunk.
 * 3. Extend the CSP: parse `IngestionEndpoint` out of the connection string at build time in
 *    `next.config.ts` and append its origin to `connect-src` (followup — that file is outside
 *    the WS-A5 telemetry ownership).
 */

export type WebTelemetryStatus = { enabled: false; reason: "no-connection-string" | "not-wired" };

/**
 * No-op today: returns why telemetry stayed off. Safe to call multiple times and from the
 * server (it only reads a build-time-inlined env var).
 */
export function initWebTelemetry(): WebTelemetryStatus {
  const connectionString = process.env.NEXT_PUBLIC_APPINSIGHTS_CONNECTION_STRING?.trim();
  if (connectionString === undefined || connectionString === "") {
    return { enabled: false, reason: "no-connection-string" };
  }
  // Intentionally not wired to an SDK — see the module doc comment for the decision + enable steps.
  return { enabled: false, reason: "not-wired" };
}
