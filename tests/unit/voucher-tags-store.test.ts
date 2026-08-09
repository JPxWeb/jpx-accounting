import assert from "node:assert/strict";
import { test } from "node:test";

import { AccountingApiClient } from "@jpx-accounting/api-client";
import { MemoryLedgerStore } from "@jpx-accounting/domain/store";
import { createApp } from "../../services/api/src/app";
import {
  createApiRuntimeDependencies,
  LedgerStoreUnavailableError,
  UnavailableLedgerStore,
} from "../../services/api/src/runtime";

async function createPostedVoucher(store: MemoryLedgerStore) {
  const created = await store.createEvidence({
    actorId: "user:test",
    title: "Tagged invoice",
    originalFilename: "tagged-invoice.pdf",
    mimeType: "application/pdf",
    modalities: ["upload"],
  });
  await store.applyReviewDecision(created.review.id, "approve", { actorId: "user:test" });
  return created;
}

function createTestApp(store: MemoryLedgerStore) {
  const dependencies = createApiRuntimeDependencies({
    port: 0,
    runtimeMode: "demo",
    allowTestReset: false,
    corsPolicy: { kind: "wildcard" },
    azureOpenAi: {},
    database: { poolMode: "direct", poolMax: 10 },
    azureStorage: {},
    azureDocumentIntelligence: {},
    auth: {},
    advisor: {
      toolApprovalSecret: "test-advisor-approval-secret",
      maxOutputTokens: 2048,
      streamTimeoutMs: 90_000,
    },
  });
  return createApp({ ...dependencies, store, allowTestReset: false });
}

test("direct voucher tags append effective changes without another posting", async () => {
  const store = new MemoryLedgerStore();
  const created = await createPostedVoucher(store);
  const postingCount = (await store.getEvents()).filter((event) => event.eventType === "PostedToLedger").length;

  const added = await store.appendVoucherTags(created.voucher.id, {
    tagIds: ["tag_travel", "tag_travel"],
    mode: "add",
    actorId: "user:human",
  });
  const replayed = await store.appendVoucherTags(created.voucher.id, {
    tagIds: ["tag_travel"],
    mode: "add",
    actorId: "user:human",
  });
  const removed = await store.appendVoucherTags(created.voucher.id, {
    tagIds: ["tag_travel"],
    mode: "remove",
    actorId: "user:human",
  });

  assert.deepEqual(added.tagIds, ["tag_travel"]);
  assert.deepEqual(replayed.tagIds, ["tag_travel"]);
  assert.deepEqual(removed.tagIds, []);
  const events = await store.getEvents();
  assert.equal(events.filter((event) => event.eventType === "VoucherTagsAdded").length, 1);
  assert.equal(events.filter((event) => event.eventType === "VoucherTagsRemoved").length, 1);
  assert.equal(events.filter((event) => event.eventType === "PostedToLedger").length, postingCount);
});

test("tag work-item confirmation is idempotent and never posts", async () => {
  const store = new MemoryLedgerStore();
  const created = await createPostedVoucher(store);
  const proposed = await store.proposeEnrichmentWorkItem({
    actorId: "system:mcp",
    targetKind: "voucher",
    targetId: created.voucher.id,
    proposedChange: { kind: "voucher_tags_add", tagIds: ["tag_travel"] },
    source: "mcp",
    idempotencyKey: `mcp:tags:${created.voucher.id}`,
  });

  const first = await store.confirmEnrichmentWorkItem(proposed.id, { actorId: "user:confirmer" });
  const replayed = await store.confirmEnrichmentWorkItem(proposed.id, { actorId: "user:confirmer" });
  const events = await store.getEvents();

  assert.equal(first.resultingEventIds?.length, 1);
  assert.deepEqual(replayed.resultingEventIds, first.resultingEventIds);
  assert.equal(events.filter((event) => event.eventType === "VoucherTagsAdded").length, 1);
  assert.equal(events.filter((event) => event.eventType === "PostedToLedger").length, 1);
});

test("direct tag route strips client actor attribution and validates bounds", async () => {
  const store = new MemoryLedgerStore();
  const created = await createPostedVoucher(store);
  const app = createTestApp(store);

  const response = await app.request(`http://localhost/api/vouchers/${created.voucher.id}/tags`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tagIds: ["tag_travel"],
      mode: "add",
      actorId: "spoofed-client",
    }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()) as unknown, {
    voucherId: created.voucher.id,
    tagIds: ["tag_travel"],
  });
  const added = (await store.getEvents()).find((event) => event.eventType === "VoucherTagsAdded");
  assert.equal(added?.actorId, "user_founder");
  assert.equal(added?.payload.actorId, "user_founder");

  const invalid = await app.request(`http://localhost/api/vouchers/${created.voucher.id}/tags`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tagIds: Array.from({ length: 11 }, (_, index) => `tag_${index}`),
      mode: "add",
    }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(((await invalid.json()) as { code: string }).code, "validation_error");
});

test("UnavailableLedgerStore fails closed for direct voucher tags", async () => {
  const store = new UnavailableLedgerStore("ledger unavailable");
  await assert.rejects(store.appendVoucherTags(), LedgerStoreUnavailableError);
});

test("API client appends voucher tags through the offline demo transport", async () => {
  const client = new AccountingApiClient({ runtimeMode: "demo" });
  const snapshot = await client.getSnapshot();
  const voucher = snapshot.vouchers[0];
  assert.ok(voucher);
  const review = snapshot.reviews.find((candidate) => candidate.voucherId === voucher.id);
  assert.ok(review);
  await client.approveReview(review.id);
  const untrustedInput = {
    tagIds: ["tag_travel"],
    mode: "add" as const,
    actorId: "spoofed-client",
  };

  const result = await client.appendVoucherTags(voucher.id, untrustedInput);

  assert.deepEqual(result, { voucherId: voucher.id, tagIds: ["tag_travel"] });
});
