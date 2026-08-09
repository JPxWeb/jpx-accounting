import assert from "node:assert/strict";
import { test } from "node:test";

import { EnrichmentIntentVersionMismatchError, MemoryLedgerStore } from "@jpx-accounting/domain/store";

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

test("review enrichment intent rejects proposals the pre-post planner cannot consume", async () => {
  const store = new MemoryLedgerStore();
  const created = await store.createEvidence({
    actorId: "user:test",
    title: "Unsupported intent",
    originalFilename: "unsupported-intent.pdf",
    mimeType: "application/pdf",
    modalities: ["upload"],
  });

  await assert.rejects(
    () =>
      store.attachReviewEnrichmentIntent({
        actorId: "user:test",
        reviewId: created.review.id,
        proposals: [{ kind: "voucher_tags_add", tagIds: ["tag_travel"] }],
      }),
    /not supported/i,
  );
  assert.equal(await store.getReviewEnrichmentIntent(created.review.id), undefined);
});

test("every attach mints a fresh version, so the previous one can no longer be consumed", async () => {
  const store = new MemoryLedgerStore();
  const created = await store.createEvidence({
    actorId: "user:a",
    title: "Intent versioning",
    originalFilename: "intent-versioning.pdf",
    mimeType: "application/pdf",
    modalities: ["upload"],
  });

  const first = await store.attachReviewEnrichmentIntent({
    actorId: "user:a",
    reviewId: created.review.id,
    proposals: [{ kind: "noop" }],
  });
  const second = await store.attachReviewEnrichmentIntent({
    actorId: "user:b",
    reviewId: created.review.id,
    proposals: [{ kind: "noop" }],
  });

  assert.notEqual(first.version, second.version);
  assert.equal((await store.getReviewEnrichmentIntent(created.review.id))?.version, second.version);
});

test("approving with a superseded intent version appends nothing and leaves the review open", async () => {
  const store = new MemoryLedgerStore();
  const created = await store.createEvidence({
    actorId: "user:a",
    title: "Intent race",
    originalFilename: "intent-race.pdf",
    mimeType: "application/pdf",
    modalities: ["upload"],
  });

  // Reviewer A attaches and reads what they will approve.
  const seenByA = await store.attachReviewEnrichmentIntent({
    actorId: "user:a",
    reviewId: created.review.id,
    proposals: [{ kind: "noop" }],
  });
  // Producer B replaces it before A's approval lands.
  await store.attachReviewEnrichmentIntent({
    actorId: "user:b",
    reviewId: created.review.id,
    proposals: [
      { kind: "invoice_registration", direction: "ap", counterparty: "Unseen supplier", dueDate: "2026-09-01" },
    ],
  });

  const eventsBefore = (await store.getEvents()).length;
  await assert.rejects(
    () =>
      store.applyReviewDecision(created.review.id, "approve", {
        actorId: "user:a",
        consumeEnrichmentIntentVersion: seenByA.version,
      }),
    EnrichmentIntentVersionMismatchError,
  );

  const events = await store.getEvents();
  assert.equal(events.length, eventsBefore);
  assert.equal(
    events.some((event) => event.eventType === "InvoiceRegistered"),
    false,
  );
  assert.equal((await store.findReviewByVoucher(created.voucher.id))?.status, "needs-review");
  // B's proposal survives the refusal — the reviewer can reload and decide on it.
  assert.ok(await store.getReviewEnrichmentIntent(created.review.id));
});

test("an approval that echoes the current version consumes exactly that intent", async () => {
  const store = new MemoryLedgerStore();
  const created = await store.createEvidence({
    actorId: "user:a",
    title: "Intent consume",
    originalFilename: "intent-consume.pdf",
    mimeType: "application/pdf",
    modalities: ["upload"],
  });

  const intent = await store.attachReviewEnrichmentIntent({
    actorId: "user:a",
    reviewId: created.review.id,
    proposals: [
      { kind: "invoice_registration", direction: "ap", counterparty: "Seen supplier", dueDate: "2026-09-01" },
    ],
  });
  const decided = await store.applyReviewDecision(created.review.id, "approve", {
    actorId: "user:a",
    consumeEnrichmentIntentVersion: intent.version,
  });

  const registrations = (await store.getEvents()).filter((event) => event.eventType === "InvoiceRegistered");
  assert.equal(decided?.status, "approved");
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0]?.payload.counterparty, "Seen supplier");
  assert.equal(await store.getReviewEnrichmentIntent(created.review.id), undefined);
});
