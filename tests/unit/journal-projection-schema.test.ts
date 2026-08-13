import assert from "node:assert/strict";
import { test } from "node:test";

import {
  enrichmentProposalSchema,
  eventTypeSchema,
  journalEntryProjectionSchema,
  lineEnrichmentRecordedPayloadSchema,
  lineEnrichmentSupersededPayloadSchema,
} from "@jpx-accounting/contracts";

test("journalEntryProjectionSchema keeps id required and accepts additive line fields", () => {
  const row = journalEntryProjectionSchema.parse({
    id: "journal_1",
    voucherId: "v1",
    accountNumber: "1930",
    accountName: "Bank",
    description: "x",
    debit: 0,
    credit: 1,
    bookedAt: "2026-03-01T00:00:00.000Z",
    lineId: "ln_1",
    vatCode: "VAT25",
    deductible: true,
  });

  assert.equal(row.id, "journal_1");
  assert.equal(row.lineId, "ln_1");
  assert.throws(() => journalEntryProjectionSchema.parse({ ...row, id: undefined }));
});

test("typed line enrichment contracts are additive and bounded to a line", () => {
  assert.ok(eventTypeSchema.options.includes("LineEnrichmentRecorded"));
  assert.ok(eventTypeSchema.options.includes("LineEnrichmentSuperseded"));

  const recorded = lineEnrichmentRecordedPayloadSchema.parse({
    lineId: "ln_1",
    enrichmentId: "le_1",
    enrichmentType: "project",
    payload: { projectId: "proj_1" },
  });
  const superseded = lineEnrichmentSupersededPayloadSchema.parse({
    lineId: "ln_1",
    priorEnrichmentId: "le_old",
    replacementEnrichmentId: "le_1",
  });

  assert.equal(recorded.lineId, "ln_1");
  assert.equal(superseded.replacementEnrichmentId, "le_1");
});

test("line enrichment proposal arms validate record and supersession intent", () => {
  const record = enrichmentProposalSchema.parse({
    kind: "line_enrichment_record",
    lineId: "ln_1",
    enrichmentType: "project",
    payload: { projectId: "proj_1" },
  });
  const supersede = enrichmentProposalSchema.parse({
    kind: "line_enrichment_supersede",
    lineId: "ln_1",
    priorEnrichmentId: "le_old",
    replacement: { enrichmentType: "project", payload: { projectId: "proj_2" } },
  });

  assert.equal(record.kind, "line_enrichment_record");
  assert.equal(supersede.kind, "line_enrichment_supersede");
});
