import assert from "node:assert/strict";
import test from "node:test";

import type { EvidenceCreateInput, ExtractionResult } from "@jpx-accounting/contracts";
import { deriveDeterministicExtraction, MemoryLedgerStore, mergeExtractedFields, today } from "@jpx-accounting/domain";

const legacyCreateInput: EvidenceCreateInput = {
  organizationId: "org_jpx",
  workspaceId: "workspace_main",
  actorId: "user_founder",
  title: "Extraction test receipt",
  originalFilename: "extraction-test.jpg",
  mimeType: "image/jpeg",
  modalities: ["camera"],
};

function refreshFor(filename: string, sizeBytes: number): ExtractionResult {
  return {
    modelId: "prebuilt-invoice",
    fields: deriveDeterministicExtraction({ filename, sizeBytes }, today()),
    extractedAt: new Date().toISOString(),
  };
}

test("mergeExtractedFields: refreshed values win, missing keys retained, new keys appended", () => {
  const existing = [
    { key: "supplierName", label: "Supplier", value: "Old AB", confidence: 0.5, required: true },
    { key: "customNote", label: "Note", value: "keep me", confidence: 0.4, required: false },
  ];
  const refreshed = [
    { key: "supplierName", label: "Supplier", value: "New AB", confidence: 0.9, required: true },
    { key: "grossAmount", label: "Gross amount", value: "500.00", confidence: 0.9, required: true },
  ];
  const merged = mergeExtractedFields(existing, refreshed);
  assert.deepEqual(
    merged.map((field) => [field.key, field.value]),
    [
      ["supplierName", "New AB"],
      ["customNote", "keep me"],
      ["grossAmount", "500.00"],
    ],
  );
});

test("updateEvidenceExtraction merges by key, recomputes fields, and regenerates the suggestion", async () => {
  const store = new MemoryLedgerStore();
  const created = await store.createEvidence(legacyCreateInput);
  assert.equal(created.voucher.voucherFields.grossAmount, 1249, "legacy create precondition");

  const refresh = refreshFor("extraction-test.jpg", 77777);
  const updated = await store.updateEvidenceExtraction(created.evidence.id, refresh);
  assert.ok(updated?.voucher, "refresh must return the voucher context");

  const refreshedGross = Number.parseFloat(refresh.fields.find((field) => field.key === "grossAmount")!.value);
  assert.equal(updated.voucher.voucherFields.grossAmount, refreshedGross, "refreshed gross wins");
  assert.notEqual(updated.voucher.voucherFields.grossAmount, 1249);
  // Description/currency are preserved from the current voucher, not re-derived.
  assert.equal(updated.voucher.voucherFields.description, legacyCreateInput.title);
  assert.equal(updated.voucher.voucherFields.currency, "SEK");

  // Merge by key: refreshed supplier wins; new keys (netAmount et al) appended.
  const supplier = updated.voucher.extractedFields.find((field) => field.key === "supplierName");
  assert.equal(supplier?.value, refresh.fields.find((field) => field.key === "supplierName")?.value);
  assert.ok(updated.voucher.extractedFields.some((field) => field.key === "netAmount"));

  // Suggestion regenerated against the merged voucher.
  assert.ok(updated.review, "review must ride along");
  assert.equal(updated.review.suggestion?.voucherId, created.voucher.id);
  assert.notEqual(updated.review.suggestion?.id, created.review.suggestion?.id, "suggestion must be regenerated");
  const labels = updated.review.provenanceTimeline.map((step) => step.label);
  assert.ok(labels.includes("Fields re-extracted"));
  assert.ok(labels.includes("Suggestion regenerated"));

  // Read models observe the update.
  const context = await store.getEvidenceContext(created.evidence.id);
  assert.equal(context?.voucher?.voucherFields.grossAmount, refreshedGross);
});

test("updateEvidenceExtraction appends exactly two hash-chained events with system actors", async () => {
  const store = new MemoryLedgerStore();
  const created = await store.createEvidence(legacyCreateInput);
  const eventsBefore = await store.getEvents();
  const tail = eventsBefore.at(-1);
  assert.ok(tail);

  const updated = await store.updateEvidenceExtraction(created.evidence.id, refreshFor("extraction-test.jpg", 77777));
  assert.ok(updated?.voucher);

  const eventsAfter = await store.getEvents();
  assert.equal(eventsAfter.length, eventsBefore.length + 2, "exactly two events appended");

  const [refreshedEvt, suggestionEvt] = eventsAfter.slice(-2);
  assert.equal(refreshedEvt?.eventType, "ExtractionRefreshed");
  assert.equal(refreshedEvt?.actorId, "system-extractor");
  assert.equal(refreshedEvt?.aggregateType, "voucher");
  assert.equal(refreshedEvt?.aggregateId, created.voucher.id);
  assert.equal(suggestionEvt?.eventType, "SuggestionGenerated");
  assert.equal(suggestionEvt?.actorId, "system-ai");
  assert.equal(suggestionEvt?.aggregateType, "review");
  assert.equal(suggestionEvt?.aggregateId, created.review.id);

  // Hash chain continuity through both new events.
  assert.equal(refreshedEvt?.previousHash, tail.eventHash);
  assert.equal(suggestionEvt?.previousHash, refreshedEvt?.eventHash);

  // Full-snapshot payload (Rule 13).
  const payload = refreshedEvt?.payload as { evidenceId?: string; modelId?: string; fields?: unknown[] };
  assert.equal(payload.evidenceId, created.evidence.id);
  assert.equal(payload.modelId, "prebuilt-invoice");
  assert.ok(Array.isArray(payload.fields) && payload.fields.length > 0);
});

test("updateEvidenceExtraction on a decided voucher mutates nothing and appends no events", async () => {
  const store = new MemoryLedgerStore();
  const created = await store.createEvidence(legacyCreateInput);
  const approved = await store.applyReviewDecision(created.review.id, "approve", { actorId: "user_founder" });
  assert.equal(approved?.status, "approved");

  const eventsBefore = await store.getEvents();
  const result = await store.updateEvidenceExtraction(created.evidence.id, refreshFor("extraction-test.jpg", 77777));

  assert.ok(result?.voucher, "current context is still returned");
  assert.equal(result.voucher.status, "approved");
  assert.equal(result.voucher.voucherFields.grossAmount, 1249, "decided voucher fields untouched");
  assert.equal((await store.getEvents()).length, eventsBefore.length, "no events appended");

  const context = await store.getEvidenceContext(created.evidence.id);
  assert.equal(context?.voucher?.voucherFields.grossAmount, 1249);
});

test("updateEvidenceExtraction returns undefined for unknown evidence", async () => {
  const store = new MemoryLedgerStore();
  const result = await store.updateEvidenceExtraction("evidence_does_not_exist", refreshFor("x.jpg", 1));
  assert.equal(result, undefined);
});

test("refresh over a file-seeded create is a stable no-op on values (shared seed)", async () => {
  const store = new MemoryLedgerStore();
  const created = await store.createEvidence({
    ...legacyCreateInput,
    originalFilename: "seeded-upload.jpg",
    sizeBytes: 48211,
    blobPath: "evidence-uploads/upload-idem/seeded-upload.jpg",
    uploadId: "upload-idem",
  });

  const updated = await store.updateEvidenceExtraction(created.evidence.id, refreshFor("seeded-upload.jpg", 48211));
  assert.ok(updated?.voucher);
  assert.deepEqual(updated.voucher.voucherFields, created.voucher.voucherFields, "same seed → same voucher fields");
  assert.deepEqual(updated.voucher.extractedFields, created.voucher.extractedFields, "same seed → same extraction");
});
