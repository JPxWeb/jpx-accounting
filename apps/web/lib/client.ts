import { createAccountingApiClient } from "@jpx-accounting/api-client";
import { getSupabaseAccessToken } from "./auth/supabase-client";
import { webRuntimeConfig } from "./runtime-config";

export const apiClient = createAccountingApiClient({
  baseUrl: webRuntimeConfig.apiBaseUrl,
  runtimeMode: webRuntimeConfig.runtimeMode,
  // WS-C R12: every API request carries `Authorization: Bearer <token>` while a
  // Supabase session exists. Resolves to undefined (zero overhead, no header)
  // when NEXT_PUBLIC_SUPABASE_* is unset or nobody is signed in — demo unchanged.
  getAuthToken: getSupabaseAccessToken,
});
