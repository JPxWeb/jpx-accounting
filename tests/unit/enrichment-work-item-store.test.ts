import assert from "node:assert/strict";
import { test } from "node:test";

import { EnrichmentTargetNotPostedError } from "@jpx-accounting/domain";
import { MemoryLedgerStore } from "@jpx-accounting/domain/store";
import { LedgerStoreUnavailableError, UnavailableLedgerStore } from "../../services/api/src/runtime";

async function createPostedVoucher(store: MemoryLedgerStore) {
  const created = await store.createEvidence({
    actorId: "user:test",
    title: "Invoice",
    originalFilename: "inv.pdf",
    mimeType: "application/pdf",
    modalities: ["upload"],
    extractedText: "Invoice body",
  });
  await store.applyReviewDecision(created.review.id, "approve", { actorId: "user:test" });
  return created.voucher;
}

test("confirmEnrichmentWorkItem is idempotent for noop and never adds a second PostedToLedger", async () => {
  const store = new MemoryLedgerStore();
  const voucher = await createPostedVoucher(store);
  const before = (await store.getEvents()).filter((event) => event.eventType === "PostedToLedger").length;
  assert.equal(before, 1);

  const proposed = await store.proposeEnrichmentWorkItem({
    actorId: "user:test",
    targetKind: "voucher",
    targetId: voucher.id,
    proposedChange: { kind: "noop" },
    source: "ui",
    idempotencyKey: "ui:noop:1",
  });
  const first = await store.confirmEnrichmentWorkItem(proposed.id, { actorId: "user:test" });
  const second = await store.confirmEnrichmentWorkItem(proposed.id, { actorId: "user:test" });

  assert.deepEqual(second.resultingEventIds, first.resultingEventIds);
  const after = (await store.getEvents()).filter((event) => event.eventType === "PostedToLedger").length;
  assert.equal(after, 1);
});

test("proposeEnrichmentWorkItem rejects targets that are not posted", async () => {
  const store = new MemoryLedgerStore();
  await assert.rejects(
    store.proposeEnrichmentWorkItem({
      actorId: "user:test",
      targetKind: "voucher",
      targetId: "voucher_missing",
      proposedChange: { kind: "noop" },
      source: "ui",
      idempotencyKey: "ui:missing",
    }),
    EnrichmentTargetNotPostedError,
  );
});

test("MemoryLedgerStore does not expose mutable enrichment work-item state", async () => {
  const store = new MemoryLedgerStore();
  const voucher = await createPostedVoucher(store);
  const proposed = await store.proposeEnrichmentWorkItem({
    actorId: "user:test",
    targetKind: "voucher",
    targetId: voucher.id,
    proposedChange: { kind: "noop" },
    source: "ui",
    idempotencyKey: "ui:snapshot",
  });

  (proposed.proposedChange as { kind: string }).kind = "tampered";

  const fetched = await store.getEnrichmentWorkItem(proposed.id);
  assert.deepEqual(fetched?.proposedChange, { kind: "noop" });
});

test("UnavailableLedgerStore fails closed for every enrichment work-item method", async () => {
  const store = new UnavailableLedgerStore("ledger unavailable");
  await assert.rejects(store.proposeEnrichmentWorkItem(), LedgerStoreUnavailableError);
  await assert.rejects(store.getEnrichmentWorkItem(), LedgerStoreUnavailableError);
  await assert.rejects(store.confirmEnrichmentWorkItem(), LedgerStoreUnavailableError);
  await assert.rejects(store.rejectEnrichmentWorkItem(), LedgerStoreUnavailableError);
});
