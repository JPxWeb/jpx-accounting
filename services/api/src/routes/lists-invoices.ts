import { Hono } from "hono";

import { buildOpenInvoicesList, buildPaymentHistoryList } from "@jpx-accounting/domain";

import type { ApiRouteDeps, ApiRouteEnv } from "../route-types";

export function registerInvoiceListRoutes(app: Hono<ApiRouteEnv>, deps: ApiRouteDeps) {
  app.get("/api/lists/open-invoices", async (context) =>
    context.json(buildOpenInvoicesList(await deps.getStore().getEvents())),
  );
  app.get("/api/lists/payment-history", async (context) =>
    context.json(buildPaymentHistoryList(await deps.getStore().getEvents())),
  );
}
