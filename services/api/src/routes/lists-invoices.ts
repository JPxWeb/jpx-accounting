import { Hono } from "hono";

import { invoiceRegisteredPayloadSchema, paymentAllocatedPayloadSchema } from "@jpx-accounting/contracts";
import { buildOpenInvoicesList, buildPaymentHistoryList } from "@jpx-accounting/domain";

import type { ApiRouteDeps, ApiRouteEnv } from "../route-types";
import { jsonValidated } from "../validation";

export function registerInvoiceListRoutes(app: Hono<ApiRouteEnv>, deps: ApiRouteDeps) {
  app.post("/api/invoices", jsonValidated(invoiceRegisteredPayloadSchema), async (context) =>
    context.json(
      await deps.getStore().registerInvoice({
        ...context.req.valid("json"),
        actorId: deps.deriveActorId(context),
      }),
      201,
    ),
  );
  app.post("/api/payments/allocations", jsonValidated(paymentAllocatedPayloadSchema), async (context) =>
    context.json(
      await deps.getStore().allocatePayment({
        ...context.req.valid("json"),
        actorId: deps.deriveActorId(context),
      }),
      201,
    ),
  );
  app.get("/api/lists/open-invoices", async (context) =>
    context.json(buildOpenInvoicesList(await deps.getStore().getEvents())),
  );
  app.get("/api/lists/payment-history", async (context) =>
    context.json(buildPaymentHistoryList(await deps.getStore().getEvents())),
  );
}
