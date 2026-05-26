import assert from "node:assert/strict";
import { test } from "node:test";

import type { AccountingSuggestion, ReviewTask, Voucher } from "@jpx-accounting/contracts";
import { simulateApprovals } from "@jpx-accounting/domain";

const voucherFixture = (id: string, overrides: Partial<Voucher["voucherFields"]> = {}): Voucher => ({
  id,
  organizationId: "o",
  workspaceId: "w",
  evidencePacketId: "p",
  voucherNumber: `V-${id}`,
  status: "needs-review",
  accountingMethod: "invoice",
  extractedFields: [],
  voucherFields: {
    grossAmount: 1249,
    netAmount: 999.2,
    vatAmount: 249.8,
    vatRate: 25,
    currency: "SEK",
    description: "Test",
    ...overrides,
  },
  createdAt: "2026-05-01T00:00:00.000Z",
  createdBy: "u",
});

const suggestionFixture = (voucherId: string, account = "6540"): AccountingSuggestion => ({
  id: `s_${voucherId}`,
  voucherId,
  accountNumber: account,
  accountName: "IT-tjänster",
  vatCode: "VAT25",
  confidence: 0.9,
  reasoning: "r",
  kind: "recommendation",
  citations: [],
  ruleHits: [],
});

const reviewFixture = (voucherId: string): ReviewTask => ({
  id: `r_${voucherId}`,
  voucherId,
  title: `Review ${voucherId}`,
  status: "needs-review",
  suggestedAction: "Approve",
  suggestion: suggestionFixture(voucherId),
  provenanceTimeline: [],
});

test("simulateApprovals computes balance delta and vat delta for approve", () => {
  const v = voucherFixture("v1");
  const result = simulateApprovals([reviewFixture("v1")], [suggestionFixture("v1")], [v], "approve");
  assert.equal(result.balanceDelta.length, 3);
  const it = result.balanceDelta.find((b) => b.accountNumber === "6540");
  assert.equal(it?.deltaDebit, 999.2);
  const vat = result.balanceDelta.find((b) => b.accountNumber === "2641");
  assert.equal(vat?.deltaDebit, 249.8);
  const bank = result.balanceDelta.find((b) => b.accountNumber === "1930");
  assert.equal(bank?.deltaCredit, 1249);
  assert.deepEqual(result.affectedAccounts.sort(), ["1930", "2641", "6540"]);
  assert.equal(result.vatDelta.find((v) => v.vatCode === "VAT25")?.deltaAmount, 249.8);
});

test("simulateApprovals book-without-vat zeroes the VAT line", () => {
  const v = voucherFixture("v1");
  const result = simulateApprovals([reviewFixture("v1")], [suggestionFixture("v1")], [v], "book-without-vat");
  const vatLine = result.balanceDelta.find((b) => b.accountNumber === "2641");
  assert.equal(vatLine?.deltaDebit, 0);
});

test("simulateApprovals skips reviews whose voucher is missing", () => {
  const result = simulateApprovals(
    [reviewFixture("v1"), reviewFixture("v2")],
    [suggestionFixture("v1"), suggestionFixture("v2")],
    [voucherFixture("v1")],
    "approve",
  );
  assert.equal(result.balanceDelta.length, 3);
});

test("simulateApprovals aggregates across multiple reviews on the same account", () => {
  const result = simulateApprovals(
    [reviewFixture("v1"), reviewFixture("v2")],
    [suggestionFixture("v1"), suggestionFixture("v2")],
    [voucherFixture("v1"), voucherFixture("v2")],
    "approve",
  );
  const it = result.balanceDelta.find((b) => b.accountNumber === "6540");
  assert.equal(it?.deltaDebit, 999.2 * 2);
});
