import assert from "node:assert/strict";
import test from "node:test";

import { CONFIDENCE_HIGH_THRESHOLD, CONFIDENCE_MEDIUM_THRESHOLD, confidenceBand } from "@jpx-accounting/domain";

test("thresholds are the shared 0.85/0.6 vocabulary", () => {
  assert.equal(CONFIDENCE_HIGH_THRESHOLD, 0.85);
  assert.equal(CONFIDENCE_MEDIUM_THRESHOLD, 0.6);
});

test("band boundaries are inclusive at the lower edge", () => {
  assert.equal(confidenceBand(1), "high");
  assert.equal(confidenceBand(0.85), "high");
  assert.equal(confidenceBand(0.8499), "medium");
  assert.equal(confidenceBand(0.6), "medium");
  assert.equal(confidenceBand(0.5999), "low");
  assert.equal(confidenceBand(0), "low");
});

test("the seeded demo review confidence 0.86 lands in high (plan finding 3)", () => {
  // Deliberate: under the retired 0.95/0.80 tiers this was "medium"; the new
  // shared bands make the seed batch-approvable in demo E2E.
  assert.equal(confidenceBand(0.86), "high");
});
