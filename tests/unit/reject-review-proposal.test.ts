import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_RETRIEVAL_TOP_K, retrieveKnowledge } from "@jpx-accounting/advisor";
import { rejectReviewProposal, type ReviewActionProposalLike } from "@jpx-accounting/domain";
import { MemoryLedgerStore } from "@jpx-accounting/domain/store";

async function buildValidProposal(store: MemoryLedgerStore): Promise<ReviewActionProposalLike> {
  const created = await store.createEvidence({
    title: "Proposal fixture",
    originalFilename: "proposal.jpg",
    mimeType: "image/jpeg",
    modalities: ["upload"],
  });
  const suggestion = created.review.suggestion;
  assert.ok(suggestion, "seeded suggestion required");
  return {
    reviewId: created.review.id,
    voucherId: created.voucher.id,
    reviewTitle: created.review.title,
    action: "approve",
    edited: {
      accountNumber: suggestion.accountNumber,
      vatCode: suggestion.vatCode === "VAT-REVIEW" ? "VAT25" : suggestion.vatCode,
    },
  };
}

describe("Wave E′ / P1-7 — rejectReviewProposal + shared top-k", () => {
  it("accepts a valid undecided proposal against a Memory snapshot", async () => {
    const store = new MemoryLedgerStore();
    const proposal = await buildValidProposal(store);
    assert.equal(rejectReviewProposal(await store.getSnapshot(), proposal), undefined);
  });

  it("rejects a stale (already decided) proposal — the offline success-lie case", async () => {
    const store = new MemoryLedgerStore();
    const proposal = await buildValidProposal(store);
    await store.applyReviewDecision(proposal.reviewId, "approve", { actorId: "user:test" });

    const rejection = rejectReviewProposal(await store.getSnapshot(), proposal);
    assert.ok(rejection);
    assert.match(rejection, /redan avgjord/);
    assert.match(rejection, /ingenting bokfördes/);
  });

  it("rejects unknown reviewId, mismatched voucherId, and bad account/VAT", async () => {
    const store = new MemoryLedgerStore();
    const proposal = await buildValidProposal(store);
    const snapshot = await store.getSnapshot();

    assert.match(rejectReviewProposal(snapshot, { ...proposal, reviewId: "rev_missing" }) ?? "", /finns inte/);
    assert.match(rejectReviewProposal(snapshot, { ...proposal, voucherId: "v_other" }) ?? "", /fel verifikat/);
    assert.match(
      rejectReviewProposal(snapshot, {
        ...proposal,
        edited: { ...proposal.edited, accountNumber: "9999" },
      }) ?? "",
      /finns inte i kontoplanen/,
    );
    assert.match(
      rejectReviewProposal(snapshot, {
        ...proposal,
        edited: { ...proposal.edited, vatCode: "VAT-REVIEW" },
      }) ?? "",
      /Momskoden/,
    );
  });

  it("DEFAULT_RETRIEVAL_TOP_K is 4 and retrieveKnowledge defaults to it", () => {
    assert.equal(DEFAULT_RETRIEVAL_TOP_K, 4);
    const question = "Vad gäller för representation och moms?";
    const explicit = retrieveKnowledge(question, { topK: DEFAULT_RETRIEVAL_TOP_K });
    const implicit = retrieveKnowledge(question);
    assert.deepEqual(
      implicit.map((p) => p.id),
      explicit.map((p) => p.id),
    );
    assert.ok(implicit.length <= DEFAULT_RETRIEVAL_TOP_K);
  });
});
