import { createAccountingApiClient } from "@jpx-accounting/api-client";
import { webRuntimeConfig } from "./runtime-config";

export const apiClient = createAccountingApiClient({
  baseUrl: webRuntimeConfig.apiBaseUrl,
  runtimeMode: webRuntimeConfig.runtimeMode,
});
