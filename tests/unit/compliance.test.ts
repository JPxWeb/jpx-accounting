import assert from "node:assert/strict";
import { test } from "node:test";

import type { ReviewTask, Voucher } from "@jpx-accounting/contracts";
import { detectComplianceIssues } from "@jpx-accounting/domain";

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

test("detectComplianceIssues returns no alerts on fresh, clean data", () => {
  const alerts = detectComplianceIssues([reviewFixture()], [voucherFixture()], "2026-05-02");
  assert.equal(alerts.length, 0);
});

test("stale-blocked rule fires for a needs-review with blocking hit older than 7 days", () => {
  const blocking = reviewFixture({
    suggestion: {
      ...reviewFixture().suggestion!,
      ruleHits: [
        {
          id: "rh1",
          code: "vat-missing",
          title: "Missing supplier VAT",
          severity: "blocking",
          message: "Supplier VAT is required",
          sourceIds: [],
        },
      ],
    },
  });
  const v = voucherFixture({ createdAt: "2026-05-01T00:00:00.000Z" });
  const alerts = detectComplianceIssues([blocking], [v], "2026-05-09");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.kind, "stale-blocked");
  assert.equal(alerts[0]?.targetId, "v1");
  assert.equal(alerts[0]?.severity, "warning");
  assert.equal(alerts[0]?.status, "open");
});

test("stale-blocked does NOT fire on day 7", () => {
  const blocking = reviewFixture({
    suggestion: {
      ...reviewFixture().suggestion!,
      ruleHits: [
        {
          id: "rh1",
          code: "vat-missing",
          title: "Missing supplier VAT",
          severity: "blocking",
          message: "Supplier VAT is required",
          sourceIds: [],
        },
      ],
    },
  });
  const v = voucherFixture({ createdAt: "2026-05-01T00:00:00.000Z" });
  const alerts = detectComplianceIssues([blocking], [v], "2026-05-08");
  assert.equal(alerts.length, 0);
});

test("missing-supplier-vat fires on approved voucher without supplierVatNumber", () => {
  const v = voucherFixture({
    status: "approved",
    voucherFields: { ...voucherFixture().voucherFields, supplierVatNumber: undefined },
  });
  const alerts = detectComplianceIssues([], [v], "2026-05-09");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.kind, "missing-supplier-vat");
  assert.equal(alerts[0]?.targetId, "v1");
});

test("missing-supplier-vat does NOT fire on approved voucher WITH supplierVatNumber", () => {
  const v = voucherFixture({
    status: "approved",
    voucherFields: { ...voucherFixture().voucherFields, supplierVatNumber: "SE556677889901" },
  });
  const alerts = detectComplianceIssues([], [v], "2026-05-09");
  assert.equal(alerts.length, 0);
});

test("both rules fire simultaneously on independent vouchers", () => {
  const stale = reviewFixture({
    id: "r_stale",
    voucherId: "v_stale",
    suggestion: {
      ...reviewFixture().suggestion!,
      voucherId: "v_stale",
      ruleHits: [
        {
          id: "rh1",
          code: "vat-missing",
          title: "Missing supplier VAT",
          severity: "blocking",
          message: "Supplier VAT is required",
          sourceIds: [],
        },
      ],
    },
  });
  const vStale = voucherFixture({ id: "v_stale", createdAt: "2026-05-01T00:00:00.000Z" });
  const vMissingVat = voucherFixture({
    id: "v_missingvat",
    status: "approved",
    voucherFields: { ...voucherFixture().voucherFields, supplierVatNumber: undefined },
  });
  const alerts = detectComplianceIssues([stale], [vStale, vMissingVat], "2026-05-09");
  assert.equal(alerts.length, 2);
  assert.ok(alerts.some((a) => a.kind === "stale-blocked"));
  assert.ok(alerts.some((a) => a.kind === "missing-supplier-vat"));
});

test("detectComplianceIssues produces deterministic alert IDs per (kind, targetId)", () => {
  const blocking = reviewFixture({
    suggestion: {
      ...reviewFixture().suggestion!,
      ruleHits: [
        {
          id: "rh1",
          code: "vat-missing",
          title: "Missing supplier VAT",
          severity: "blocking",
          message: "Supplier VAT is required",
          sourceIds: [],
        },
      ],
    },
  });
  const v = voucherFixture({ createdAt: "2026-05-01T00:00:00.000Z" });
  const first = detectComplianceIssues([blocking], [v], "2026-05-09");
  const second = detectComplianceIssues([blocking], [v], "2026-05-10");
  assert.equal(first[0]?.id, second[0]?.id, "same condition → same alert id across runs");
});

test("daysBetween throws on malformed input rather than returning NaN silently", () => {
  const blocking = reviewFixture({
    suggestion: {
      ...reviewFixture().suggestion!,
      ruleHits: [
        {
          id: "rh1",
          code: "vat-missing",
          title: "Missing supplier VAT",
          severity: "blocking",
          message: "Supplier VAT is required",
          sourceIds: [],
        },
      ],
    },
  });
  const v = voucherFixture({ createdAt: "not-a-date" });
  assert.throws(() => detectComplianceIssues([blocking], [v], "2026-05-09"));
});

test("clock-skew normalized: voucher created late at night still hits stale-blocked on day 8", () => {
  const blocking = reviewFixture({
    suggestion: {
      ...reviewFixture().suggestion!,
      ruleHits: [
        {
          id: "rh1",
          code: "vat-missing",
          title: "Missing supplier VAT",
          severity: "blocking",
          message: "Supplier VAT is required",
          sourceIds: [],
        },
      ],
    },
  });
  // Voucher created at 23:00 on day D, today is D+8 at 00:00 — raw daysBetween
  // would have been 7.04, floored to 7, missing the threshold. Normalized to
  // date-only the diff is exactly 8 days and the rule fires.
  const v = voucherFixture({ createdAt: "2026-05-01T23:00:00.000Z" });
  const alerts = detectComplianceIssues([blocking], [v], "2026-05-09");
  assert.equal(alerts.length, 1);
});
