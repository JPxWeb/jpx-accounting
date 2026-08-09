import type {
  AccountingSuggestion,
  ComplianceAlert,
  EvidenceContext,
  EvidenceCreateInput,
  EvidenceObject,
  EvidencePacket,
  EnrichmentWorkItem,
  ExternalReferenceProjection,
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
  ReviewBlockedError,
  type ActorAttribution,
  type ApprovalGate,
  type ReviewAction,
} from "./store-shared";

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

export type PostPostEnrichmentConfirmPlan = {
  workItem: EnrichmentWorkItem;
  events: PlannedEvent[];
};

export type ExternalReferencePlan = {
  reference: ExternalReferenceProjection;
  event: PlannedEvent;
};

export class EnrichmentTargetNotPostedError extends Error {
  constructor(targetId: string) {
    super(`Enrichment target is not posted: ${targetId}`);
    this.name = "EnrichmentTargetNotPostedError";
  }
}

export class EnrichmentNotSupportedError extends Error {
  constructor(kind: string) {
    super(`Enrichment proposal kind is not supported: ${kind}`);
    this.name = "EnrichmentNotSupportedError";
  }
}

function assertHttpsUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("External reference URL must be a valid https URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("External reference URL must use https");
  }
}

export function planExternalReferenceLink(
  voucherId: string,
  input: { url: string; label?: string; actorId: string },
  scope: { organizationId: string; workspaceId: string; now?: string },
): ExternalReferencePlan {
  assertHttpsUrl(input.url);
  const refId = createId("ref");
  const occurredAt = scope.now ?? nowIso();
  const payload = {
    refId,
    voucherId,
    url: input.url,
    ...(input.label !== undefined ? { label: input.label } : {}),
  };
  return {
    reference: {
      ...payload,
      linkedAt: occurredAt,
      linkedBy: input.actorId,
      removed: false,
    },
    event: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      aggregateType: "voucher",
      aggregateId: voucherId,
      eventType: "ExternalReferenceLinked",
      actorId: input.actorId,
      occurredAt,
      payload,
    },
  };
}

export function planExternalReferenceRemoval(
  reference: ExternalReferenceProjection,
  actorId: string,
  scope: { organizationId: string; workspaceId: string; now?: string },
): ExternalReferencePlan {
  const occurredAt = scope.now ?? nowIso();
  return {
    reference: {
      ...reference,
      removed: true,
      removedAt: occurredAt,
      removedBy: actorId,
    },
    event: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      aggregateType: "voucher",
      aggregateId: reference.voucherId,
      eventType: "ExternalReferenceRemoved",
      actorId,
      occurredAt,
      payload: { refId: reference.refId, voucherId: reference.voucherId },
    },
  };
}

export type PostedEnrichmentTargets = {
  postedVoucherIds: ReadonlySet<string>;
  postedLineIds: ReadonlySet<string>;
};

/**
 * Derives valid enrichment targets from posting events only. Keeping this in
 * the domain prevents Memory and Postgres from disagreeing about whether a
 * line id seen in some unrelated event counts as posted.
 */
export function collectPostedEnrichmentTargets(
  events: Array<Pick<LedgerEvent, "aggregateId" | "eventType" | "payload">>,
): PostedEnrichmentTargets {
  const postedVoucherIds = new Set<string>();
  const postedLineIds = new Set<string>();

  for (const event of events) {
    if (event.eventType !== "PostedToLedger" && event.eventType !== "VoucherImported") continue;
    postedVoucherIds.add(event.aggregateId);
    const lines = Array.isArray(event.payload.lines) ? event.payload.lines : [];
    for (const line of lines) {
      if (typeof line !== "object" || line === null) continue;
      const lineId = (line as { lineId?: unknown }).lineId;
      if (typeof lineId === "string") postedLineIds.add(lineId);
    }
  }

  return { postedVoucherIds, postedLineIds };
}

export function assertEnrichmentTargetPosted(
  target: Pick<EnrichmentWorkItem, "targetKind" | "targetId">,
  postedTargets: PostedEnrichmentTargets,
): void {
  const targetIsPosted =
    target.targetKind === "voucher"
      ? postedTargets.postedVoucherIds.has(target.targetId)
      : postedTargets.postedLineIds.has(target.targetId);

  if (!targetIsPosted) throw new EnrichmentTargetNotPostedError(target.targetId);
}

export const AUTO_DETECTED_ALERT_KINDS: ReadonlySet<string> = new Set(["stale-blocked", "missing-supplier-vat"]);

/** Shared review-copy literals — Memory/Postgres both surface these strings. */
const BLOCKED_REASON = "Mandatory bookkeeping or VAT data must be confirmed before deductible VAT can be approved.";
const SUGGESTED_ACTION_APPROVE = "Approve the proposed posting.";
const SUGGESTED_ACTION_BLOCKED = "Request more evidence or post without VAT deduction.";

export type ComplianceMergePlan = { upserts: ComplianceAlert[]; resolveIds: string[] };

function reviewStatusForAction(action: ReviewAction): ReviewTask["status"] {
  switch (action) {
    case "approve":
      return "approved";
    case "reject":
      return "rejected";
    case "book-without-vat":
      return "booked-without-vat";
  }
}

function reviewDecisionLabel(action: ReviewAction, edited: boolean): string {
  switch (action) {
    case "approve":
      return edited ? "Approved with edits" : "Review approved";
    case "reject":
      return "Review rejected";
    case "book-without-vat":
      return edited ? "Booked without VAT deduction (edited)" : "Booked without VAT deduction";
  }
}

function reviewDecisionEventType(action: ReviewAction): PlannedEvent["eventType"] {
  switch (action) {
    case "approve":
      return "ReviewApproved";
    case "reject":
      return "ReviewRejected";
    case "book-without-vat":
      return "ReviewBookedWithoutVat";
  }
}

function snapshotEvidenceContext(
  evidence: EvidenceObject,
  extras?: {
    packet?: EvidencePacket;
    voucher?: Voucher;
    review?: ReviewTask;
  },
): EvidenceContext {
  const context: EvidenceContext = { evidence: { ...evidence } };
  if (extras?.packet) context.packet = { ...extras.packet };
  if (extras?.voucher) context.voucher = { ...extras.voucher };
  if (extras?.review) context.review = { ...extras.review };
  return context;
}

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
    blockedReason: blocked ? BLOCKED_REASON : undefined,
    suggestedAction: blocked ? SUGGESTED_ACTION_BLOCKED : SUGGESTED_ACTION_APPROVE,
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
  input: ReviewDecisionInput & ActorAttribution & ApprovalGate,
  now?: string,
): ReviewDecisionPlan {
  if (review.status !== "needs-review") {
    return { kind: "replay", review: { ...review } };
  }

  // Wave D′ / P1-1: normal mode honors planner `blockedReason` — approve is
  // refused until rules clear (re-extract) or the reviewer chooses reject /
  // book-without-vat. Demo omits enforceBlockedReason so pins stay byte-identical.
  if (input.enforceBlockedReason && action === "approve" && review.blockedReason) {
    throw new ReviewBlockedError(review.blockedReason);
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
  const newStatus = reviewStatusForAction(action);
  const timelineStep = {
    id: createId("step"),
    label: reviewDecisionLabel(action, Boolean(edited)),
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
      eventType: reviewDecisionEventType(action),
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
 * Plans a human-confirmed enrichment against an already-posted target.
 * This path must never emit PostedToLedger.
 */
export function planPostPostEnrichmentConfirm(input: {
  workItem: EnrichmentWorkItem;
  actorId: string;
  postedVoucherIds: ReadonlySet<string>;
  postedLineIds: ReadonlySet<string>;
}): PostPostEnrichmentConfirmPlan {
  const { workItem } = input;
  assertEnrichmentTargetPosted(workItem, input);

  switch (workItem.proposedChange.kind) {
    case "noop":
      return { workItem, events: [] };
    case "external_reference_link": {
      if (workItem.targetKind !== "voucher") {
        throw new EnrichmentNotSupportedError(workItem.proposedChange.kind);
      }
      const plan = planExternalReferenceLink(
        workItem.targetId,
        {
          url: workItem.proposedChange.url,
          ...(workItem.proposedChange.label !== undefined ? { label: workItem.proposedChange.label } : {}),
          actorId: input.actorId,
        },
        {
          organizationId: workItem.organizationId,
          workspaceId: workItem.workspaceId,
        },
      );
      return { workItem, events: [plan.event] };
    }
    case "external_reference_unlink": {
      if (workItem.targetKind !== "voucher") {
        throw new EnrichmentNotSupportedError(workItem.proposedChange.kind);
      }
      const occurredAt = nowIso();
      return {
        workItem,
        events: [
          {
            organizationId: workItem.organizationId,
            workspaceId: workItem.workspaceId,
            aggregateType: "voucher",
            aggregateId: workItem.targetId,
            eventType: "ExternalReferenceRemoved",
            actorId: input.actorId,
            occurredAt,
            payload: { refId: workItem.proposedChange.refId, voucherId: workItem.targetId },
          },
        ],
      };
    }
    default:
      throw new EnrichmentNotSupportedError((workItem.proposedChange as { kind: string }).kind);
  }
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
    return {
      kind: "unchanged",
      context: snapshotEvidenceContext(evidence, {
        ...(packet !== undefined ? { packet } : {}),
      }),
    };
  }

  // Decided voucher (append-only): return current context unchanged.
  if (voucher.status !== "needs-review") {
    return {
      kind: "unchanged",
      context: snapshotEvidenceContext(evidence, {
        ...(packet !== undefined ? { packet } : {}),
        voucher,
        ...(review !== undefined ? { review } : {}),
      }),
    };
  }

  const occurredAt = ctx.now ?? nowIso();
  const mergedFields = mergeExtractedFields(voucher.extractedFields, extraction.fields);
  const voucherFields = recomputeVoucherFields(mergedFields, voucher.voucherFields);
  const updatedVoucher: Voucher = { ...voucher, extractedFields: mergedFields, voucherFields };

  const ruleHits = evaluateVoucherRules(updatedVoucher);
  const suggestion = buildDeterministicSuggestion(updatedVoucher, ruleHits);
  const blocked = ruleHits.some((rule) => rule.severity === "blocking");

  let updatedReview: ReviewTask | undefined;
  if (review) {
    // Drop prior blockedReason so an unblocked refresh does not keep a stale value.
    const { blockedReason: _priorBlocked, ...reviewBase } = review;
    updatedReview = {
      ...reviewBase,
      suggestion,
      suggestedAction: blocked ? SUGGESTED_ACTION_BLOCKED : SUGGESTED_ACTION_APPROVE,
      ...(blocked ? { blockedReason: BLOCKED_REASON } : {}),
      provenanceTimeline: [
        ...review.provenanceTimeline,
        { id: createId("step"), label: "Fields re-extracted", timestamp: occurredAt, actor: "system-extractor" },
        { id: createId("step"), label: "Suggestion regenerated", timestamp: occurredAt, actor: "system-ai" },
      ],
    };
  }

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

  return {
    kind: "apply",
    context: snapshotEvidenceContext(evidence, {
      ...(packet !== undefined ? { packet } : {}),
      voucher: updatedVoucher,
      ...(updatedReview !== undefined ? { review: updatedReview } : {}),
    }),
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
