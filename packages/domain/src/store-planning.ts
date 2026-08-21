import type {
  AccountingSuggestion,
  ComplianceAlert,
  EvidenceContext,
  EvidenceCreateInput,
  EvidenceObject,
  EvidencePacket,
  ExtractionResult,
  LedgerEvent,
  ManualVoucherInput,
  ReviewDecisionInput,
  ReviewTask,
  Voucher,
} from "@jpx-accounting/contracts";

import { defaultCoaTemplate, findCoaAccount } from "./coa/registry";
import { buildExtractedFields, deriveVoucherFields, guessAccountingMethod } from "./evidence-defaults";
import { buildEventHash } from "./hash-chain";
import { createId, nowIso } from "./ids";
import { isOreExact, postingImbalanceOre } from "./posting-invariants";
import type { LedgerLine } from "./projections";
import { buildDeterministicSuggestion, evaluateVoucherRules } from "./rules";
import {
  buildManualPostingLines,
  buildPostingLines,
  DEMO_ACTOR_ID,
  DRAFT_VOUCHER_NUMBER,
  InvalidManualVoucherError,
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
  ctx: { now?: string; organizationId: string; workspaceId: string },
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
    // KFR E.1: intake never mints a number — `planReviewDecision` does, at the
    // instant the voucher posts. See DRAFT_VOUCHER_NUMBER.
    voucherNumber: DRAFT_VOUCHER_NUMBER,
    status: "needs-review",
    accountingMethod: guessAccountingMethod(input),
    extractedFields,
    voucherFields: deriveVoucherFields(extractedFields, input),
    createdAt,
    createdBy: actorId,
    origin: "capture",
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

export type ManualVoucherPlan = { voucher: Voucher; review: ReviewTask; events: PlannedEvent[] };

/**
 * Pure re-entrant planner for `createManualVoucher` (KFR Phase B / D2).
 * Mirrors `planEvidenceCreate`'s shape but skips evidence/packet entirely:
 * the voucher is `origin: "manual"` with `evidencePacketId: null`, and its
 * review's suggestion carries the verbatim lines the reviewer typed —
 * `planReviewDecision` detects `voucher.origin === "manual"` and posts
 * them unchanged at approval time (buildManualPostingLines).
 */
export function planManualVoucher(
  input: ManualVoucherInput & { actorId: string },
  ctx: { now?: string; organizationId: string; workspaceId: string },
): ManualVoucherPlan {
  // Exact-öre gate BEFORE any id/event is derived: the wire schema only
  // enforces ±0.005 (float noise tolerance), not the real invariant.
  //
  // Per-line precision first, via the shared `isOreExact` predicate: a sub-öre
  // amount (100.003 against a 100 credit) rounds away in `postingImbalanceOre`
  // and reports a balanced entry, so balance alone would let it through. Caught
  // again at the posting boundary by `buildManualPostingLines`; here it is a
  // client-correctable 422 rather than an invariant violation.
  for (const line of input.lines) {
    for (const [name, value] of [
      ["debit", line.debit],
      ["credit", line.credit],
    ] as const) {
      if (!isOreExact(value)) {
        throw new InvalidManualVoucherError(
          `Manual voucher line on account ${line.accountNumber} has a ${name} (${value}) that is not öre-exact (at most two decimals).`,
        );
      }
    }
  }
  const imbalance = postingImbalanceOre(input.lines);
  if (imbalance !== 0) {
    throw new InvalidManualVoucherError(
      `Manual voucher lines do not balance to the öre (Σdebit − Σcredit = ${(imbalance / 100).toFixed(2)} kr).`,
    );
  }

  const actorId = input.actorId;
  const createdAt = ctx.now ?? nowIso();
  const voucherId = createId("voucher");
  const firstLine = input.lines[0]!;
  const firstAccount = findCoaAccount(defaultCoaTemplate, firstLine.accountNumber);

  const voucher: Voucher = {
    id: voucherId,
    organizationId: ctx.organizationId,
    workspaceId: ctx.workspaceId,
    evidencePacketId: null,
    // KFR E.1: same draft sentinel as capture intake. Manual entries share the
    // ONE posting-time sequence (`planReviewDecision`) rather than running a
    // parallel intake-time counter that would collide with captured vouchers.
    voucherNumber: DRAFT_VOUCHER_NUMBER,
    status: "needs-review",
    // Manual entries carry no cash/invoice distinction — "invoice" is a
    // fixed, documented default (the schema requires a value).
    accountingMethod: "invoice",
    extractedFields: [],
    voucherFields: {
      description: input.description,
      transactionDate: input.bookedAt,
      currency: "SEK",
    },
    createdAt,
    createdBy: actorId,
    origin: "manual",
  };

  const suggestion: AccountingSuggestion = {
    id: createId("sug"),
    voucherId,
    accountNumber: firstLine.accountNumber,
    accountName: firstAccount?.name ?? `Konto ${firstLine.accountNumber}`,
    vatCode: firstLine.vatCode,
    confidence: 1,
    reasoning: "Manual journal entry — lines entered directly by a reviewer.",
    kind: "recommendation",
    citations: [],
    ruleHits: [],
    // Defensive copy: the suggestion is stored and later posted VERBATIM, so it
    // must not alias an array the caller can still mutate after planning.
    lines: [...input.lines],
  };

  const review: ReviewTask = {
    id: createId("review"),
    voucherId,
    title: `Review ${voucher.voucherNumber}`,
    status: "needs-review",
    suggestedAction: "Approve the manual entry.",
    suggestion,
    provenanceTimeline: [{ id: createId("step"), label: "Manual entry created", timestamp: createdAt, actor: actorId }],
  };

  const events: PlannedEvent[] = [
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
      actorId,
      occurredAt: createdAt,
      payload: suggestion as unknown as Record<string, unknown>,
    },
  ];

  return { voucher, review, events };
}

/**
 * Pure re-entrant planner for review decisions. Replay when already decided;
 * otherwise derive edit/posting inputs and planned events without mutating args.
 *
 * `ctx.postedVoucherCount` is the workspace's current count of NATIVE posted
 * vouchers (`isPostedVoucherStatus`), read by the caller immediately before
 * planning — under the workspace advisory lock in Postgres, so two concurrent
 * approvals can never observe the same count and mint the same `V-<n>`. It is
 * only consulted on a branch that actually posts; omitted it defaults to 0.
 */
export function planReviewDecision(
  review: ReviewTask,
  voucher: Voucher,
  action: ReviewAction,
  input: ReviewDecisionInput & ActorAttribution & ApprovalGate,
  ctx: { now?: string; postedVoucherCount?: number } = {},
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
  // KFR D2: manual-origin vouchers bypass edit resolution and
  // buildPostingLines entirely — approval always posts the lines exactly as
  // authored. A client-supplied `edited` payload is silently ignored (not
  // an error — just inapplicable) rather than validated against a
  // single-account suggestion shape that doesn't describe a manual entry.
  const isManual = voucher.origin === "manual";
  const edited = action !== "reject" && !isManual ? input.edited : undefined;
  let postingSuggestion = review.suggestion;
  let postingVoucher = voucher;
  let settlementAccountNumber: string | undefined;
  if (edited) {
    const resolved = resolveReviewDecisionEdit(voucher, review.suggestion, edited);
    postingSuggestion = resolved.effectiveSuggestion;
    postingVoucher = resolved.effectiveVoucher;
    settlementAccountNumber = resolved.effectiveSettlementAccountNumber;
  }

  const occurredAt = ctx.now ?? nowIso();
  const newStatus = reviewStatusForAction(action);
  const timelineStep = {
    id: createId("step"),
    label: reviewDecisionLabel(action, Boolean(edited)),
    timestamp: occurredAt,
    actor: actorId,
  };

  // Posting lines are derived BEFORE the read models because they are what
  // decides whether this decision actually posts — and therefore whether the
  // voucher earns its number (KFR E.1 / G8).
  let lines: LedgerLine[] | undefined;
  if (action !== "reject") {
    if (isManual) {
      const manualLines = postingSuggestion?.lines;
      if (!manualLines) {
        throw new Error(
          `Manual-origin voucher ${voucher.id} has a review with no verbatim lines (invariant violation).`,
        );
      }
      lines = buildManualPostingLines(voucher, manualLines, occurredAt);
    } else if (postingSuggestion) {
      lines = buildPostingLines(postingVoucher, postingSuggestion, action, occurredAt, undefined, {
        // exactOptionalPropertyTypes: an absent override must be an absent key,
        // not an explicit `undefined`.
        ...(settlementAccountNumber !== undefined ? { settlementAccountNumber } : {}),
      });
    }
  }

  // Posting-time numbering (KFR E.1 / G8): the voucher only earns its real
  // `V-<n>` the instant it actually posts. Reject never posts, so it keeps
  // whatever voucherNumber it already had (DRAFT_VOUCHER_NUMBER at intake) —
  // rejected drafts never burn a number. The count is read by the caller
  // immediately before planning, under the workspace lock in Postgres.
  const postedVoucherNumber = lines ? `V-${(ctx.postedVoucherCount ?? 0) + 1001}` : voucher.voucherNumber;
  // The draft-derived review label must not survive onto a posted entry — an
  // archived review reading "Review Utkast" would be an audit-trail lie.
  // Guarded on the EXACT planner-generated draft label so a curated title (the
  // demo seed's "Approve AI subscription posting") is never clobbered.
  const draftReviewTitle = `Review ${DRAFT_VOUCHER_NUMBER}`;
  const postedReviewTitle = lines && review.title === draftReviewTitle ? `Review ${postedVoucherNumber}` : review.title;

  let updatedReview: ReviewTask = {
    ...review,
    status: newStatus,
    title: postedReviewTitle,
    provenanceTimeline: [...review.provenanceTimeline, timelineStep],
  };
  const updatedVoucher: Voucher = { ...voucher, status: newStatus, voucherNumber: postedVoucherNumber };
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

  if (lines) {
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
