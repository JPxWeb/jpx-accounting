import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AccountingSuggestion, ReviewTask, Voucher } from "@jpx-accounting/contracts";
import {
  AUTO_DETECTED_ALERT_KINDS,
  planComplianceMerge,
  planEvidenceCreate,
  planExtractionRefresh,
  planManualVoucher,
  planReviewDecision,
} from "../../packages/domain/src/store-planning.ts";
import { DRAFT_VOUCHER_NUMBER } from "../../packages/domain/src/store-shared.ts";
import { InvalidManualVoucherError, NonOreExactPostingError, postingImbalanceOre } from "@jpx-accounting/domain";

const BLOCKED_REASON = "Mandatory bookkeeping or VAT data must be confirmed before deductible VAT can be approved.";
const BLOCKED_ACTION = "Request more evidence or post without VAT deduction.";

describe("planEvidenceCreate", () => {
  it("assigns the DRAFT_VOUCHER_NUMBER sentinel at intake and emits 4 events with extractor/ai sentinels", () => {
    const plan = planEvidenceCreate(
      {
        title: "Test",
        modalities: ["upload"],
        originalFilename: "x.jpg",
        mimeType: "image/jpeg",
        actorId: "user:test",
      },
      {
        now: "2026-03-15T12:00:00.000Z",
        organizationId: "org_jpx",
        workspaceId: "workspace_main",
      },
    );
    assert.equal(plan.voucher.voucherNumber, DRAFT_VOUCHER_NUMBER);
    assert.deepEqual(
      plan.events.map((e) => e.eventType),
      ["EvidenceReceived", "FieldsExtracted", "VoucherCreated", "SuggestionGenerated"],
    );
    assert.equal(plan.events[1]?.actorId, "system-extractor");
    assert.equal(plan.events[3]?.actorId, "system-ai");
    assert.equal(plan.review.suggestedAction, "Approve the proposed posting.");
    for (const event of plan.events) {
      // Planned events must not carry chain fields — stores derive them on append.
      assert.ok(!("id" in event));
      assert.ok(!("previousHash" in event));
      assert.ok(!("eventHash" in event));
      assert.ok(!("digestDate" in event));
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

  it("assigns V-<n> only on posting via ctx.postedVoucherCount; reject keeps the draft sentinel", () => {
    const voucher = {
      id: "v1",
      organizationId: "org_jpx",
      workspaceId: "workspace_main",
      evidencePacketId: "p1",
      voucherNumber: DRAFT_VOUCHER_NUMBER,
      status: "needs-review",
      accountingMethod: "cash",
      extractedFields: [],
      voucherFields: { currency: "SEK", grossAmount: 125, netAmount: 100, vatAmount: 25 },
      createdAt: "2026-03-15T12:00:00.000Z",
      createdBy: "user:x",
      origin: "capture",
      intakeEvidenceId: null,
    } as Voucher;
    const suggestion = {
      id: "sug1",
      voucherId: "v1",
      accountNumber: "6110",
      accountName: "Kontorsmateriel",
      vatCode: "VAT25",
      confidence: 0.9,
      reasoning: "test",
      kind: "recommendation",
      citations: [],
      ruleHits: [],
    } as AccountingSuggestion;
    const review = {
      id: "r1",
      voucherId: "v1",
      title: `Review ${DRAFT_VOUCHER_NUMBER}`,
      status: "needs-review",
      suggestedAction: "Approve the proposed posting.",
      suggestion,
      provenanceTimeline: [],
    } as ReviewTask;

    const approved = planReviewDecision(review, voucher, "approve", { actorId: "user:x" }, { postedVoucherCount: 3 });
    if (approved.kind !== "apply") throw new Error("unreachable");
    assert.equal(approved.updatedVoucher.voucherNumber, "V-1004");
    // The draft-derived review title follows the voucher onto the ledger, so an
    // archived/posted review never reads "Utkast" (KFR E.1).
    assert.equal(approved.updatedReview.title, "Review V-1004");

    const bookedWithoutVat = planReviewDecision(
      review,
      voucher,
      "book-without-vat",
      { actorId: "user:x" },
      { postedVoucherCount: 3 },
    );
    if (bookedWithoutVat.kind !== "apply") throw new Error("unreachable");
    assert.equal(
      bookedWithoutVat.updatedVoucher.voucherNumber,
      "V-1004",
      "book-without-vat posts, so it earns a number too",
    );

    const rejected = planReviewDecision(review, voucher, "reject", { actorId: "user:x" }, { postedVoucherCount: 3 });
    if (rejected.kind !== "apply") throw new Error("unreachable");
    assert.equal(rejected.updatedVoucher.voucherNumber, DRAFT_VOUCHER_NUMBER, "rejected drafts never burn a V-number");
    assert.equal(rejected.updatedReview.title, `Review ${DRAFT_VOUCHER_NUMBER}`);
  });

  it("never renumbers a voucher that already carries a real number (replay-safe)", () => {
    const voucher = {
      id: "v1",
      organizationId: "org_jpx",
      workspaceId: "workspace_main",
      evidencePacketId: "p1",
      voucherNumber: "V-1002",
      status: "approved",
      accountingMethod: "cash",
      extractedFields: [],
      voucherFields: { currency: "SEK", grossAmount: 125, netAmount: 100, vatAmount: 25 },
      createdAt: "2026-03-15T12:00:00.000Z",
      createdBy: "user:x",
      origin: "capture",
      intakeEvidenceId: null,
    } as Voucher;
    const review = {
      id: "r1",
      voucherId: "v1",
      title: "Review V-1002",
      status: "approved",
      suggestedAction: "Approve the proposed posting.",
      provenanceTimeline: [],
    } as ReviewTask;
    const plan = planReviewDecision(review, voucher, "approve", { actorId: "user:x" }, { postedVoucherCount: 7 });
    assert.equal(plan.kind, "replay", "an already-decided review replays and never re-mints a number");
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
      origin: "capture",
      intakeEvidenceId: null,
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
      { now: "2026-03-15T13:00:00.000Z" },
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
      origin: "capture",
      intakeEvidenceId: null,
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
      { now: "2026-03-15T13:00:00.000Z" },
    );
    assert.equal(plan.kind, "apply");
    if (plan.kind !== "apply") throw new Error("unreachable");
    assert.equal(plan.updatedReview.status, "approved");
    // Default postedVoucherCount is 0 when omitted — the first posting is V-1001.
    assert.equal(plan.updatedVoucher.voucherNumber, "V-1001");
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

  it("threads an edited settlementAccountNumber through to the credit leg", () => {
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
        grossAmount: 500,
        netAmount: 400,
        vatAmount: 100,
        receiptDate: "2026-03-01",
      },
      createdAt: "2026-03-15T12:00:00.000Z",
      createdBy: "user:x",
      origin: "capture",
      intakeEvidenceId: null,
    } as Voucher;
    const review = {
      id: "r1",
      voucherId: "v1",
      title: "Review V-1001",
      status: "needs-review",
      suggestedAction: "Approve the proposed posting.",
      suggestion: {
        id: "sug1",
        voucherId: "v1",
        accountNumber: "6110",
        accountName: "Kontorsmateriel",
        vatCode: "VAT25",
        confidence: 0.9,
        reasoning: "test",
        kind: "recommendation",
        citations: [],
        ruleHits: [],
      } as AccountingSuggestion,
      provenanceTimeline: [],
    } as ReviewTask;
    const plan = planReviewDecision(
      review,
      voucher,
      "approve",
      { actorId: "user:x", edited: { accountNumber: "6110", vatCode: "VAT25", settlementAccountNumber: "2899" } },
      { now: "2026-03-15T13:00:00.000Z" },
    );
    assert.equal(plan.kind, "apply");
    if (plan.kind !== "apply") throw new Error("unreachable");
    assert.equal(plan.lines?.length, 3);
    const creditLeg = plan.lines?.at(-1);
    assert.equal(creditLeg?.accountNumber, "2899", "settlement override must replace the default 1930 bank leg");
    assert.equal(creditLeg?.credit, 500);
  });

  it("accepts an edit carrying vatCode RC25 and posts the reverse-charge shape", () => {
    const voucher = {
      id: "v1",
      organizationId: "org_jpx",
      workspaceId: "workspace_main",
      evidencePacketId: "p1",
      voucherNumber: "V-1001",
      status: "needs-review",
      accountingMethod: "invoice",
      extractedFields: [],
      voucherFields: {
        currency: "SEK",
        description: "EU-tjänst",
        grossAmount: 1000,
        netAmount: 1000,
        vatAmount: 250,
        receiptDate: "2026-03-01",
      },
      createdAt: "2026-03-15T12:00:00.000Z",
      createdBy: "user:x",
      origin: "capture",
      intakeEvidenceId: null,
    } as Voucher;
    const review = {
      id: "r1",
      voucherId: "v1",
      title: "Review V-1001",
      status: "needs-review",
      suggestedAction: "Approve the proposed posting.",
      suggestion: {
        id: "sug1",
        voucherId: "v1",
        accountNumber: "6540",
        accountName: "IT-tjänster",
        vatCode: "VAT25",
        confidence: 0.9,
        reasoning: "test",
        kind: "recommendation",
        citations: [],
        ruleHits: [],
      } as AccountingSuggestion,
      provenanceTimeline: [],
    } as ReviewTask;
    const plan = planReviewDecision(
      review,
      voucher,
      "approve",
      { actorId: "user:x", edited: { accountNumber: "6540", vatCode: "RC25" } },
      { now: "2026-03-15T13:00:00.000Z" },
    );
    assert.equal(plan.kind, "apply");
    if (plan.kind !== "apply") throw new Error("unreachable");
    assert.equal(plan.updatedReview.suggestion?.vatCode, "RC25");
    assert.equal(plan.lines?.length, 4, "RC25 posts the 4-line reverse-charge entry");
    assert.equal(plan.lines?.[2]?.accountNumber, "2614");
  });

  it("bypasses buildPostingLines for a manual-origin voucher and posts its lines verbatim", () => {
    const voucher = {
      id: "v1",
      organizationId: "org_jpx",
      workspaceId: "workspace_main",
      evidencePacketId: null,
      // Manual entries are drafts at intake exactly like captured ones (KFR E.1):
      // the real number comes from the posting branch below.
      voucherNumber: DRAFT_VOUCHER_NUMBER,
      status: "needs-review",
      accountingMethod: "invoice",
      extractedFields: [],
      voucherFields: { currency: "SEK", description: "Utlägg", transactionDate: "2026-03-20" },
      createdAt: "2026-03-20T09:00:00.000Z",
      createdBy: "user:x",
      origin: "manual",
      intakeEvidenceId: null,
    } as Voucher;
    const review = {
      id: "r1",
      voucherId: "v1",
      title: "Review V-1001",
      status: "needs-review",
      suggestedAction: "Approve the manual entry.",
      suggestion: {
        id: "s1",
        voucherId: "v1",
        accountNumber: "6110",
        accountName: "Kontorsmateriel",
        vatCode: "NA",
        confidence: 1,
        reasoning: "manual",
        kind: "recommendation",
        citations: [],
        ruleHits: [],
        lines: [
          { accountNumber: "6110", debit: 100, credit: 0, vatCode: "NA" },
          { accountNumber: "2899", debit: 0, credit: 100, vatCode: "NA" },
        ],
      },
      provenanceTimeline: [],
    } as ReviewTask;

    // A client-supplied edit must be ignored, not applied or rejected.
    const plan = planReviewDecision(review, voucher, "approve", {
      actorId: "user:x",
      edited: { accountNumber: "9999", vatCode: "VAT25" },
    });
    assert.equal(plan.kind, "apply");
    if (plan.kind !== "apply") throw new Error("unreachable");
    // Manual vouchers earn their V-number on the SAME posting branch as captured
    // ones — one shared sequence, no parallel manual numbering (KFR E.1).
    assert.equal(plan.updatedVoucher.voucherNumber, "V-1001");
    assert.equal(plan.lines?.length, 2);
    assert.equal(plan.lines?.[0]?.accountNumber, "6110");
    assert.equal(plan.lines?.[0]?.debit, 100);
    assert.equal(plan.lines?.[1]?.accountNumber, "2899");
    assert.equal(plan.updatedReview.provenanceTimeline.at(-1)?.label, "Review approved", "not 'Approved with edits'");
  });

  it("carries each manual line's own vatCode into the posted ledger line", () => {
    const voucher = {
      id: "v1",
      organizationId: "org_jpx",
      workspaceId: "workspace_main",
      evidencePacketId: null,
      voucherNumber: "V-1001",
      status: "needs-review",
      accountingMethod: "invoice",
      extractedFields: [],
      voucherFields: { currency: "SEK", description: "Inköp", transactionDate: "2026-03-20" },
      createdAt: "2026-03-20T09:00:00.000Z",
      createdBy: "user:x",
      origin: "manual",
      intakeEvidenceId: null,
    } as Voucher;
    const review = {
      id: "r1",
      voucherId: "v1",
      title: "Review V-1001",
      status: "needs-review",
      suggestedAction: "Approve the manual entry.",
      suggestion: {
        id: "s1",
        voucherId: "v1",
        accountNumber: "6110",
        accountName: "Kontorsmateriel",
        vatCode: "VAT25",
        confidence: 1,
        reasoning: "manual",
        kind: "recommendation",
        citations: [],
        ruleHits: [],
        // Per-line VAT codes differ — the bypass must not flatten them.
        lines: [
          { accountNumber: "6110", debit: 100, credit: 0, vatCode: "VAT25" },
          { accountNumber: "2641", debit: 25, credit: 0, vatCode: "VAT25" },
          { accountNumber: "1930", debit: 0, credit: 125, vatCode: "NA" },
        ],
      },
      provenanceTimeline: [],
    } as ReviewTask;
    const plan = planReviewDecision(
      review,
      voucher,
      "approve",
      { actorId: "user:x" },
      { now: "2026-03-20T10:00:00.000Z" },
    );
    assert.equal(plan.kind, "apply");
    if (plan.kind !== "apply") throw new Error("unreachable");
    assert.deepEqual(
      plan.lines?.map((line) => line.vatCode),
      ["VAT25", "VAT25", "NA"],
    );
    // The accounting date comes from the business event, never the decision click.
    assert.deepEqual(new Set(plan.lines?.map((line) => line.bookedAt)), new Set(["2026-03-20"]));
  });

  it("never posts a rejected manual-origin voucher", () => {
    const voucher = {
      id: "v1",
      organizationId: "org_jpx",
      workspaceId: "workspace_main",
      evidencePacketId: null,
      voucherNumber: "V-1001",
      status: "needs-review",
      accountingMethod: "invoice",
      extractedFields: [],
      voucherFields: { currency: "SEK", description: "Utlägg", transactionDate: "2026-03-20" },
      createdAt: "2026-03-20T09:00:00.000Z",
      createdBy: "user:x",
      origin: "manual",
      intakeEvidenceId: null,
    } as Voucher;
    const review = {
      id: "r1",
      voucherId: "v1",
      title: "Review V-1001",
      status: "needs-review",
      suggestedAction: "Approve the manual entry.",
      suggestion: {
        id: "s1",
        voucherId: "v1",
        accountNumber: "6110",
        accountName: "Kontorsmateriel",
        vatCode: "NA",
        confidence: 1,
        reasoning: "manual",
        kind: "recommendation",
        citations: [],
        ruleHits: [],
        lines: [
          { accountNumber: "6110", debit: 100, credit: 0, vatCode: "NA" },
          { accountNumber: "2899", debit: 0, credit: 100, vatCode: "NA" },
        ],
      },
      provenanceTimeline: [],
    } as ReviewTask;
    const plan = planReviewDecision(
      review,
      voucher,
      "reject",
      { actorId: "user:x" },
      { now: "2026-03-20T10:00:00.000Z" },
    );
    assert.equal(plan.kind, "apply");
    if (plan.kind !== "apply") throw new Error("unreachable");
    assert.equal(plan.lines, undefined);
    assert.deepEqual(
      plan.events.map((e) => e.eventType),
      ["ReviewRejected"],
    );
  });

  it("re-validates the öre balance of manual lines at approval time, not only at creation", () => {
    const voucher = {
      id: "v1",
      organizationId: "org_jpx",
      workspaceId: "workspace_main",
      evidencePacketId: null,
      voucherNumber: "V-1001",
      status: "needs-review",
      accountingMethod: "invoice",
      extractedFields: [],
      voucherFields: { currency: "SEK", description: "Utlägg", transactionDate: "2026-03-20" },
      createdAt: "2026-03-20T09:00:00.000Z",
      createdBy: "user:x",
      origin: "manual",
      intakeEvidenceId: null,
    } as Voucher;
    // A tampered/corrupted stored suggestion must not slip an unbalanced entry
    // into the ledger — buildManualPostingLines re-asserts the invariant.
    const review = {
      id: "r1",
      voucherId: "v1",
      title: "Review V-1001",
      status: "needs-review",
      suggestedAction: "Approve the manual entry.",
      suggestion: {
        id: "s1",
        voucherId: "v1",
        accountNumber: "6110",
        accountName: "Kontorsmateriel",
        vatCode: "NA",
        confidence: 1,
        reasoning: "manual",
        kind: "recommendation",
        citations: [],
        ruleHits: [],
        lines: [
          { accountNumber: "6110", debit: 101, credit: 0, vatCode: "NA" },
          { accountNumber: "2899", debit: 0, credit: 100, vatCode: "NA" },
        ],
      },
      provenanceTimeline: [],
    } as ReviewTask;
    assert.throws(() => planReviewDecision(review, voucher, "approve", { actorId: "user:x" }));
  });

  it("refuses to post manual lines carrying a sub-öre amount that sums to a balanced öre total", () => {
    const voucher = {
      id: "v1",
      organizationId: "org_jpx",
      workspaceId: "workspace_main",
      evidencePacketId: null,
      voucherNumber: "V-1001",
      status: "needs-review",
      accountingMethod: "invoice",
      extractedFields: [],
      voucherFields: { currency: "SEK", description: "Utlägg", transactionDate: "2026-03-20" },
      createdAt: "2026-03-20T09:00:00.000Z",
      createdBy: "user:x",
      origin: "manual",
      intakeEvidenceId: null,
    } as Voucher;
    // Constructed directly at the planner level, bypassing planManualVoucher's
    // 422 gate — the shape any OTHER future writer (edit endpoint, migration,
    // store bug) could put on the suggestion. 100.003 vs 100 is BALANCED in
    // integer öre, so assertBalancedPosting alone would happily post it.
    const review = {
      id: "r1",
      voucherId: "v1",
      title: "Review V-1001",
      status: "needs-review",
      suggestedAction: "Approve the manual entry.",
      suggestion: {
        id: "s1",
        voucherId: "v1",
        accountNumber: "6110",
        accountName: "Kontorsmateriel",
        vatCode: "NA",
        confidence: 1,
        reasoning: "manual",
        kind: "recommendation",
        citations: [],
        ruleHits: [],
        lines: [
          { accountNumber: "6110", debit: 100.003, credit: 0, vatCode: "NA" },
          { accountNumber: "2899", debit: 0, credit: 100, vatCode: "NA" },
        ],
      },
      provenanceTimeline: [],
    } as ReviewTask;
    assert.equal(
      postingImbalanceOre(review.suggestion!.lines!),
      0,
      "precondition: the balance invariant alone does NOT catch this",
    );
    assert.throws(
      () => planReviewDecision(review, voucher, "approve", { actorId: "user:x" }),
      (error: unknown) => error instanceof NonOreExactPostingError,
    );
  });
});

describe("planManualVoucher", () => {
  const input = {
    actorId: "user:x",
    description: "Utlägg för kontorsmaterial",
    bookedAt: "2026-03-20",
    lines: [
      { accountNumber: "6110", debit: 100, credit: 0, vatCode: "NA" as const },
      { accountNumber: "2899", debit: 0, credit: 100, vatCode: "NA" as const },
    ],
  };
  const ctx = {
    organizationId: "org_jpx",
    workspaceId: "workspace_main",
    now: "2026-03-20T09:00:00.000Z",
  };

  it("creates a needs-review voucher with origin manual, no evidence packet, and verbatim lines on the suggestion", () => {
    const plan = planManualVoucher(input, ctx);
    assert.equal(plan.voucher.origin, "manual");
    assert.equal(plan.voucher.evidencePacketId, null);
    assert.equal(plan.voucher.status, "needs-review");
    // KFR E.1: manual entries are drafts at intake — no intake-time numbering,
    // so they can never collide with the captured-voucher sequence.
    assert.equal(plan.voucher.voucherNumber, DRAFT_VOUCHER_NUMBER);
    assert.equal(plan.review.status, "needs-review");
    assert.deepEqual(plan.review.suggestion?.lines, input.lines);
    assert.equal(plan.events.map((e) => e.eventType).join(","), "VoucherCreated,SuggestionGenerated");
  });

  it("titles the review from the description, never from the draft voucher number", () => {
    const plan = planManualVoucher(input, ctx);
    // KFR E.4: `Review ${voucherNumber}` would render the literal
    // "Review Utkast" in the queue, since a manual entry is a draft at intake.
    assert.equal(plan.review.title, `Manual entry: ${input.description}`);
    assert.ok(!plan.review.title.includes(DRAFT_VOUCHER_NUMBER));
  });

  it("keeps the description-derived title through approval (nothing to repair at posting time)", () => {
    const plan = planManualVoucher(input, ctx);
    const decided = planReviewDecision(
      plan.review,
      plan.voucher,
      "approve",
      { actorId: "user:x" },
      { postedVoucherCount: 7 },
    );
    if (decided.kind !== "apply") throw new Error("unreachable");
    assert.equal(decided.updatedVoucher.voucherNumber, "V-1008");
    assert.equal(decided.updatedReview.title, `Manual entry: ${input.description}`);
  });

  it("rejects lines that fail the exact-öre balance check", () => {
    const skewed = {
      ...input,
      lines: [
        { accountNumber: "6110", debit: 100.003, credit: 0, vatCode: "NA" as const },
        { accountNumber: "2899", debit: 0, credit: 100, vatCode: "NA" as const },
      ],
    };
    assert.throws(
      () => planManualVoucher(skewed, ctx),
      (error: unknown) => error instanceof InvalidManualVoucherError,
    );
  });

  it("rejects a genuine öre-level imbalance", () => {
    const unbalanced = {
      ...input,
      lines: [
        { accountNumber: "6110", debit: 100.01, credit: 0, vatCode: "NA" as const },
        { accountNumber: "2899", debit: 0, credit: 100, vatCode: "NA" as const },
      ],
    };
    assert.throws(
      () => planManualVoucher(unbalanced, ctx),
      (error: unknown) => error instanceof InvalidManualVoucherError && /do not balance to the öre/.test(error.message),
    );
  });

  // Booking-date gate (KFR E.4 review). Without it a future bookedAt reaches
  // `voucherFields.transactionDate`, where `deriveBookedAt` SILENTLY discards it
  // at approval and books the entry on the approval day instead — a data
  // substitution no surface reveals, and manual reviews have no Edit action to
  // repair it. Same policy as R13's edited-bookedAt guard, one step earlier.
  it("rejects a bookedAt in the future rather than letting deriveBookedAt swallow it", () => {
    // Two days past ctx.now, so it clears the one-day timezone-skew slack.
    const future = { ...input, bookedAt: "2026-03-22" };
    assert.throws(
      () => planManualVoucher(future, ctx),
      (error: unknown) => error instanceof InvalidManualVoucherError && /must not be in the future/.test(error.message),
    );
  });

  it("rejects a bookedAt that matches the wire regex but is not a real calendar day", () => {
    // `manualVoucherInputSchema` only enforces /^\d{4}-\d{2}-\d{2}$/, and
    // `deriveBookedAt` skips non-calendar candidates just as silently.
    const impossible = { ...input, bookedAt: "2026-02-31" };
    assert.throws(
      () => planManualVoucher(impossible, ctx),
      (error: unknown) =>
        error instanceof InvalidManualVoucherError && /valid YYYY-MM-DD calendar day/.test(error.message),
    );
  });

  it("accepts today's date (the skew slack keeps a client one calendar day ahead out of 422)", () => {
    const today = { ...input, bookedAt: "2026-03-20" };
    assert.equal(planManualVoucher(today, ctx).voucher.voucherFields.transactionDate, "2026-03-20");
    const skewed = { ...input, bookedAt: "2026-03-21" };
    assert.equal(planManualVoucher(skewed, ctx).voucher.voucherFields.transactionDate, "2026-03-21");
  });

  it("accepts a past date and posts the approved lines on it, not on the approval day", () => {
    const backdated = { ...input, bookedAt: "2026-02-14" };
    const plan = planManualVoucher(backdated, ctx);
    const decided = planReviewDecision(
      plan.review,
      plan.voucher,
      "approve",
      { actorId: "user:x" },
      // Approved months later: the posting must still carry the business date.
      { now: "2026-05-04T11:00:00.000Z", postedVoucherCount: 0 },
    );
    if (decided.kind !== "apply") throw new Error("unreachable");
    assert.equal(decided.lines?.length, 2);
    for (const line of decided.lines ?? []) {
      assert.equal(line.bookedAt, "2026-02-14");
    }
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
