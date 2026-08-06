import type {
  AccountingSuggestion,
  ComplianceAlert,
  EvidenceContext,
  EvidenceCreateInput,
  EvidenceObject,
  EvidencePacket,
  ExtractionResult,
  LedgerEvent,
  ReviewDecisionInput,
  ReviewTask,
  Voucher,
} from "@jpx-accounting/contracts";

import { buildExtractedFields, deriveVoucherFields, guessAccountingMethod } from "./evidence-defaults";
import { buildEventHash } from "./hash-chain";
import { createId, nowIso } from "./ids";
import type { LedgerLine } from "./projections";
import { buildDeterministicSuggestion, evaluateVoucherRules } from "./rules";
import {
  buildPostingLines,
  DEMO_ACTOR_ID,
  mergeExtractedFields,
  recomputeVoucherFields,
  resolveReviewDecisionEdit,
  type ActorAttribution,
  type ReviewAction,
} from "./store";

/** Planned append payload — stores derive id / previousHash / eventHash / digestDate. */
export type PlannedEvent = Omit<LedgerEvent, "id" | "previousHash" | "eventHash" | "digestDate">;

export type EvidenceCreatePlan = {
  evidence: EvidenceObject;
  packet: EvidencePacket;
  voucher: Voucher;
  review: ReviewTask;
  suggestion: AccountingSuggestion;
  events: PlannedEvent[];
};

export type ReviewDecisionPlan =
  | { kind: "replay"; review: ReviewTask }
  | {
      kind: "apply";
      updatedReview: ReviewTask;
      updatedVoucher: Voucher;
      postingSuggestion: AccountingSuggestion | undefined;
      lines: LedgerLine[] | undefined;
      events: PlannedEvent[];
    };

export type ExtractionRefreshPlan =
  | { kind: "unchanged"; context: EvidenceContext }
  | {
      kind: "apply";
      context: EvidenceContext;
      updatedVoucher: Voucher;
      updatedReview: ReviewTask | undefined;
      suggestion: AccountingSuggestion;
      events: PlannedEvent[];
    };

export const AUTO_DETECTED_ALERT_KINDS: ReadonlySet<string> = new Set(["stale-blocked", "missing-supplier-vat"]);

export type ComplianceMergePlan = { upserts: ComplianceAlert[]; resolveIds: string[] };

/**
 * Pure re-entrant planner for `createEvidence` orchestration shared by Memory
 * and Postgres. Regenerates ids on every call (PG chain-fork retries re-enter).
 */
export function planEvidenceCreate(
  input: EvidenceCreateInput & ActorAttribution,
  ctx: { voucherIndex: number; now?: string; organizationId: string; workspaceId: string },
): EvidenceCreatePlan {
  const actorId = input.actorId ?? DEMO_ACTOR_ID;
  const createdAt = ctx.now ?? nowIso();
  const evidenceId = createId("evidence");
  const packetId = createId("packet");
  const voucherId = createId("voucher");

  const evidence: EvidenceObject = {
    id: evidenceId,
    organizationId: ctx.organizationId,
    workspaceId: ctx.workspaceId,
    createdAt,
    createdBy: actorId,
    title: input.title,
    modalities: input.modalities,
    originalFilename: input.originalFilename,
    mimeType: input.mimeType,
    blobPath: input.blobPath ?? `evidence/${evidenceId}/${input.originalFilename}`,
    hash: input.sha256 ?? buildEventHash("file", `${input.originalFilename}:${input.title}:${createdAt}`),
    sizeBytes: input.sizeBytes,
    trustLevel: "user-upload",
  };

  const packet: EvidencePacket = {
    id: packetId,
    evidenceIds: [evidenceId],
    note: input.note,
    voiceTranscript: input.extractedText,
  };

  const extractedFields = buildExtractedFields(input);
  const voucher: Voucher = {
    id: voucherId,
    organizationId: ctx.organizationId,
    workspaceId: ctx.workspaceId,
    evidencePacketId: packetId,
    voucherNumber: `V-${ctx.voucherIndex + 1001}`,
    status: "needs-review",
    accountingMethod: guessAccountingMethod(input),
    extractedFields,
    voucherFields: deriveVoucherFields(extractedFields, input),
    createdAt,
    createdBy: actorId,
  };

  const ruleHits = evaluateVoucherRules(voucher);
  const suggestion = buildDeterministicSuggestion(voucher, ruleHits);
  const blocked = ruleHits.some((rule) => rule.severity === "blocking");
  const review: ReviewTask = {
    id: createId("review"),
    voucherId,
    title: `Review ${voucher.voucherNumber}`,
    status: "needs-review",
    blockedReason: blocked
      ? "Mandatory bookkeeping or VAT data must be confirmed before deductible VAT can be approved."
      : undefined,
    suggestedAction: blocked ? "Request more evidence or post without VAT deduction." : "Approve the proposed posting.",
    suggestion,
    provenanceTimeline: [
      { id: createId("step"), label: "Evidence received", timestamp: createdAt, actor: actorId },
      { id: createId("step"), label: "Fields extracted", timestamp: createdAt, actor: "system-extractor" },
      { id: createId("step"), label: "Rules applied", timestamp: createdAt, actor: "system-rules" },
      { id: createId("step"), label: "Suggestion generated", timestamp: createdAt, actor: "system-ai" },
    ],
  };

  const events: PlannedEvent[] = [
    {
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      aggregateType: "evidence",
      aggregateId: evidenceId,
      eventType: "EvidenceReceived",
      actorId,
      occurredAt: createdAt,
      payload: evidence as unknown as Record<string, unknown>,
    },
    {
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      aggregateType: "voucher",
      aggregateId: voucherId,
      eventType: "FieldsExtracted",
      actorId: "system-extractor",
      occurredAt: createdAt,
      payload: { extractedFields },
    },
    {
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      aggregateType: "voucher",
      aggregateId: voucherId,
      eventType: "VoucherCreated",
      actorId,
      occurredAt: createdAt,
      payload: voucher as unknown as Record<string, unknown>,
    },
    {
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
      aggregateType: "review",
      aggregateId: review.id,
      eventType: "SuggestionGenerated",
      actorId: "system-ai",
      occurredAt: createdAt,
      payload: suggestion as unknown as Record<string, unknown>,
    },
  ];

  return { evidence, packet, voucher, review, suggestion, events };
}

/**
 * Pure re-entrant planner for review decisions. Replay when already decided;
 * otherwise derive edit/posting inputs and planned events without mutating args.
 */
export function planReviewDecision(
  review: ReviewTask,
  voucher: Voucher,
  action: ReviewAction,
  input: ReviewDecisionInput & ActorAttribution,
  now?: string,
): ReviewDecisionPlan {
  if (review.status !== "needs-review") {
    return { kind: "replay", review: { ...review } };
  }

  const actorId = input.actorId ?? DEMO_ACTOR_ID;
  const edited = action !== "reject" ? input.edited : undefined;
  let postingSuggestion = review.suggestion;
  let postingVoucher = voucher;
  if (edited) {
    const resolved = resolveReviewDecisionEdit(voucher, review.suggestion, edited);
    postingSuggestion = resolved.effectiveSuggestion;
    postingVoucher = resolved.effectiveVoucher;
  }

  const occurredAt = now ?? nowIso();
  const newStatus = action === "approve" ? "approved" : action === "reject" ? "rejected" : "booked-without-vat";
  const timelineStep = {
    id: createId("step"),
    label:
      action === "approve"
        ? edited
          ? "Approved with edits"
          : "Review approved"
        : action === "reject"
          ? "Review rejected"
          : edited
            ? "Booked without VAT deduction (edited)"
            : "Booked without VAT deduction",
    timestamp: occurredAt,
    actor: actorId,
  };

  let updatedReview: ReviewTask = {
    ...review,
    status: newStatus,
    provenanceTimeline: [...review.provenanceTimeline, timelineStep],
  };
  const updatedVoucher: Voucher = { ...voucher, status: newStatus };
  if (edited && postingSuggestion) {
    updatedReview = { ...updatedReview, suggestion: postingSuggestion };
  }

  const decisionPayload: Record<string, unknown> = { action };
  if (input.notes !== undefined) decisionPayload.notes = input.notes;
  if (edited) decisionPayload.edited = edited;

  const events: PlannedEvent[] = [
    {
      organizationId: updatedVoucher.organizationId,
      workspaceId: updatedVoucher.workspaceId,
      aggregateType: "review",
      aggregateId: review.id,
      eventType:
        action === "approve" ? "ReviewApproved" : action === "reject" ? "ReviewRejected" : "ReviewBookedWithoutVat",
      actorId,
      occurredAt,
      payload: decisionPayload,
    },
  ];

  let lines: LedgerLine[] | undefined;
  if (action !== "reject" && postingSuggestion) {
    lines = buildPostingLines(postingVoucher, postingSuggestion, action, occurredAt);
    events.push({
      organizationId: updatedVoucher.organizationId,
      workspaceId: updatedVoucher.workspaceId,
      aggregateType: "ledger",
      aggregateId: updatedVoucher.id,
      eventType: "PostedToLedger",
      actorId,
      occurredAt,
      payload: { action, suggestion: postingSuggestion, lines },
    });
  }

  return {
    kind: "apply",
    updatedReview,
    updatedVoucher,
    postingSuggestion,
    lines,
    events,
  };
}

/**
 * Pure re-entrant planner for extraction refresh (Memory/PG steps 1–8).
 * Callers resolve evidence→packet→voucher→review before invoking.
 */
export function planExtractionRefresh(
  evidenceId: string,
  extraction: ExtractionResult,
  ctx: {
    evidence: EvidenceObject;
    packet?: EvidencePacket;
    voucher?: Voucher;
    review?: ReviewTask;
    now?: string;
  },
): ExtractionRefreshPlan {
  const { evidence, packet, voucher, review } = ctx;

  // No linked voucher — return current context without mutation or events.
  if (!voucher) {
    const context: EvidenceContext = { evidence: { ...evidence } };
    if (packet) context.packet = { ...packet };
    return { kind: "unchanged", context };
  }

  // 2. Decided-voucher guard (append-only): return current context unchanged.
  if (voucher.status !== "needs-review") {
    const context: EvidenceContext = {
      evidence: { ...evidence },
      voucher: { ...voucher },
    };
    if (packet) context.packet = { ...packet };
    if (review) context.review = { ...review };
    return { kind: "unchanged", context };
  }

  const occurredAt = ctx.now ?? nowIso();

  // 3. Merge by key; 4. recompute voucher fields preserving description/currency.
  const mergedFields = mergeExtractedFields(voucher.extractedFields, extraction.fields);
  const voucherFields = recomputeVoucherFields(mergedFields, voucher.voucherFields);

  // 5. Immutable replace of the voucher read model.
  const updatedVoucher: Voucher = { ...voucher, extractedFields: mergedFields, voucherFields };

  // 6. Re-run rules, regenerate the suggestion, update the review read model.
  const ruleHits = evaluateVoucherRules(updatedVoucher);
  const suggestion = buildDeterministicSuggestion(updatedVoucher, ruleHits);
  const blocked = ruleHits.some((rule) => rule.severity === "blocking");
  let updatedReview: ReviewTask | undefined;
  if (review) {
    updatedReview = {
      ...review,
      suggestion,
      suggestedAction: blocked
        ? "Request more evidence or post without VAT deduction."
        : "Approve the proposed posting.",
      provenanceTimeline: [
        ...review.provenanceTimeline,
        { id: createId("step"), label: "Fields re-extracted", timestamp: occurredAt, actor: "system-extractor" },
        { id: createId("step"), label: "Suggestion regenerated", timestamp: occurredAt, actor: "system-ai" },
      ],
    };
    if (blocked) {
      updatedReview.blockedReason =
        "Mandatory bookkeeping or VAT data must be confirmed before deductible VAT can be approved.";
    } else {
      delete updatedReview.blockedReason;
    }
  }

  // 7. Planned hash-chained events (full snapshot payload, Rule 13).
  const events: PlannedEvent[] = [
    {
      organizationId: updatedVoucher.organizationId,
      workspaceId: updatedVoucher.workspaceId,
      aggregateType: "voucher",
      aggregateId: updatedVoucher.id,
      eventType: "ExtractionRefreshed",
      actorId: "system-extractor",
      occurredAt,
      payload: {
        evidenceId,
        voucherId: updatedVoucher.id,
        modelId: extraction.modelId,
        extractedAt: extraction.extractedAt,
        fields: mergedFields,
        voucherFields,
      },
    },
  ];
  if (updatedReview) {
    events.push({
      organizationId: updatedVoucher.organizationId,
      workspaceId: updatedVoucher.workspaceId,
      aggregateType: "review",
      aggregateId: updatedReview.id,
      eventType: "SuggestionGenerated",
      actorId: "system-ai",
      occurredAt,
      payload: suggestion as unknown as Record<string, unknown>,
    });
  }

  // 8. Fresh copies for the caller.
  const context: EvidenceContext = {
    evidence: { ...evidence },
    voucher: { ...updatedVoucher },
  };
  if (packet) context.packet = { ...packet };
  if (updatedReview) context.review = { ...updatedReview };

  return {
    kind: "apply",
    context,
    updatedVoucher,
    updatedReview,
    suggestion,
    events,
  };
}

export function planComplianceMerge(
  existingAutoOpen: Array<{ id: string }>,
  detected: ComplianceAlert[],
): ComplianceMergePlan {
  const detectedIds = new Set(detected.map((a) => a.id));
  return {
    upserts: detected,
    resolveIds: existingAutoOpen.filter((r) => !detectedIds.has(r.id)).map((r) => r.id),
  };
}
