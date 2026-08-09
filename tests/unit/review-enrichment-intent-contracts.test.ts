import assert from "node:assert/strict";
import { test } from "node:test";

import {
  attachReviewEnrichmentIntentInputSchema,
  reviewDecisionInputSchema,
  reviewEnrichmentIntentSchema,
} from "@jpx-accounting/contracts";

test("reviewEnrichmentIntentSchema stores proposals on open review", () => {
  const row = reviewEnrichmentIntentSchema.parse({
    reviewId: "review_1",
    voucherId: "voucher_1",
    proposals: [{ kind: "noop" }],
    version: "rei_1",
    updatedAt: "2026-08-09T10:00:00.000Z",
    updatedBy: "user:abc",
  });

  assert.equal(row.proposals.length, 1);
  assert.equal(row.version, "rei_1");
});

test("reviewEnrichmentIntentSchema requires a consume token on every intent", () => {
  assert.throws(() =>
    reviewEnrichmentIntentSchema.parse({
      reviewId: "review_1",
      voucherId: "voucher_1",
      proposals: [{ kind: "noop" }],
      updatedAt: "2026-08-09T10:00:00.000Z",
      updatedBy: "user:abc",
    }),
  );
});

test("a consume decision cannot be expressed without the intent version", () => {
  assert.equal(
    reviewDecisionInputSchema.parse({ enrichmentIntent: { mode: "consume", version: "rei_1" } }).enrichmentIntent?.mode,
    "consume",
  );
  assert.equal(reviewDecisionInputSchema.parse({}).enrichmentIntent, undefined);
  assert.equal(
    reviewDecisionInputSchema.parse({ enrichmentIntent: { mode: "clear" } }).enrichmentIntent?.mode,
    "clear",
  );
  // Structurally impossible to assert "I saw the intent" without naming which one.
  assert.throws(() => reviewDecisionInputSchema.parse({ enrichmentIntent: { mode: "consume" } }));
  assert.throws(() => reviewDecisionInputSchema.parse({ enrichmentIntent: "consume" }));
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
