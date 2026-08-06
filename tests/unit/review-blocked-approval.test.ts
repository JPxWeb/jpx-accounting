import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EvidenceCreateInput, ExtractionResult, ReviewTask, Voucher } from "@jpx-accounting/contracts";
import { MemoryLedgerStore, planReviewDecision, ReviewBlockedError } from "@jpx-accounting/domain";

const BLOCKED_REASON = "Mandatory bookkeeping or VAT data must be confirmed before deductible VAT can be approved.";

const createInput: EvidenceCreateInput = {
  title: "Blocked approval fixture",
  originalFilename: "blocked-receipt.jpg",
  mimeType: "image/jpeg",
  modalities: ["upload"],
};

/** Clear supplier VAT while keeping VAT amount → blocking VAT_NUMBER_MISSING. */
async function createBlockedReview(store: MemoryLedgerStore): Promise<{ review: ReviewTask; voucher: Voucher }> {
  const created = await store.createEvidence(createInput);
  const fields = created.voucher.extractedFields.map((field) =>
    field.key === "supplierVatNumber" ? { ...field, value: "" } : field,
  );
  const extraction: ExtractionResult = {
    modelId: "prebuilt-invoice",
    extractedAt: "2026-08-06T12:00:00.000Z",
    fields,
  };
  const updated = await store.updateEvidenceExtraction(created.evidence.id, extraction);
  assert.ok(updated?.review?.blockedReason, "fixture must land blocked");
  assert.equal(updated.review.blockedReason, BLOCKED_REASON);
  assert.ok(updated.voucher);
  return { review: updated.review, voucher: updated.voucher };
}

describe("Wave D′ — blockedReason approval gate", () => {
  it("planReviewDecision refuses approve when enforceBlockedReason and blockedReason are set", () => {
    const review = {
      id: "r_blocked",
      voucherId: "v1",
      title: "Review V-1001",
      status: "needs-review",
      blockedReason: BLOCKED_REASON,
      suggestedAction: "Request more evidence or post without VAT deduction.",
      provenanceTimeline: [],
    } as ReviewTask;
    const voucher = {
      id: "v1",
      status: "needs-review",
      organizationId: "org_jpx",
      workspaceId: "workspace_main",
    } as Voucher;

    assert.throws(
      () => planReviewDecision(review, voucher, "approve", { actorId: "user:test", enforceBlockedReason: true }),
      (error: unknown) => error instanceof ReviewBlockedError && error.code === "review_blocked",
    );

    // Demo / unset gate — byte-identical legacy: approve still plans.
    const demoPlan = planReviewDecision(review, voucher, "approve", { actorId: "user:test" });
    assert.equal(demoPlan.kind, "apply");

    // Reject and book-without-vat remain available under the normal gate.
    const rejectPlan = planReviewDecision(review, voucher, "reject", {
      actorId: "user:test",
      enforceBlockedReason: true,
    });
    assert.equal(rejectPlan.kind, "apply");
    const bookPlan = planReviewDecision(review, voucher, "book-without-vat", {
      actorId: "user:test",
      enforceBlockedReason: true,
    });
    assert.equal(bookPlan.kind, "apply");
  });

  it("MemoryLedgerStore: blocked approve rejected with enforceBlockedReason, allowed in demo", async () => {
    const store = new MemoryLedgerStore();
    const { review } = await createBlockedReview(store);

    await assert.rejects(
      () =>
        store.applyReviewDecision(review.id, "approve", {
          actorId: "user:test",
          enforceBlockedReason: true,
        }),
      (error: unknown) => error instanceof ReviewBlockedError && error.blockedReason === BLOCKED_REASON,
    );

    const stillPending = await store.findReviewByVoucher(review.voucherId);
    assert.equal(stillPending?.status, "needs-review", "failed approve must not mutate");

    // Demo path (no enforce flag) — approve still posts (byte-identical).
    const approved = await store.applyReviewDecision(review.id, "approve", { actorId: "user:test" });
    assert.equal(approved?.status, "approved");
  });

  it("MemoryLedgerStore: unblocked review still approves under the normal gate", async () => {
    const store = new MemoryLedgerStore();
    const created = await store.createEvidence(createInput);
    assert.equal(created.review.blockedReason, undefined);

    const approved = await store.applyReviewDecision(created.review.id, "approve", {
      actorId: "user:test",
      enforceBlockedReason: true,
    });
    assert.equal(approved?.status, "approved");
  });
});
