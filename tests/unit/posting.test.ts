import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccountingSuggestion, Voucher } from "@jpx-accounting/contracts";
import { buildPostingLines } from "@jpx-accounting/domain";

const voucher: Voucher = {
  id: "voucher_1",
  organizationId: "org_jpx",
  workspaceId: "workspace_main",
  evidencePacketId: "packet_1",
  voucherNumber: "V-1001",
  status: "needs-review",
  accountingMethod: "invoice",
  extractedFields: [],
  voucherFields: {
    description: "SaaS subscription",
    grossAmount: 1250,
    netAmount: 1000,
    vatAmount: 250,
    vatRate: 25,
    currency: "SEK",
  },
  createdAt: new Date().toISOString(),
  createdBy: "user_1",
};

const suggestion: AccountingSuggestion = {
  id: "sug_1",
  voucherId: "voucher_1",
  accountNumber: "6540",
  accountName: "IT-tjänster",
  vatCode: "VAT25",
  confidence: 0.9,
  reasoning: "test",
  kind: "recommendation",
  citations: [],
  ruleHits: [],
};

test("buildPostingLines creates three lines for approve", () => {
  const lines = buildPostingLines(voucher, suggestion, "approve", "2026-05-19T10:00:00.000Z");
  assert.equal(lines.length, 3);
  assert.equal(lines[1]?.debit, 250);
  assert.equal(lines[1]?.deductible, true);
});

test("buildPostingLines zeroes VAT for book-without-vat", () => {
  const lines = buildPostingLines(voucher, suggestion, "book-without-vat", "2026-05-19T10:00:00.000Z");
  assert.equal(lines[1]?.debit, 0);
  assert.equal(lines[1]?.deductible, false);
});
