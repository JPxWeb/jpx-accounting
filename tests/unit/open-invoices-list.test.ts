import assert from "node:assert/strict";
import { test } from "node:test";

import type { LedgerEvent } from "@jpx-accounting/contracts";
import { buildListProjection, buildOpenInvoicesList, buildPaymentHistoryList } from "@jpx-accounting/domain";

function event(id: string, eventType: LedgerEvent["eventType"], payload: Record<string, unknown>): LedgerEvent {
  return {
    id,
    organizationId: "org_jpx",
    workspaceId: "workspace_main",
    aggregateType: "ledger",
    aggregateId: "inv_1",
    eventType,
    actorId: "user:test",
    occurredAt: "2026-08-09T10:00:00.000Z",
    payload,
    previousHash: id === "evt_invoice" ? "GENESIS" : "sha256_invoice",
    eventHash: `sha256_${id.padEnd(64, "0").slice(0, 64)}`,
    digestDate: "2026-08-09",
  };
}

const invoice = {
  invoiceId: "inv_1",
  direction: "ap",
  counterparty: "Acme AB",
  dueDate: "2026-09-01",
  currency: "SEK",
  originalAmount: 100,
} as const;

const payment = {
  paymentId: "pay_1",
  invoiceId: "inv_1",
  amount: 40,
  currency: "SEK",
  allocatedAt: "2026-08-15T10:00:00.000Z",
} as const;

test("open invoices list derives direction and partial open amount from events", () => {
  const rows = buildOpenInvoicesList([
    event("evt_invoice", "InvoiceRegistered", invoice),
    event("evt_payment", "PaymentAllocated", payment),
  ]);

  assert.deepEqual(rows, [
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
  ]);
});

test("fully allocated invoices are absent from the open list", () => {
  const rows = buildOpenInvoicesList([
    event("evt_invoice", "InvoiceRegistered", invoice),
    event("evt_payment", "PaymentAllocated", { ...payment, amount: 100 }),
  ]);

  assert.deepEqual(rows, []);
});

test("invoice registration is immutable during replay", () => {
  const rows = buildOpenInvoicesList([
    event("evt_invoice", "InvoiceRegistered", invoice),
    event("evt_duplicate", "InvoiceRegistered", {
      ...invoice,
      counterparty: "Rewritten Supplier AB",
      originalAmount: 999,
    }),
  ]);

  assert.equal(rows[0]?.counterparty, "Acme AB");
  assert.equal(rows[0]?.originalAmount, 100);
});

test("payment history is derived without mutating invoice history", () => {
  const events = [
    event("evt_invoice", "InvoiceRegistered", invoice),
    event("evt_payment", "PaymentAllocated", payment),
  ];

  assert.deepEqual(buildPaymentHistoryList(events), [
    {
      id: "pay_1",
      kind: "payment",
      ...payment,
    },
  ]);
  assert.equal(events[1]?.payload.amount, 40);
});

test("first payment allocation is authoritative for a payment id", () => {
  const events = [
    event("evt_invoice", "InvoiceRegistered", invoice),
    event("evt_payment", "PaymentAllocated", payment),
    event("evt_duplicate", "PaymentAllocated", {
      ...payment,
      amount: 75,
    }),
  ];

  assert.equal(buildOpenInvoicesList(events)[0]?.openAmount, 60);
  assert.deepEqual(buildPaymentHistoryList(events), [
    {
      id: "pay_1",
      kind: "payment",
      ...payment,
    },
  ]);
});

test("invoice builders are registered on the generic list seam", () => {
  const events = [
    event("evt_invoice", "InvoiceRegistered", invoice),
    event("evt_payment", "PaymentAllocated", payment),
  ];

  assert.deepEqual(buildListProjection("open_invoice", events), buildOpenInvoicesList(events));
  assert.deepEqual(buildListProjection("payment", events), buildPaymentHistoryList(events));
});
