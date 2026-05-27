import assert from "node:assert/strict";
import { test } from "node:test";

import type { ReviewTask, Voucher } from "@jpx-accounting/contracts";
import {
  detectComplianceIssues,
  detectComplianceIssuesDetailed,
} from "@jpx-accounting/domain";

const voucherFixture = (overrides: Partial<Voucher> = {}): Voucher => ({
  id: "v1",
  organizationId: "o",
  workspaceId: "w",
  evidencePacketId: "p1",
  voucherNumber: "V-1",
  status: "needs-review",
  accountingMethod: "invoice",
  extractedFields: [],
  voucherFields: {
    description: "Test",
    grossAmount: 100,
    netAmount: 80,
    vatAmount: 20,
    vatRate: 25,
    currency: "SEK",
  },
  createdAt: "2026-05-01T00:00:00.000Z",
  createdBy: "u",
  ...overrides,
});

const reviewFixture = (overrides: Partial<ReviewTask> = {}): ReviewTask => ({
  id: "r1",
  voucherId: "v1",
  title: "Review V-1",
  status: "needs-review",
  suggestedAction: "Approve",
  suggestion: {
    id: "s1",
    voucherId: "v1",
    accountNumber: "6540",
    accountName: "IT-tjänster",
    vatCode: "VAT25",
    confidence: 0.9,
    reasoning: "r",
    kind: "recommendation",
    citations: [],
    ruleHits: [],
  },
  provenanceTimeline: [],
  ...overrides,
});

const blockingRuleHit = {
  id: "rh1",
  code: "vat-missing",
  title: "Missing supplier VAT",
  severity: "blocking" as const,
  message: "Supplier VAT is required",
  sourceIds: [],
};

test("no alerts on clean data", () => {
  const alerts = detectComplianceIssues(
    [reviewFixture()],
    [voucherFixture()],
    "2026-05-02",
  );
  assert.equal(alerts.length, 0);
});

test("stale-blocked fires for needs-review with blocking hit > 7 days", () => {
  const blocking = reviewFixture({
    suggestion: { ...reviewFixture().suggestion!, ruleHits: [blockingRuleHit] },
  });
  const alerts = detectComplianceIssues(
    [blocking],
    [voucherFixture()],
    "2026-05-09",
  );
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.kind, "stale-blocked");
  assert.equal(alerts[0]?.targetId, "v1");
});

test("stale-blocked does NOT fire on exactly day 7", () => {
  const blocking = reviewFixture({
    suggestion: { ...reviewFixture().suggestion!, ruleHits: [blockingRuleHit] },
  });
  const alerts = detectComplianceIssues(
    [blocking],
    [voucherFixture()],
    "2026-05-08",
  );
  assert.equal(alerts.length, 0);
});

test("missing-supplier-vat fires on approved voucher without supplierVatNumber", () => {
  const v = voucherFixture({
    status: "approved",
    voucherFields: {
      ...voucherFixture().voucherFields,
      supplierVatNumber: undefined,
    },
  });
  const alerts = detectComplianceIssues([], [v], "2026-05-09");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.kind, "missing-supplier-vat");
});

test("missing-supplier-vat skipped when supplierVatNumber present", () => {
  const v = voucherFixture({
    status: "approved",
    voucherFields: {
      ...voucherFixture().voucherFields,
      supplierVatNumber: "SE556677889901",
    },
  });
  const alerts = detectComplianceIssues([], [v], "2026-05-09");
  assert.equal(alerts.length, 0);
});

test("deterministic alert ID across runs (same condition → same id)", () => {
  const blocking = reviewFixture({
    suggestion: { ...reviewFixture().suggestion!, ruleHits: [blockingRuleHit] },
  });
  const v = voucherFixture();
  const first = detectComplianceIssues([blocking], [v], "2026-05-09");
  const second = detectComplianceIssues([blocking], [v], "2026-05-10");
  assert.equal(first[0]?.id, second[0]?.id);
});

test("malformed timestamps skipped per-record (don't abort batch)", () => {
  const blocking = reviewFixture({
    id: "r_bad",
    voucherId: "v_bad",
    suggestion: {
      ...reviewFixture().suggestion!,
      voucherId: "v_bad",
      ruleHits: [blockingRuleHit],
    },
  });
  const bad = voucherFixture({ id: "v_bad", createdAt: "not-a-date" });
  const goodApproved = voucherFixture({
    id: "v_approved",
    status: "approved",
    voucherFields: {
      ...voucherFixture().voucherFields,
      supplierVatNumber: undefined,
    },
  });
  const result = detectComplianceIssuesDetailed(
    [blocking],
    [bad, goodApproved],
    "2026-05-09",
  );
  assert.equal(result.alerts.length, 1, "good voucher still produces alert");
  assert.equal(result.alerts[0]?.kind, "missing-supplier-vat");
  assert.ok(result.skipped.length >= 1, "bad voucher in skipped");
});

test("non-UTC timestamp normalizes via UTC roundtrip", () => {
  const blocking = reviewFixture({
    suggestion: { ...reviewFixture().suggestion!, ruleHits: [blockingRuleHit] },
  });
  // 2026-05-01T01:00:00+02:00 is 2026-04-30T23:00:00Z; UTC day = April 30.
  // Against today=2026-05-09 that's 9 days, alert fires.
  const v = voucherFixture({ createdAt: "2026-05-01T01:00:00+02:00" });
  const alerts = detectComplianceIssues([blocking], [v], "2026-05-09");
  assert.equal(alerts.length, 1);
});
