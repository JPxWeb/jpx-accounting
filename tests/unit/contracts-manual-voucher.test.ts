import assert from "node:assert/strict";
import test from "node:test";

import {
  manualVoucherInputSchema,
  manualVoucherResultSchema,
  reviewDecisionEditSchema,
  vatCodeSchema,
  voucherSchema,
  accountingSuggestionSchema,
} from "@jpx-accounting/contracts";

test("vatCodeSchema accepts the rated codes, NA, and RC25", () => {
  for (const code of ["VAT25", "VAT12", "VAT6", "VAT0", "NA", "RC25"]) {
    assert.equal(vatCodeSchema.parse(code), code);
  }
  assert.throws(() => vatCodeSchema.parse("VAT-REVIEW"));
});

test("manualVoucherInputSchema accepts a balanced 2-line entry and rejects an unbalanced one", () => {
  const balanced = manualVoucherInputSchema.parse({
    description: "Utlägg för kontorsmaterial",
    bookedAt: "2026-03-15",
    lines: [
      { accountNumber: "6110", debit: 100, credit: 0 },
      { accountNumber: "2899", debit: 0, credit: 100 },
    ],
  });
  assert.equal(balanced.lines[0]?.vatCode, "NA", "vatCode defaults to NA");

  assert.throws(() =>
    manualVoucherInputSchema.parse({
      description: "Unbalanced",
      bookedAt: "2026-03-15",
      lines: [
        { accountNumber: "6110", debit: 100, credit: 0 },
        { accountNumber: "2899", debit: 0, credit: 50 },
      ],
    }),
  );
});

test("manualVoucherLineSchema rejects a line with both debit and credit set, or neither", () => {
  assert.throws(() =>
    manualVoucherInputSchema.shape.lines.element.parse({ accountNumber: "1930", debit: 10, credit: 10 }),
  );
  assert.throws(() =>
    manualVoucherInputSchema.shape.lines.element.parse({ accountNumber: "1930", debit: 0, credit: 0 }),
  );
});

test("manualVoucherResultSchema shape", () => {
  assert.deepEqual(manualVoucherResultSchema.parse({ voucherId: "v1", reviewId: "r1" }), {
    voucherId: "v1",
    reviewId: "r1",
  });
});

test("reviewDecisionEditSchema accepts an optional 4-digit settlementAccountNumber", () => {
  const parsed = reviewDecisionEditSchema.parse({
    accountNumber: "6110",
    vatCode: "VAT25",
    settlementAccountNumber: "2899",
  });
  assert.equal(parsed.settlementAccountNumber, "2899");
  assert.throws(() =>
    reviewDecisionEditSchema.parse({ accountNumber: "6110", vatCode: "VAT25", settlementAccountNumber: "89" }),
  );
});

test("accountingSuggestionSchema accepts optional direction and manual lines", () => {
  const parsed = accountingSuggestionSchema.parse({
    id: "s1",
    voucherId: "v1",
    accountNumber: "3305",
    accountName: "Försäljning tjänster till land utanför EU",
    vatCode: "VAT0",
    confidence: 1,
    reasoning: "manual",
    citations: [],
    ruleHits: [],
    direction: "revenue",
    lines: [{ accountNumber: "3305", debit: 0, credit: 100, vatCode: "VAT0" }],
  });
  assert.equal(parsed.direction, "revenue");
  assert.equal(parsed.lines?.[0]?.credit, 100);
});

test("voucherSchema accepts a null evidencePacketId and defaults origin to capture", () => {
  const parsed = voucherSchema.parse({
    id: "v1",
    organizationId: "o",
    workspaceId: "w",
    evidencePacketId: null,
    voucherNumber: "V-1001",
    status: "needs-review",
    accountingMethod: "invoice",
    extractedFields: [],
    voucherFields: { currency: "SEK" },
    createdAt: "2026-03-15T00:00:00.000Z",
    createdBy: "u",
  });
  assert.equal(parsed.evidencePacketId, null);
  assert.equal(parsed.origin, "capture");
});
