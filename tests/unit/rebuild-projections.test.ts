import assert from "node:assert/strict";
import { test } from "node:test";

import { replayJournalLinesFromEvents } from "../../scripts/rebuild-projections";

test("replayJournalLinesFromEvents reconstructs lines from PostedToLedger events", () => {
  const voucher = {
    id: "v1",
    voucherFields: {
      grossAmount: 1249,
      netAmount: 999.2,
      vatAmount: 249.8,
      currency: "SEK",
      description: "OpenAI subscription",
    },
  };
  const events = [
    {
      event_type: "EvidenceReceived",
      payload: {},
      occurred_at: "2026-05-01T00:00:00.000Z",
      organization_id: "o",
      workspace_id: "w",
    },
    {
      event_type: "PostedToLedger",
      payload: {
        action: "approve" as const,
        suggestion: {
          id: "s1",
          voucherId: "v1",
          accountNumber: "6540",
          accountName: "IT-tjänster",
          vatCode: "VAT25",
          confidence: 0.9,
          reasoning: "r",
          kind: "recommendation" as const,
          citations: [],
          ruleHits: [],
        },
      },
      aggregate_id: "v1",
      occurred_at: "2026-05-02T00:00:00.000Z",
      organization_id: "o",
      workspace_id: "w",
    },
  ];
  const vouchersById = new Map([["v1", voucher]]);

  const lines = replayJournalLinesFromEvents(events, vouchersById);
  assert.equal(lines.length, 3, "approve emits 3 posting lines (debit, vat, credit)");
  const first = lines[0];
  assert.ok(first, "first line exists");
  assert.equal(first.account_number, "6540");
  assert.equal(Number(first.debit), 999.2);
  assert.equal(first.voucher_id, "v1");
  assert.equal(first.organization_id, "o");
});

test("replayJournalLinesFromEvents skips non-PostedToLedger events", () => {
  const events = [
    {
      event_type: "EvidenceReceived",
      payload: {},
      organization_id: "o",
      workspace_id: "w",
      occurred_at: "2026-05-01T00:00:00.000Z",
    },
  ];
  const lines = replayJournalLinesFromEvents(events, new Map());
  assert.deepEqual(lines, []);
});
