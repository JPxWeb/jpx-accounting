import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AccountingSuggestion, ReviewTask, Voucher } from "@jpx-accounting/contracts";
import {
  AUTO_DETECTED_ALERT_KINDS,
  planComplianceMerge,
  planEvidenceCreate,
  planExtractionRefresh,
  planReviewDecision,
} from "../../packages/domain/src/store-planning.ts";

const BLOCKED_REASON = "Mandatory bookkeeping or VAT data must be confirmed before deductible VAT can be approved.";
const BLOCKED_ACTION = "Request more evidence or post without VAT deduction.";

describe("planEvidenceCreate", () => {
  it("numbers vouchers from voucherIndex and emits 4 events with extractor/ai sentinels", () => {
    const plan = planEvidenceCreate(
      {
        title: "Test",
        modalities: ["upload"],
        originalFilename: "x.jpg",
        mimeType: "image/jpeg",
        actorId: "user:test",
      },
      {
        voucherIndex: 0,
        now: "2026-03-15T12:00:00.000Z",
        organizationId: "org_jpx",
        workspaceId: "workspace_main",
      },
    );
    assert.equal(plan.voucher.voucherNumber, "V-1001");
    assert.deepEqual(
      plan.events.map((e) => e.eventType),
      ["EvidenceReceived", "FieldsExtracted", "VoucherCreated", "SuggestionGenerated"],
    );
    assert.equal(plan.events[1]?.actorId, "system-extractor");
    assert.equal(plan.events[3]?.actorId, "system-ai");
    assert.equal(plan.review.suggestedAction, "Approve the proposed posting.");
    for (const event of plan.events) {
      // Planned events must not carry chain fields — stores derive them on append.
      assert.equal((event as { id?: string }).id, undefined);
      assert.equal((event as { previousHash?: string }).previousHash, undefined);
      assert.equal((event as { eventHash?: string }).eventHash, undefined);
      assert.ok(!("id" in event));
      assert.ok(!("previousHash" in event));
      assert.ok(!("eventHash" in event));
    }
  });

  it("sets blocked review copy when rules are blocking", () => {
    // Current buildExtractedFields always emits rule-satisfying fields on create.
    // Pin the Memory blocked literals via planExtractionRefresh (same ternaries
    // as createEvidenceSync) by clearing supplierVatNumber while VAT remains.
    const created = planEvidenceCreate(
      {
        title: "Office supplies",
        modalities: ["upload"],
        originalFilename: "receipt.jpg",
        mimeType: "image/jpeg",
        actorId: "user:test",
      },
      {
        voucherIndex: 1,
        now: "2026-03-15T12:00:00.000Z",
        organizationId: "org_jpx",
        workspaceId: "workspace_main",
      },
    );
    const fields = created.voucher.extractedFields.map((field) =>
      field.key === "supplierVatNumber" ? { ...field, value: "" } : field,
    );
    const plan = planExtractionRefresh(
      created.evidence.id,
      {
        modelId: "prebuilt-invoice",
        extractedAt: "2026-03-15T12:05:00.000Z",
        fields,
      },
      {
        evidence: created.evidence,
        packet: created.packet,
        voucher: created.voucher,
        review: created.review,
        now: "2026-03-15T12:05:00.000Z",
      },
    );
    assert.equal(plan.kind, "apply");
    if (plan.kind !== "apply") throw new Error("unreachable");
    assert.equal(plan.updatedReview?.blockedReason, BLOCKED_REASON);
    assert.equal(plan.updatedReview?.suggestedAction, BLOCKED_ACTION);
  });
});

describe("planReviewDecision", () => {
  it("returns replay when review is already decided", () => {
    const review = {
      id: "r1",
      voucherId: "v1",
      title: "Review V-1001",
      status: "approved",
      suggestedAction: "Approve the proposed posting.",
      provenanceTimeline: [],
    } as ReviewTask;
    const voucher = {
      id: "v1",
      status: "approved",
      organizationId: "org_jpx",
      workspaceId: "workspace_main",
    } as Voucher;
    const plan = planReviewDecision(review, voucher, "approve", { actorId: "user:x" });
    assert.equal(plan.kind, "replay");
    if (plan.kind !== "replay") throw new Error("unreachable");
    assert.equal(plan.review.id, "r1");
    assert.notEqual(plan.review, review);
  });

  it("reject produces decision event without PostedToLedger", () => {
    const voucher = {
      id: "v1",
      organizationId: "org_jpx",
      workspaceId: "workspace_main",
      evidencePacketId: "p1",
      voucherNumber: "V-1001",
      status: "needs-review",
      accountingMethod: "cash",
      extractedFields: [],
      voucherFields: { currency: "SEK", grossAmount: 100, netAmount: 80, vatAmount: 20 },
      createdAt: "2026-03-15T12:00:00.000Z",
      createdBy: "user:x",
    } as Voucher;
    const review = {
      id: "r1",
      voucherId: "v1",
      title: "Review V-1001",
      status: "needs-review",
      suggestedAction: "Approve the proposed posting.",
      provenanceTimeline: [],
    } as ReviewTask;
    const plan = planReviewDecision(
      review,
      voucher,
      "reject",
      {
        actorId: "user:x",
        notes: "duplicate",
      },
      "2026-03-15T13:00:00.000Z",
    );
    assert.equal(plan.kind, "apply");
    if (plan.kind !== "apply") throw new Error("unreachable");
    assert.equal(plan.updatedReview.status, "rejected");
    assert.equal(plan.lines, undefined);
    assert.deepEqual(
      plan.events.map((e) => e.eventType),
      ["ReviewRejected"],
    );
  });

  it("edited approve threads resolveReviewDecisionEdit into PostedToLedger payload", () => {
    const voucher = {
      id: "v1",
      organizationId: "org_jpx",
      workspaceId: "workspace_main",
      evidencePacketId: "p1",
      voucherNumber: "V-1001",
      status: "needs-review",
      accountingMethod: "cash",
      extractedFields: [],
      voucherFields: {
        currency: "SEK",
        description: "Office supplies",
        grossAmount: 1249,
        netAmount: 999.2,
        vatAmount: 249.8,
        receiptDate: "2026-03-01",
      },
      createdAt: "2026-03-15T12:00:00.000Z",
      createdBy: "user:x",
    } as Voucher;
    const suggestion = {
      id: "sug1",
      voucherId: "v1",
      accountNumber: "6540",
      accountName: "IT-tjänster",
      vatCode: "VAT25",
      confidence: 0.86,
      reasoning: "test",
      kind: "recommendation",
      citations: [],
      ruleHits: [],
    } as AccountingSuggestion;
    const review = {
      id: "r1",
      voucherId: "v1",
      title: "Review V-1001",
      status: "needs-review",
      suggestedAction: "Approve the proposed posting.",
      suggestion,
      provenanceTimeline: [],
    } as ReviewTask;
    const edited = {
      accountNumber: "6110",
      accountName: "Kontorsmateriel",
      vatCode: "VAT25",
      grossAmount: 500,
      netAmount: 400,
      vatAmount: 100,
    };
    const plan = planReviewDecision(
      review,
      voucher,
      "approve",
      { actorId: "user:x", edited },
      "2026-03-15T13:00:00.000Z",
    );
    assert.equal(plan.kind, "apply");
    if (plan.kind !== "apply") throw new Error("unreachable");
    assert.equal(plan.updatedReview.status, "approved");
    assert.equal(plan.updatedReview.suggestion?.accountNumber, "6110");
    assert.equal(plan.updatedReview.provenanceTimeline.at(-1)?.label, "Approved with edits");
    assert.ok(plan.lines && plan.lines.length === 3);
    assert.equal(plan.lines?.[0]?.accountNumber, "6110");
    assert.equal(plan.lines?.[0]?.debit, 400);
    assert.deepEqual(
      plan.events.map((e) => e.eventType),
      ["ReviewApproved", "PostedToLedger"],
    );
    assert.deepEqual(plan.events[0]?.payload.edited, edited);
    const postedLines = plan.events[1]?.payload.lines as Array<{ accountNumber: string; debit: number }>;
    assert.equal(postedLines[0]?.accountNumber, "6110");
    assert.equal(postedLines[0]?.debit, 400);
  });
});

describe("planComplianceMerge", () => {
  it("exports AUTO_DETECTED_ALERT_KINDS and resolveIds for missing detections", () => {
    assert.ok(AUTO_DETECTED_ALERT_KINDS.has("stale-blocked"));
    assert.ok(AUTO_DETECTED_ALERT_KINDS.has("missing-supplier-vat"));
    const plan = planComplianceMerge([{ id: "a1" }, { id: "a2" }], [{ id: "a2" } as never]);
    assert.deepEqual(plan.resolveIds, ["a1"]);
    assert.deepEqual(
      plan.upserts.map((a) => a.id),
      ["a2"],
    );
  });
});
