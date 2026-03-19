import { createAccountingApiClient } from "@jpx-accounting/api-client";

export const apiClient = createAccountingApiClient(process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy");
