import { AccountingApiError } from "@jpx-accounting/api-client";

export function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof AccountingApiError) {
    return error.detail;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}
