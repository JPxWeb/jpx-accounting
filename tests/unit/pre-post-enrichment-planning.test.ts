import assert from "node:assert/strict";
import { test } from "node:test";

import type { AccountingSuggestion, ReviewTask, Voucher } from "@jpx-accounting/contracts";
import {
  mergePrePostEnrichmentsIntoReviewDecisionPlan,
  planPrePostEnrichment,
  planReviewDecision,
} from "@jpx-accounting/domain";

const voucher: Voucher = {
  id: "v1",
  organizationId: "org_jpx",
  workspaceId: "workspace_main",
  evidencePacketId: "p1",
  voucherNumber: "V-v1",
  status: "needs-review",
  accountingMethod: "invoice",
  extractedFields: [],
  voucherFields: {
    grossAmount: 125,
    netAmount: 100,
    vatAmount: 25,
    currency: "SEK",
    description: "Pre-post",
  },
  createdAt: "2026-05-01T00:00:00.000Z",
  createdBy: "user:test",
};

const suggestion: AccountingSuggestion = {
  id: "s_v1",
  voucherId: "v1",
  accountNumber: "6540",
  accountName: "IT-tjanster",
  vatCode: "VAT25",
  confidence: 0.9,
  reasoning: "r",
  kind: "recommendation",
  citations: [],
  ruleHits: [],
};

const review: ReviewTask = {
  id: "r1",
  voucherId: "v1",
  title: "Pre-post fixture",
  status: "needs-review",
  suggestedAction: "approve",
  suggestion,
  provenanceTimeline: [],
};

test("pre-post enrichment emits a companion event without another posting", () => {
  const base = planReviewDecision(review, voucher, "approve", { actorId: "user:abc" }, "2026-08-09T12:00:00.000Z");
  assert.equal(base.kind, "apply");
  const lineId = base.kind === "apply" ? base.lines?.[0]?.lineId : undefined;
  assert.ok(lineId);

  const enrichment = planPrePostEnrichment({
    review,
    proposals: [
      {
        kind: "line_enrichment_record",
        lineId,
        enrichmentType: "project",
        payload: { projectId: "proj_1" },
      },
    ],
    postingLines: base.lines ?? [],
    actorId: "user:abc",
    organizationId: voucher.organizationId,
    workspaceId: voucher.workspaceId,
  });
  assert.deepEqual(
    enrichment.companionEvents.map((event) => event.eventType),
    ["LineEnrichmentRecorded"],
  );
  assert.ok(enrichment.companionEvents.every((event) => event.eventType !== "PostedToLedger"));

  const merged = mergePrePostEnrichmentsIntoReviewDecisionPlan(base, enrichment.companionEvents);
  assert.equal(merged.kind, "apply");
  assert.equal(
    merged.kind === "apply" ? merged.events.filter((event) => event.eventType === "PostedToLedger").length : 0,
    1,
  );
  assert.equal(merged.kind === "apply" ? merged.events.at(-1)?.eventType : undefined, "LineEnrichmentRecorded");
});

test("pre-post enrichment rejects a line outside the posting batch", () => {
  assert.throws(
    () =>
      planPrePostEnrichment({
        review,
        proposals: [
          {
            kind: "line_enrichment_record",
            lineId: "ln_missing",
            enrichmentType: "project",
            payload: { projectId: "proj_1" },
          },
        ],
        postingLines: [],
        actorId: "user:abc",
        organizationId: voucher.organizationId,
        workspaceId: voucher.workspaceId,
      }),
    /line|ln_missing/i,
  );
});

test("merge leaves replay decisions unchanged", () => {
  const closed: ReviewTask = { ...review, status: "approved" };
  const replay = planReviewDecision(closed, { ...voucher, status: "approved" }, "approve", { actorId: "user:abc" });
  const merged = mergePrePostEnrichmentsIntoReviewDecisionPlan(replay, []);
  assert.deepEqual(merged, replay);
});
