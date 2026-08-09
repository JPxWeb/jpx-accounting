import {
  externalReferenceLinkedPayloadSchema,
  inventoryMovementPayloadSchema,
  invoiceRegisteredPayloadSchema,
  lineEnrichmentRecordedPayloadSchema,
  lineEnrichmentSupersededPayloadSchema,
  MAX_PROPOSALS_PER_INTENT,
  tripRegisteredPayloadSchema,
  voucherTagsAddedPayloadSchema,
  voucherTagsRemovedPayloadSchema,
  type AccountingSuggestion,
  type ComplianceAlert,
  type EvidenceContext,
  type EvidenceCreateInput,
  type EvidenceObject,
  type EvidencePacket,
  type EnrichmentProposal,
  type EnrichmentWorkItem,
  type ExternalReferenceProjection,
  type ExtractionResult,
  type LedgerEvent,
  type ReviewDecisionInput,
  type ReviewTask,
  type Voucher,
} from "@jpx-accounting/contracts";

import {
  buildLineEnrichmentsFromEvents,
  buildVoucherTagsFromEvents,
  findActiveExternalReference,
  findActiveLineEnrichment,
  MAX_TAGS_PER_REQUEST,
  MAX_TAGS_PER_VOUCHER,
  type ExternalReferenceEvent,
  type LineEnrichmentEvent,
  type TagDefinition,
  type VoucherTagEvent,
} from "./enrichment-projections";
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
  round2,
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
      postingVoucher: Voucher;
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

export type PrePostEnrichmentPlan = {
  companionEvents: PlannedEvent[];
};

export type ExternalReferencePlan = {
  reference: ExternalReferenceProjection;
  event: PlannedEvent;
};

export type VoucherTagsPlan = {
  events: PlannedEvent[];
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

export class EnrichmentIntentClosedError extends Error {
  constructor(public readonly reviewId: string) {
    super(`Review must remain open to attach enrichment intent: ${reviewId}`);
    this.name = "EnrichmentIntentClosedError";
  }
}

export class EnrichmentLineNotFoundError extends Error {
  constructor(public readonly lineId: string) {
    super(`Enrichment line is not in the posting batch: ${lineId}`);
    this.name = "EnrichmentLineNotFoundError";
  }
}

export class ProjectAssignmentLineNotFoundError extends Error {
  constructor() {
    super("Project assignment requires an eligible cost line.");
    this.name = "ProjectAssignmentLineNotFoundError";
  }
}

export class TripRegistrationLineNotFoundError extends Error {
  constructor() {
    super("Trip registration requires an eligible cost line.");
    this.name = "TripRegistrationLineNotFoundError";
  }
}

export class TripEvidenceNotInPacketError extends Error {
  constructor(public readonly evidenceId: string) {
    super(`Trip evidence is not in the voucher packet: ${evidenceId}`);
    this.name = "TripEvidenceNotInPacketError";
  }
}

export class TripEnrichmentTripNotFoundError extends Error {
  constructor(public readonly tripId: string) {
    super(`Trip line enrichment requires a registered trip: ${tripId}`);
    this.name = "TripEnrichmentTripNotFoundError";
  }
}

export class TripLineAlreadyAssignedError extends Error {
  constructor(
    public readonly lineId: string,
    public readonly tripId: string,
  ) {
    super(`Line ${lineId} is already assigned to trip ${tripId}; supersede the active enrichment first.`);
    this.name = "TripLineAlreadyAssignedError";
  }
}

function validateTripLineReplacement(input: {
  lineId: string;
  enrichmentType: string;
  payload: Record<string, unknown>;
  registeredTripIds: ReadonlySet<string> | undefined;
  lineEnrichmentEvents: LineEnrichmentEvent[] | undefined;
  excludedEnrichmentId?: string;
  sameTripIsIdempotent: boolean;
}): "not_trip" | "valid" | "idempotent" {
  if (input.enrichmentType !== "trip") return "not_trip";

  const trip = tripRegisteredPayloadSchema.safeParse(input.payload);
  if (!trip.success || !input.registeredTripIds?.has(trip.data.tripId)) {
    throw new TripEnrichmentTripNotFoundError(
      trip.success ? trip.data.tripId : String(input.payload.tripId ?? "unknown"),
    );
  }

  const activeTrip = buildLineEnrichmentsFromEvents(input.lineEnrichmentEvents ?? []).find(
    (enrichment) =>
      enrichment.lineId === input.lineId &&
      enrichment.enrichmentType === "trip" &&
      !enrichment.superseded &&
      enrichment.enrichmentId !== input.excludedEnrichmentId,
  );
  if (!activeTrip) return "valid";

  const activeTripId = String(activeTrip.payload.tripId ?? "unknown");
  if (input.sameTripIsIdempotent && activeTripId === trip.data.tripId) return "idempotent";
  throw new TripLineAlreadyAssignedError(input.lineId, activeTripId);
}

export class InvoiceRegistrationLineNotFoundError extends Error {
  constructor() {
    super("Invoice registration requires an eligible posting line.");
    this.name = "InvoiceRegistrationLineNotFoundError";
  }
}

export class InvoiceRegistrationAmountError extends Error {
  constructor(public readonly voucherId: string) {
    super("Invoice registration requires a posted amount greater than zero.");
    this.name = "InvoiceRegistrationAmountError";
  }
}

export class InventoryMovementLineNotFoundError extends Error {
  constructor() {
    super("Inventory movement requires an eligible posting line.");
    this.name = "InventoryMovementLineNotFoundError";
  }
}

export class EnrichmentProposalMultiplicityError extends Error {
  constructor(public readonly kind: string) {
    super(`Pre-post enrichment accepts only one proposal of kind: ${kind}`);
    this.name = "EnrichmentProposalMultiplicityError";
  }
}

function findPrimaryCostLine(postingLines: readonly LedgerLine[]): LedgerLine | undefined {
  return postingLines.find(
    ({ accountNumber, lineId }) =>
      lineId !== undefined &&
      !accountNumber.startsWith("26") &&
      !accountNumber.startsWith("19") &&
      !accountNumber.startsWith("24"),
  );
}

export function bindProjectAssignmentToPrimaryCostLine(
  proposal: Extract<EnrichmentProposal, { kind: "project_assignment" }>,
  postingLines: readonly LedgerLine[],
): Extract<EnrichmentProposal, { kind: "line_enrichment_record" }> {
  const line = findPrimaryCostLine(postingLines);
  if (!line?.lineId) throw new ProjectAssignmentLineNotFoundError();

  return {
    kind: "line_enrichment_record",
    lineId: line.lineId,
    enrichmentType: "project",
    payload: {
      projectId: proposal.projectId,
      ...(proposal.activityCode !== undefined ? { activityCode: proposal.activityCode } : {}),
      ...(proposal.objectCode !== undefined ? { objectCode: proposal.objectCode } : {}),
    },
  };
}

export function assertPrePostEnrichmentIntentSupported(proposals: readonly EnrichmentProposal[]): void {
  if (proposals.length > MAX_PROPOSALS_PER_INTENT) {
    throw new EnrichmentProposalMultiplicityError("intent");
  }
  const singletonKinds = new Set(["invoice_registration", "trip_registration", "quantity_inventory_movement"]);
  const seenSingletonKinds = new Set<string>();
  for (const proposal of proposals) {
    if (
      proposal.kind !== "noop" &&
      proposal.kind !== "project_assignment" &&
      proposal.kind !== "invoice_registration" &&
      proposal.kind !== "trip_registration" &&
      proposal.kind !== "quantity_inventory_movement" &&
      proposal.kind !== "line_enrichment_record"
    ) {
      throw new EnrichmentNotSupportedError(proposal.kind);
    }
    if (singletonKinds.has(proposal.kind)) {
      if (seenSingletonKinds.has(proposal.kind)) {
        throw new EnrichmentProposalMultiplicityError(proposal.kind);
      }
      seenSingletonKinds.add(proposal.kind);
    }
  }
}

export class LineEnrichmentNotActiveError extends Error {
  constructor(public readonly enrichmentId: string) {
    super(`Active line enrichment not found: ${enrichmentId}`);
    this.name = "LineEnrichmentNotActiveError";
  }
}

export class ExternalReferenceNotFoundError extends Error {
  constructor(public readonly refId: string) {
    super(`Active external reference not found: ${refId}`);
    this.name = "ExternalReferenceNotFoundError";
  }
}

export class VoucherTagsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoucherTagsValidationError";
  }
}

export function planExternalReferenceLink(
  voucherId: string,
  input: { url: string; label?: string; actorId: string },
  scope: { organizationId: string; workspaceId: string; now?: string },
): ExternalReferencePlan {
  const refId = createId("ref");
  const occurredAt = scope.now ?? nowIso();
  const payload = externalReferenceLinkedPayloadSchema.parse({
    refId,
    voucherId,
    url: input.url,
    ...(input.label !== undefined ? { label: input.label } : {}),
  });
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

export function planVoucherTagsAppend(
  input: {
    voucherId: string;
    tagIds: string[];
    mode: "add" | "remove";
    existingActiveTagIds: readonly string[];
    tagDefinitions: readonly TagDefinition[];
    actorId: string;
  },
  scope: { organizationId: string; workspaceId: string; now?: string },
): VoucherTagsPlan {
  if (input.tagIds.length === 0 || input.tagIds.length > MAX_TAGS_PER_REQUEST) {
    throw new VoucherTagsValidationError(`Bounded tag request requires 1-${MAX_TAGS_PER_REQUEST} tag ids`);
  }

  const uniqueTagIds = [...new Set(input.tagIds)];
  const registeredTagIds = new Set(input.tagDefinitions.map((tag) => tag.id));
  const unknownTagId = uniqueTagIds.find((tagId) => !registeredTagIds.has(tagId));
  if (unknownTagId) throw new VoucherTagsValidationError(`Tag id is not in the registry: ${unknownTagId}`);

  const activeTagIds = new Set(input.existingActiveTagIds);
  const effectiveTagIds = uniqueTagIds.filter((tagId) =>
    input.mode === "add" ? !activeTagIds.has(tagId) : activeTagIds.has(tagId),
  );
  if (effectiveTagIds.length === 0) return { events: [] };

  if (input.mode === "add" && activeTagIds.size + effectiveTagIds.length > MAX_TAGS_PER_VOUCHER) {
    throw new VoucherTagsValidationError(`Bounded voucher tag limit is ${MAX_TAGS_PER_VOUCHER}`);
  }

  const payloadSchema = input.mode === "add" ? voucherTagsAddedPayloadSchema : voucherTagsRemovedPayloadSchema;
  const payload = payloadSchema.parse({
    voucherId: input.voucherId,
    tagIds: effectiveTagIds,
    actorId: input.actorId,
  });

  return {
    events: [
      {
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        aggregateType: "voucher",
        aggregateId: input.voucherId,
        eventType: input.mode === "add" ? "VoucherTagsAdded" : "VoucherTagsRemoved",
        actorId: input.actorId,
        occurredAt: scope.now ?? nowIso(),
        payload,
      },
    ],
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
  events: Array<Pick<LedgerEvent, "aggregateId" | "eventType" | "payload"> & Partial<Pick<LedgerEvent, "id">>>,
): PostedEnrichmentTargets {
  const postedVoucherIds = new Set<string>();
  const postedLineIds = new Set<string>();

  for (const event of events) {
    if (event.eventType !== "PostedToLedger" && event.eventType !== "VoucherImported") continue;
    postedVoucherIds.add(event.aggregateId);
    const lines = Array.isArray(event.payload.lines) ? event.payload.lines : [];
    for (const [index, line] of lines.entries()) {
      if (typeof line !== "object" || line === null) continue;
      const lineId = (line as { lineId?: unknown }).lineId;
      if (typeof lineId === "string") {
        postedLineIds.add(lineId);
      } else if (event.id !== undefined) {
        postedLineIds.add(`legacy_${event.id}_${index}`);
      }
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
    postingVoucher,
    postingSuggestion,
    lines,
    events,
  };
}

export function planPrePostEnrichment(input: {
  review: ReviewTask;
  proposals: EnrichmentProposal[];
  postingLines: readonly LedgerLine[];
  postingVoucher: Voucher;
  evidenceIds: readonly string[];
  actorId: string;
  organizationId: string;
  workspaceId: string;
}): PrePostEnrichmentPlan {
  if (input.review.status !== "needs-review") {
    throw new EnrichmentIntentClosedError(input.review.id);
  }
  assertPrePostEnrichmentIntentSupported(input.proposals);

  const companionEvents: PlannedEvent[] = [];
  for (const proposal of input.proposals) {
    if (proposal.kind === "noop") continue;
    if (proposal.kind === "invoice_registration") {
      const line = findPrimaryCostLine(input.postingLines);
      if (!line?.lineId) throw new InvoiceRegistrationLineNotFoundError();
      const invoiceId = createId("inv");
      const occurredAt = nowIso();
      const originalAmount = round2(input.postingLines.reduce((sum, postingLine) => sum + postingLine.debit, 0));
      if (originalAmount <= 0) throw new InvoiceRegistrationAmountError(input.postingVoucher.id);
      const registration = invoiceRegisteredPayloadSchema.parse({
        invoiceId,
        direction: proposal.direction,
        counterparty: proposal.counterparty,
        dueDate: proposal.dueDate,
        currency: input.postingVoucher.voucherFields.currency.toUpperCase(),
        originalAmount,
      });
      companionEvents.push(
        {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          aggregateType: "ledger",
          aggregateId: invoiceId,
          eventType: "InvoiceRegistered",
          actorId: input.actorId,
          occurredAt,
          payload: registration,
        },
        {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          aggregateType: "ledger",
          aggregateId: line.lineId,
          eventType: "LineEnrichmentRecorded",
          actorId: input.actorId,
          occurredAt,
          payload: lineEnrichmentRecordedPayloadSchema.parse({
            lineId: line.lineId,
            enrichmentId: createId("le"),
            enrichmentType: "invoice",
            payload: { invoiceId, direction: proposal.direction },
          }),
        },
      );
      continue;
    }
    if (proposal.kind === "trip_registration") {
      const line = findPrimaryCostLine(input.postingLines);
      if (!line?.lineId) throw new TripRegistrationLineNotFoundError();
      if (proposal.evidenceId !== undefined && !input.evidenceIds.includes(proposal.evidenceId)) {
        throw new TripEvidenceNotInPacketError(proposal.evidenceId);
      }
      const occurredAt = nowIso();
      const registration = tripRegisteredPayloadSchema.parse({
        tripId: createId("trip"),
        purpose: proposal.purpose,
        traveler: proposal.traveler,
        startDate: proposal.startDate,
        endDate: proposal.endDate,
        ...(proposal.evidenceId !== undefined ? { evidenceId: proposal.evidenceId } : {}),
        ...(proposal.distanceKm !== undefined ? { distanceKm: proposal.distanceKm } : {}),
      });
      companionEvents.push(
        {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          aggregateType: "ledger",
          aggregateId: registration.tripId,
          eventType: "TripRegistered",
          actorId: input.actorId,
          occurredAt,
          payload: registration,
        },
        {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          aggregateType: "ledger",
          aggregateId: line.lineId,
          eventType: "LineEnrichmentRecorded",
          actorId: input.actorId,
          occurredAt,
          payload: lineEnrichmentRecordedPayloadSchema.parse({
            lineId: line.lineId,
            enrichmentId: createId("le"),
            enrichmentType: "trip",
            payload: registration,
          }),
        },
      );
      continue;
    }
    if (proposal.kind === "quantity_inventory_movement") {
      const line = findPrimaryCostLine(input.postingLines);
      if (!line?.lineId) throw new InventoryMovementLineNotFoundError();
      const occurredAt = nowIso();
      companionEvents.push({
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        aggregateType: "ledger",
        aggregateId: line.lineId,
        eventType: "InventoryMovementRecorded",
        actorId: input.actorId,
        occurredAt,
        payload: inventoryMovementPayloadSchema.parse({
          movementId: createId("mov"),
          skuId: proposal.skuId,
          quantity: proposal.quantity,
          uom: proposal.uom,
          direction: proposal.direction,
          lineId: line.lineId,
          bookedAt: line.bookedAt,
        }),
      });
      continue;
    }
    const lineProposal =
      proposal.kind === "project_assignment"
        ? bindProjectAssignmentToPrimaryCostLine(proposal, input.postingLines)
        : proposal;
    if (lineProposal.kind !== "line_enrichment_record") {
      throw new EnrichmentNotSupportedError(lineProposal.kind);
    }
    if (!input.postingLines.some((line) => line.lineId === lineProposal.lineId)) {
      throw new EnrichmentLineNotFoundError(lineProposal.lineId);
    }

    const payload = lineEnrichmentRecordedPayloadSchema.parse({
      lineId: lineProposal.lineId,
      enrichmentId: createId("le"),
      enrichmentType: lineProposal.enrichmentType,
      payload: lineProposal.payload,
    });
    companionEvents.push({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      aggregateType: "ledger",
      aggregateId: lineProposal.lineId,
      eventType: "LineEnrichmentRecorded",
      actorId: input.actorId,
      occurredAt: nowIso(),
      payload,
    });
  }
  return { companionEvents };
}

export function mergePrePostEnrichmentsIntoReviewDecisionPlan(
  plan: Extract<ReviewDecisionPlan, { kind: "apply" }>,
  companionEvents: PlannedEvent[],
): Extract<ReviewDecisionPlan, { kind: "apply" }>;
export function mergePrePostEnrichmentsIntoReviewDecisionPlan(
  plan: ReviewDecisionPlan,
  companionEvents: PlannedEvent[],
): ReviewDecisionPlan;
export function mergePrePostEnrichmentsIntoReviewDecisionPlan(
  plan: ReviewDecisionPlan,
  companionEvents: PlannedEvent[],
): ReviewDecisionPlan {
  if (plan.kind !== "apply") return plan;
  if (companionEvents.some((event) => event.eventType === "PostedToLedger")) {
    throw new Error("Pre-post companion events must not include PostedToLedger");
  }
  if (companionEvents.length === 0) return plan;
  if (plan.events.filter((event) => event.eventType === "PostedToLedger").length !== 1) {
    throw new Error("Pre-post enrichments require exactly one PostedToLedger event");
  }
  return { ...plan, events: [...plan.events, ...companionEvents] };
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
  registeredTripIds?: ReadonlySet<string>;
  externalReferenceEvents?: ExternalReferenceEvent[];
  lineEnrichmentEvents?: LineEnrichmentEvent[];
  tagEvents?: VoucherTagEvent[];
  tagDefinitions?: readonly TagDefinition[];
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
      const reference = findActiveExternalReference(
        input.externalReferenceEvents ?? [],
        workItem.targetId,
        workItem.proposedChange.refId,
      );
      if (!reference) throw new ExternalReferenceNotFoundError(workItem.proposedChange.refId);
      const plan = planExternalReferenceRemoval(reference, input.actorId, {
        organizationId: workItem.organizationId,
        workspaceId: workItem.workspaceId,
      });
      return { workItem, events: [plan.event] };
    }
    case "voucher_tags_add":
    case "voucher_tags_remove": {
      if (workItem.targetKind !== "voucher") {
        throw new EnrichmentNotSupportedError(workItem.proposedChange.kind);
      }
      const activeTagIds =
        buildVoucherTagsFromEvents(input.tagEvents ?? []).find(
          (projection) => projection.voucherId === workItem.targetId,
        )?.tagIds ?? [];
      const plan = planVoucherTagsAppend(
        {
          voucherId: workItem.targetId,
          tagIds: workItem.proposedChange.tagIds,
          mode: workItem.proposedChange.kind === "voucher_tags_add" ? "add" : "remove",
          existingActiveTagIds: activeTagIds,
          tagDefinitions: input.tagDefinitions ?? [],
          actorId: input.actorId,
        },
        {
          organizationId: workItem.organizationId,
          workspaceId: workItem.workspaceId,
        },
      );
      return { workItem, events: plan.events };
    }
    case "line_enrichment_record": {
      if (workItem.targetKind !== "line" || workItem.proposedChange.lineId !== workItem.targetId) {
        throw new EnrichmentNotSupportedError(workItem.proposedChange.kind);
      }
      const tripValidation = validateTripLineReplacement({
        lineId: workItem.targetId,
        enrichmentType: workItem.proposedChange.enrichmentType,
        payload: workItem.proposedChange.payload,
        registeredTripIds: input.registeredTripIds,
        lineEnrichmentEvents: input.lineEnrichmentEvents,
        sameTripIsIdempotent: true,
      });
      if (tripValidation === "idempotent") {
        return { workItem, events: [] };
      }
      const occurredAt = nowIso();
      const payload = lineEnrichmentRecordedPayloadSchema.parse({
        lineId: workItem.targetId,
        enrichmentId: createId("le"),
        enrichmentType: workItem.proposedChange.enrichmentType,
        payload: workItem.proposedChange.payload,
      });
      return {
        workItem,
        events: [
          {
            organizationId: workItem.organizationId,
            workspaceId: workItem.workspaceId,
            aggregateType: "ledger",
            aggregateId: workItem.targetId,
            eventType: "LineEnrichmentRecorded",
            actorId: input.actorId,
            occurredAt,
            payload,
          },
        ],
      };
    }
    case "line_enrichment_supersede": {
      if (workItem.targetKind !== "line" || workItem.proposedChange.lineId !== workItem.targetId) {
        throw new EnrichmentNotSupportedError(workItem.proposedChange.kind);
      }
      const prior = findActiveLineEnrichment(
        input.lineEnrichmentEvents ?? [],
        workItem.targetId,
        workItem.proposedChange.priorEnrichmentId,
      );
      if (!prior) {
        throw new LineEnrichmentNotActiveError(workItem.proposedChange.priorEnrichmentId);
      }
      validateTripLineReplacement({
        lineId: workItem.targetId,
        enrichmentType: workItem.proposedChange.replacement.enrichmentType,
        payload: workItem.proposedChange.replacement.payload,
        registeredTripIds: input.registeredTripIds,
        lineEnrichmentEvents: input.lineEnrichmentEvents,
        excludedEnrichmentId: prior.enrichmentId,
        sameTripIsIdempotent: false,
      });
      const occurredAt = nowIso();
      const replacementEnrichmentId = createId("le");
      const supersededPayload = lineEnrichmentSupersededPayloadSchema.parse({
        lineId: workItem.targetId,
        priorEnrichmentId: workItem.proposedChange.priorEnrichmentId,
        replacementEnrichmentId,
      });
      const recordedPayload = lineEnrichmentRecordedPayloadSchema.parse({
        lineId: workItem.targetId,
        enrichmentId: replacementEnrichmentId,
        enrichmentType: workItem.proposedChange.replacement.enrichmentType,
        payload: workItem.proposedChange.replacement.payload,
      });
      return {
        workItem,
        events: [
          {
            organizationId: workItem.organizationId,
            workspaceId: workItem.workspaceId,
            aggregateType: "ledger",
            aggregateId: workItem.targetId,
            eventType: "LineEnrichmentSuperseded",
            actorId: input.actorId,
            occurredAt,
            payload: supersededPayload,
          },
          {
            organizationId: workItem.organizationId,
            workspaceId: workItem.workspaceId,
            aggregateType: "ledger",
            aggregateId: workItem.targetId,
            eventType: "LineEnrichmentRecorded",
            actorId: input.actorId,
            occurredAt,
            payload: recordedPayload,
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
