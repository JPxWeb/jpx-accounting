import assert from "node:assert/strict";
import { test } from "node:test";

import {
  enrichmentProposalSchema,
  eventTypeSchema,
  invoiceLineEnrichmentPayloadSchema,
  invoiceRegisteredPayloadSchema,
  openInvoiceListSchema,
  paymentAllocatedPayloadSchema,
  paymentHistoryListSchema,
} from "@jpx-accounting/contracts";

test("invoice and payment event types exist", () => {
  assert.ok(eventTypeSchema.options.includes("InvoiceRegistered"));
  assert.ok(eventTypeSchema.options.includes("PaymentAllocated"));
});

test("invoice registration requires typed AR or AP fields", () => {
  const invoice = invoiceRegisteredPayloadSchema.parse({
    invoiceId: "inv_1",
    direction: "ap",
    counterparty: "Acme AB",
    dueDate: "2026-09-01",
    currency: "SEK",
    originalAmount: 100,
    actorId: "forged-client-actor",
  });

  assert.equal(invoice.direction, "ap");
  assert.equal(invoice.originalAmount, 100);
  assert.equal("actorId" in invoice, false);
  assert.equal(
    invoiceRegisteredPayloadSchema.safeParse({
      ...invoice,
      direction: "other",
    }).success,
    false,
  );
});

test("payment allocation requires a positive amount and timestamp", () => {
  const payment = paymentAllocatedPayloadSchema.parse({
    paymentId: "pay_1",
    invoiceId: "inv_1",
    amount: 40,
    currency: "SEK",
    allocatedAt: "2026-08-15T10:00:00.000Z",
    actorId: "forged-client-actor",
  });

  assert.equal(payment.amount, 40);
  assert.equal("actorId" in payment, false);
  assert.equal(paymentAllocatedPayloadSchema.safeParse({ ...payment, amount: 0 }).success, false);
});

test("invoice line enrichment uses the existing human-confirmed line proposal path", () => {
  const payload = invoiceLineEnrichmentPayloadSchema.parse({
    invoiceId: "inv_1",
    direction: "ar",
  });
  const proposal = enrichmentProposalSchema.parse({
    kind: "line_enrichment_record",
    lineId: "ln_1",
    enrichmentType: "invoice",
    payload,
  });

  assert.equal(proposal.kind, "line_enrichment_record");
  assert.deepEqual(proposal.payload, { invoiceId: "inv_1", direction: "ar" });
});

test("invoice and payment list rows are contract validated", () => {
  assert.deepEqual(
    openInvoiceListSchema.parse([
      {
        id: "inv_1",
        kind: "open_invoice",
        direction: "ap",
        counterparty: "Acme AB",
        dueDate: "2026-09-01",
        currency: "SEK",
        originalAmount: 100,
        openAmount: 60,
      },
    ]),
    [
      {
        id: "inv_1",
        kind: "open_invoice",
        direction: "ap",
        counterparty: "Acme AB",
        dueDate: "2026-09-01",
        currency: "SEK",
        originalAmount: 100,
        openAmount: 60,
      },
    ],
  );
  assert.equal(
    paymentHistoryListSchema.parse([
      {
        id: "pay_1",
        kind: "payment",
        paymentId: "pay_1",
        invoiceId: "inv_1",
        amount: 40,
        currency: "SEK",
        allocatedAt: "2026-08-15T10:00:00.000Z",
      },
    ])[0]?.amount,
    40,
  );
  assert.equal(
    paymentHistoryListSchema.safeParse([
      {
        id: "pay_other",
        kind: "payment",
        paymentId: "pay_1",
        invoiceId: "inv_1",
        amount: 40,
        currency: "SEK",
        allocatedAt: "2026-08-15T10:00:00.000Z",
      },
    ]).success,
    false,
  );
});
