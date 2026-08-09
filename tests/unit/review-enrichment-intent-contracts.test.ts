import assert from "node:assert/strict";
import { test } from "node:test";

import { attachReviewEnrichmentIntentInputSchema, reviewEnrichmentIntentSchema } from "@jpx-accounting/contracts";

test("reviewEnrichmentIntentSchema stores proposals on open review", () => {
  const row = reviewEnrichmentIntentSchema.parse({
    reviewId: "review_1",
    voucherId: "voucher_1",
    proposals: [{ kind: "noop" }],
    updatedAt: "2026-08-09T10:00:00.000Z",
    updatedBy: "user:abc",
  });

  assert.equal(row.proposals.length, 1);
});

test("attachReviewEnrichmentIntentInputSchema strips client actorId", () => {
  const parsed = attachReviewEnrichmentIntentInputSchema.parse({
    reviewId: "review_1",
    proposals: [{ kind: "noop" }],
    actorId: "user:forged-client",
  });

  assert.equal(parsed.reviewId, "review_1");
  assert.equal(Object.hasOwn(parsed, "actorId"), false);
});
