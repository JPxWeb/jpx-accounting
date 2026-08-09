import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryLedgerStore } from "@jpx-accounting/domain/store";

import { createApp } from "../../services/api/src/app";
import { createApiRuntimeDependencies } from "../../services/api/src/runtime";

function appWith(store: MemoryLedgerStore) {
  const deps = createApiRuntimeDependencies({
    port: 0,
    runtimeMode: "demo",
    allowTestReset: false,
    corsPolicy: { kind: "wildcard" },
    azureOpenAi: {},
    database: { poolMode: "direct", poolMax: 10 },
    azureStorage: {},
    azureDocumentIntelligence: {},
    auth: {},
    advisor: { toolApprovalSecret: "test-secret", maxOutputTokens: 2048, streamTimeoutMs: 90_000 },
  });
  return createApp({ ...deps, store, allowTestReset: false });
}

test("invoice list routes return exact derived JSON without appending", async () => {
  const store = new MemoryLedgerStore();
  store.getEvents = async () => [];
  const app = appWith(store);

  const open = await app.request("http://localhost/api/lists/open-invoices");
  const history = await app.request("http://localhost/api/lists/payment-history");

  assert.equal(open.status, 200);
  assert.equal(history.status, 200);
  assert.deepEqual(await open.json(), []);
  assert.deepEqual(await history.json(), []);
  assert.deepEqual(await store.getEvents(), []);
});

test("invoice and payment writers derive actors and reject currency mismatches", async () => {
  const store = new MemoryLedgerStore();
  const app = appWith(store);

  const invoice = await app.request("http://localhost/api/invoices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      invoiceId: "inv_route",
      direction: "ap",
      counterparty: "Acme AB",
      dueDate: "2026-09-01",
      currency: "SEK",
      originalAmount: 100,
      actorId: "user:forged",
    }),
  });
  const payment = await app.request("http://localhost/api/payments/allocations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      paymentId: "pay_route",
      invoiceId: "inv_route",
      amount: 40,
      currency: "SEK",
      allocatedAt: "2026-08-15T10:00:00.000Z",
      actorId: "user:forged",
    }),
  });
  const mismatch = await app.request("http://localhost/api/payments/allocations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      paymentId: "pay_wrong_currency",
      invoiceId: "inv_route",
      amount: 10,
      currency: "EUR",
      allocatedAt: "2026-08-16T10:00:00.000Z",
    }),
  });

  assert.equal(invoice.status, 201);
  assert.equal(payment.status, 201);
  assert.equal(mismatch.status, 422);
  const written = (await store.getEvents()).filter(
    (event) => event.eventType === "InvoiceRegistered" || event.eventType === "PaymentAllocated",
  );
  assert.deepEqual(
    written.map((event) => event.actorId),
    ["user_founder", "user_founder"],
  );
});
