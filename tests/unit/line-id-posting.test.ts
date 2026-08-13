import assert from "node:assert/strict";
import { test } from "node:test";

import type { AccountingSuggestion, Voucher } from "@jpx-accounting/contracts";
import { buildPostingLines } from "@jpx-accounting/domain";

const voucher: Voucher = {
  id: "voucher_1",
  organizationId: "org_jpx",
  workspaceId: "workspace_main",
  evidencePacketId: "packet_1",
  voucherNumber: "V-1",
  status: "needs-review",
  accountingMethod: "invoice",
  extractedFields: [],
  voucherFields: {
    grossAmount: 125,
    netAmount: 100,
    vatAmount: 25,
    currency: "SEK",
    description: "Line identity",
  },
  createdAt: "2026-08-09T10:00:00.000Z",
  createdBy: "user:test",
};

const suggestion: AccountingSuggestion = {
  id: "suggestion_1",
  voucherId: voucher.id,
  accountNumber: "6540",
  accountName: "IT-tjänster",
  vatCode: "VAT25",
  confidence: 0.9,
  reasoning: "test",
  kind: "recommendation",
  citations: [],
  ruleHits: [],
};

test("new posting lines receive unique stable line identifiers", () => {
  const lines = buildPostingLines(voucher, suggestion, "approve", "2026-08-09T12:00:00.000Z");
  const lineIds = lines.map((line) => line.lineId);

  assert.ok(lineIds.every((lineId) => typeof lineId === "string" && /^ln_/.test(lineId)));
  assert.equal(new Set(lineIds).size, lines.length);
});
