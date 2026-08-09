import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryLedgerStore } from "@jpx-accounting/domain/store";

test("confirmEnrichmentWorkItem is idempotent for noop and never adds a second PostedToLedger", async () => {
  const store = new MemoryLedgerStore();
  const created = await store.createEvidence({
    actorId: "user:test",
    title: "Invoice",
    originalFilename: "inv.pdf",
    mimeType: "application/pdf",
    modalities: ["upload"],
    extractedText: "Invoice body",
  });
  await store.applyReviewDecision(created.review.id, "approve", { actorId: "user:test" });
  const before = (await store.getEvents()).filter((event) => event.eventType === "PostedToLedger").length;
  assert.equal(before, 1);

  const proposed = await store.proposeEnrichmentWorkItem({
    actorId: "user:test",
    targetKind: "voucher",
    targetId: created.voucher.id,
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
