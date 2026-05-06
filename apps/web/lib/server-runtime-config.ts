import "server-only";

import { runtimeModeSchema, type RuntimeMode } from "@jpx-accounting/contracts";

export type WebServerRuntimeConfig = {
  runtimeMode: RuntimeMode;
  apiBaseUrl?: string | undefined;
};

function normalizeAbsoluteUrl(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
    return undefined;
  }

  return trimmed;
}

function readRuntimeMode(rawValue?: string): RuntimeMode {
  const parsed = runtimeModeSchema.safeParse(rawValue ?? "demo");
  return parsed.success ? parsed.data : "demo";
}

export function getWebServerRuntimeConfig(): WebServerRuntimeConfig {
  return {
    runtimeMode: readRuntimeMode(process.env.NEXT_PUBLIC_ACCOUNTING_RUNTIME_MODE),
    apiBaseUrl:
      normalizeAbsoluteUrl(process.env.ACCOUNTING_API_BASE_URL) ??
      normalizeAbsoluteUrl(process.env.NEXT_PUBLIC_API_BASE_URL),
  };
}
