import { runtimeModeSchema, type RuntimeMode } from "@jpx-accounting/contracts";

export type WebRuntimeConfig = {
  runtimeMode: RuntimeMode;
  apiBaseUrl?: string | undefined;
  disableServiceWorker: boolean;
};

function normalizeOptionalValue(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readRuntimeMode(rawValue?: string): RuntimeMode {
  const parsed = runtimeModeSchema.safeParse(rawValue ?? "demo");
  return parsed.success ? parsed.data : "demo";
}

const runtimeMode = readRuntimeMode(process.env.NEXT_PUBLIC_ACCOUNTING_RUNTIME_MODE);
const configuredApiBaseUrl = normalizeOptionalValue(process.env.NEXT_PUBLIC_API_BASE_URL);

export const webRuntimeConfig: WebRuntimeConfig = {
  runtimeMode,
  apiBaseUrl: runtimeMode === "normal" ? (configuredApiBaseUrl ?? "/api-proxy") : configuredApiBaseUrl,
  // Never register under `next dev` (Serwist/next-pwa pattern); flag remains for explicit e2e/debug builds.
  disableServiceWorker: process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_DISABLE_SW === "true",
};
