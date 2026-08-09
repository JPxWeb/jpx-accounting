import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryLedgerStore } from "@jpx-accounting/domain/store";

test("review enrichment intent is stored only while its review is open", async () => {
  const store = new MemoryLedgerStore();
  const created = await store.createEvidence({
    actorId: "user:test",
    title: "Intent",
    originalFilename: "intent.pdf",
    mimeType: "application/pdf",
    modalities: ["upload"],
  });

  const intent = await store.attachReviewEnrichmentIntent({
    actorId: "user:test",
    reviewId: created.review.id,
    proposals: [{ kind: "noop" }],
  });
  assert.equal(intent.reviewId, created.review.id);
  assert.equal(intent.voucherId, created.voucher.id);
  assert.equal(intent.updatedBy, "user:test");
  assert.deepEqual(await store.getReviewEnrichmentIntent(created.review.id), intent);

  await store.applyReviewDecision(created.review.id, "approve", { actorId: "user:test" });
  assert.equal(await store.getReviewEnrichmentIntent(created.review.id), undefined);
  await assert.rejects(
    () =>
      store.attachReviewEnrichmentIntent({
        actorId: "user:test",
        reviewId: created.review.id,
        proposals: [{ kind: "noop" }],
      }),
    /open|closed|posted/i,
  );

  const posted = (await store.getEvents()).filter(
    (event) => event.aggregateId === created.voucher.id && event.eventType === "PostedToLedger",
  );
  assert.equal(posted.length, 1);
});
