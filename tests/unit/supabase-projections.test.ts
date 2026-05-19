import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccountingSuggestion, Voucher } from "@jpx-accounting/contracts";
import { buildPostingLines } from "@jpx-accounting/domain";

const voucher: Voucher = {
  id: "voucher_2",
  organizationId: "org_jpx",
  workspaceId: "workspace_main",
  evidencePacketId: "packet_2",
  voucherNumber: "V-1002",
  status: "needs-review",
  accountingMethod: "invoice",
  extractedFields: [],
  voucherFields: {
    description: "Duplicate approve guard",
    grossAmount: 100,
    netAmount: 80,
    vatAmount: 20,
    vatRate: 25,
    currency: "SEK",
  },
  createdAt: new Date().toISOString(),
  createdBy: "user_1",
};

const suggestion: AccountingSuggestion = {
  id: "sug_2",
  voucherId: "voucher_2",
  accountNumber: "6540",
  accountName: "IT-tjänster",
  vatCode: "VAT25",
  confidence: 0.9,
  reasoning: "test",
  kind: "recommendation",
  citations: [],
  ruleHits: [],
};

test("approve produces three posting lines once", () => {
  const lines = buildPostingLines(voucher, suggestion, "approve", "2026-05-19T12:00:00.000Z");
  assert.equal(lines.length, 3);
  const secondApprove = buildPostingLines(voucher, suggestion, "approve", "2026-05-19T12:00:00.000Z");
  assert.equal(secondApprove.length, 3);
});
