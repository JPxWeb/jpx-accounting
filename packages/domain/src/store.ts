import type {
  AccountingSuggestion,
  AssistantSession,
  CompanySettings,
  ComplianceAlert,
  CloseRun,
  EvidenceComposeInput,
  EvidenceCreateInput,
  EvidenceCreateResult,
  EvidenceObject,
  EvidencePacket,
  LedgerEvent,
  ReportBundle,
  ReviewDecisionInput,
  ReviewTask,
  SimulationRequest,
  SimulationRun,
  Voucher,
  WorkspaceSnapshot,
} from "@jpx-accounting/contracts";

import { buildAssistantScaffold } from "./assistant";
import { detectComplianceIssues } from "./compliance";
import { buildExtractedFields, guessAccountingMethod, initialLedgerLines } from "./evidence-defaults";
import { buildJournal, buildBalances, buildVat } from "./projections";
import { buildDeterministicSuggestion, evaluateVoucherRules } from "./rules";
import { buildEventHash } from "./hash-chain";
import { createId, nowIso, today } from "./ids";
import { simulateApprovals } from "./simulation";

type LedgerLine = Parameters<typeof buildJournal>[0][number];
export type ReviewAction = "approve" | "reject" | "book-without-vat";

/**
 * Thrown when an API caller references review IDs that don't exist in the
 * scope. Distinguished from generic Error so the HTTP layer maps to 404
 * instead of catch-all 500 (CONVENTIONS Rule 16).
 */
export class ReviewNotFoundError extends Error {
  constructor(public readonly missingIds: string[]) {
    super(`Review(s) not found in this workspace: ${missingIds.join(", ")}`);
    this.name = "ReviewNotFoundError";
  }
}

export interface LedgerStore {
  createEvidence(input: EvidenceCreateInput): Promise<EvidenceCreateResult>;
  composeEvidence(input: EvidenceComposeInput): Promise<EvidencePacket>;
  getEvidenceContext(
    evidenceId: string,
  ): Promise<{ evidence: EvidenceObject; packet?: EvidencePacket; voucher?: Voucher } | undefined>;
  findReviewByVoucher(voucherId: string): Promise<ReviewTask | undefined>;
  getReviewFeed(): Promise<ReviewTask[]>;
  getReports(): Promise<ReportBundle>;
  getSnapshot(): Promise<WorkspaceSnapshot>;
  getEvents(): Promise<LedgerEvent[]>;
  suggestVoucher(voucherId: string): Promise<AccountingSuggestion | undefined>;
  applyReviewDecision(
    reviewId: string,
    action: ReviewAction,
    input: ReviewDecisionInput,
  ): Promise<ReviewTask | undefined>;
  answerAssistantQuestion(question: string): Promise<AssistantSession>;
  runSimulation(input: SimulationRequest): Promise<SimulationRun>;
  getCloseRun(): Promise<CloseRun>;
  refreshComplianceAlerts(): Promise<ComplianceAlert[]>;
  getCompanySettings(): Promise<CompanySettings | null>;
  putCompanySettings(input: CompanySettings): Promise<CompanySettings>;
}

const MEMORY_ALERT_CAP = 500;
const AUTO_DETECTED_KINDS = new Set(["stale-blocked", "missing-supplier-vat"]);

const defaultOrganizationId = "org_jpx";
const defaultWorkspaceId = "workspace_main";

export function buildPostingLines(
  voucher: Voucher,
  suggestion: AccountingSuggestion,
  action: "approve" | "book-without-vat",
  occurredAt: string,
): LedgerLine[] {
  const amount = voucher.voucherFields.grossAmount ?? 0;
  const netAmount = voucher.voucherFields.netAmount ?? amount;
  const vatAmount = action === "book-without-vat" ? 0 : (voucher.voucherFields.vatAmount ?? 0);
  const description = voucher.voucherFields.description ?? "Reviewed voucher";

  return [
    {
      voucherId: voucher.id,
      accountNumber: suggestion.accountNumber,
      accountName: suggestion.accountName,
      description,
      debit: netAmount,
      credit: 0,
      vatCode: suggestion.vatCode,
      bookedAt: occurredAt,
      deductible: action !== "book-without-vat",
    },
    {
      voucherId: voucher.id,
      accountNumber: "2641",
      accountName: "Debiterad ingående moms",
      description: `${description} VAT`,
      debit: vatAmount,
      credit: 0,
      vatCode: suggestion.vatCode,
      bookedAt: occurredAt,
      deductible: action !== "book-without-vat",
    },
    {
      voucherId: voucher.id,
      accountNumber: "1930",
      accountName: "Företagskonto",
      description,
      debit: 0,
      credit: amount,
      vatCode: "NA",
      bookedAt: occurredAt,
      deductible: false,
    },
  ];
}

export class MemoryLedgerStore implements LedgerStore {
  private readonly evidence = new Map<string, EvidenceObject>();
  private readonly evidencePackets = new Map<string, EvidencePacket>();
  private readonly vouchers = new Map<string, Voucher>();
  private readonly reviews = new Map<string, ReviewTask>();
  private readonly suggestions = new Map<string, AccountingSuggestion>();
  private readonly evidenceIdToPacketId = new Map<string, string>();
  private readonly packetIdToVoucherId = new Map<string, string>();
  private readonly voucherIdToReviewId = new Map<string, string>();
  private readonly events: LedgerEvent[] = [];
  private readonly ledgerLines: LedgerLine[] = initialLedgerLines();
  private readonly assistantExamples: AssistantSession[] = [];
  private alerts: ComplianceAlert[] = [
    {
      id: "alert_vat_1",
      title: "Representation review queue",
      source: "Skatteverket / internal policy",
      detectedAt: nowIso(),
      impactSummary:
        "Two receipts look like representation and should be checked against attendee and VAT-limit rules.",
      kind: "representation-review",
      severity: "warning",
      status: "open",
    },
  ];
  private companySettings: CompanySettings | null = null;

  constructor() {
    const seededEvidence = this.createEvidenceSync({
      organizationId: defaultOrganizationId,
      workspaceId: defaultWorkspaceId,
      actorId: "user_founder",
      title: "OpenAI subscription invoice",
      originalFilename: "openai-march-2026.pdf",
      mimeType: "application/pdf",
      modalities: ["pdf", "upload"],
      extractedText: "OpenAI March 2026 subscription invoice",
    });

    const seededReviewId = this.voucherIdToReviewId.get(seededEvidence.voucherId);
    const review = seededReviewId ? this.reviews.get(seededReviewId) : undefined;
    if (review) {
      review.title = "Approve AI subscription posting";
    }

    this.assistantExamples.push({
      id: createId("assistant"),
      question: "Can we deduct VAT on this invoice right away?",
      answer:
        "The invoice looks deductible, but the system still requires a human approval because deductible VAT should only be posted after invoice requirements are confirmed.",
      status: "grounded",
      citations: review?.suggestion?.citations ?? [],
    });
  }

  private appendEvent(event: Omit<LedgerEvent, "id" | "eventHash" | "previousHash" | "digestDate">) {
    const previousHash = this.events.at(-1)?.eventHash ?? "GENESIS";
    const digestDate = new Date().toISOString().slice(0, 10);
    const payload = JSON.stringify(event.payload);

    const fullEvent: LedgerEvent = {
      ...event,
      id: createId("evt"),
      previousHash,
      eventHash: buildEventHash(previousHash, payload),
      digestDate,
    };

    this.events.push(fullEvent);
    return fullEvent;
  }

  async createEvidence(input: EvidenceCreateInput): Promise<EvidenceCreateResult> {
    return this.createEvidenceSync(input);
  }

  private createEvidenceSync(input: EvidenceCreateInput): EvidenceCreateResult {
    const createdAt = nowIso();
    const evidenceId = createId("evidence");
    const packetId = createId("packet");
    const voucherId = createId("voucher");

    const evidence: EvidenceObject = {
      id: evidenceId,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      createdAt,
      createdBy: input.actorId,
      title: input.title,
      modalities: input.modalities,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      blobPath: `evidence/${evidenceId}/${input.originalFilename}`,
      hash: buildEventHash("file", `${input.originalFilename}:${input.title}:${createdAt}`),
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
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      evidencePacketId: packetId,
      voucherNumber: `V-${this.vouchers.size + 1001}`,
      status: "needs-review",
      accountingMethod: guessAccountingMethod(input),
      extractedFields,
      voucherFields: {
        supplierName: extractedFields.find((field) => field.key === "supplierName")?.value,
        supplierVatNumber: extractedFields.find((field) => field.key === "supplierVatNumber")?.value,
        invoiceNumber: extractedFields.find((field) => field.key === "invoiceNumber")?.value,
        receiptDate: extractedFields.find((field) => field.key === "receiptDate")?.value,
        transactionDate: extractedFields.find((field) => field.key === "transactionDate")?.value,
        description: input.title,
        grossAmount: 1249,
        netAmount: 999.2,
        vatAmount: 249.8,
        vatRate: 25,
        currency: "SEK",
      },
      createdAt,
      createdBy: input.actorId,
    };

    const ruleHits = evaluateVoucherRules(voucher);
    const suggestion = buildDeterministicSuggestion(voucher, ruleHits);
    const review: ReviewTask = {
      id: createId("review"),
      voucherId,
      title: `Review ${voucher.voucherNumber}`,
      status: "needs-review",
      blockedReason: ruleHits.some((rule) => rule.severity === "blocking")
        ? "Mandatory bookkeeping or VAT data must be confirmed before deductible VAT can be approved."
        : undefined,
      suggestedAction: ruleHits.some((rule) => rule.severity === "blocking")
        ? "Request more evidence or post without VAT deduction."
        : "Approve the proposed posting.",
      suggestion,
      provenanceTimeline: [
        { id: createId("step"), label: "Evidence received", timestamp: createdAt, actor: input.actorId },
        { id: createId("step"), label: "Fields extracted", timestamp: createdAt, actor: "system-extractor" },
        { id: createId("step"), label: "Rules applied", timestamp: createdAt, actor: "system-rules" },
        { id: createId("step"), label: "Suggestion generated", timestamp: createdAt, actor: "system-ai" },
      ],
    };

    this.evidence.set(evidenceId, evidence);
    this.evidencePackets.set(packetId, packet);
    this.vouchers.set(voucherId, voucher);
    this.reviews.set(review.id, review);
    this.suggestions.set(voucherId, suggestion);
    this.evidenceIdToPacketId.set(evidenceId, packetId);
    this.packetIdToVoucherId.set(packetId, voucherId);
    this.voucherIdToReviewId.set(voucherId, review.id);

    this.appendEvent({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      aggregateType: "evidence",
      aggregateId: evidenceId,
      eventType: "EvidenceReceived",
      actorId: input.actorId,
      occurredAt: createdAt,
      payload: evidence,
    });

    this.appendEvent({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      aggregateType: "voucher",
      aggregateId: voucherId,
      eventType: "FieldsExtracted",
      actorId: "system-extractor",
      occurredAt: createdAt,
      payload: { extractedFields },
    });

    this.appendEvent({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      aggregateType: "voucher",
      aggregateId: voucherId,
      eventType: "VoucherCreated",
      actorId: input.actorId,
      occurredAt: createdAt,
      payload: voucher,
    });

    this.appendEvent({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      aggregateType: "review",
      aggregateId: review.id,
      eventType: "SuggestionGenerated",
      actorId: "system-ai",
      occurredAt: createdAt,
      payload: suggestion,
    });

    return { evidence, packet, voucher, review, voucherId };
  }

  async composeEvidence(input: EvidenceComposeInput): Promise<EvidencePacket> {
    const packet: EvidencePacket = {
      id: createId("packet"),
      evidenceIds: input.evidenceIds,
      note: input.note,
      voiceTranscript: input.voiceTranscript,
    };
    this.evidencePackets.set(packet.id, packet);

    let voucherIdToRelink: string | undefined;
    for (const eid of input.evidenceIds) {
      const previousPacketId = this.evidenceIdToPacketId.get(eid);
      if (previousPacketId) {
        const linkedVoucherId = this.packetIdToVoucherId.get(previousPacketId);
        if (linkedVoucherId && !voucherIdToRelink) {
          voucherIdToRelink = linkedVoucherId;
        }
      }
      this.evidenceIdToPacketId.set(eid, packet.id);
    }

    if (voucherIdToRelink) {
      this.packetIdToVoucherId.set(packet.id, voucherIdToRelink);
      const voucher = this.vouchers.get(voucherIdToRelink);
      if (voucher && voucher.evidencePacketId !== packet.id) {
        this.vouchers.set(voucherIdToRelink, { ...voucher, evidencePacketId: packet.id });
      }
    }

    return packet;
  }

  async getEvidenceContext(evidenceId: string): Promise<
    | {
        evidence: EvidenceObject;
        packet?: EvidencePacket;
        voucher?: Voucher;
      }
    | undefined
  > {
    const evidence = this.evidence.get(evidenceId);
    if (!evidence) return undefined;

    const packetId = this.evidenceIdToPacketId.get(evidenceId);
    const packet = packetId ? this.evidencePackets.get(packetId) : undefined;
    const voucherId = packetId ? this.packetIdToVoucherId.get(packetId) : undefined;
    const voucher = voucherId ? this.vouchers.get(voucherId) : undefined;

    return {
      evidence,
      ...(packet ? { packet } : {}),
      ...(voucher ? { voucher } : {}),
    };
  }

  async findReviewByVoucher(voucherId: string): Promise<ReviewTask | undefined> {
    const reviewId = this.voucherIdToReviewId.get(voucherId);
    return reviewId ? this.reviews.get(reviewId) : undefined;
  }

  async getReviewFeed(): Promise<ReviewTask[]> {
    return [...this.reviews.values()].sort((left, right) => right.id.localeCompare(left.id));
  }

  async getReports(): Promise<ReportBundle> {
    return {
      journal: buildJournal(this.ledgerLines),
      balances: buildBalances(this.ledgerLines),
      vat: buildVat(this.ledgerLines),
    };
  }

  async getSnapshot(): Promise<WorkspaceSnapshot> {
    return {
      evidence: [...this.evidence.values()],
      vouchers: [...this.vouchers.values()],
      reviews: await this.getReviewFeed(),
      reports: await this.getReports(),
      assistantExamples: this.assistantExamples,
      closeRun: await this.getCloseRun(),
      alerts: this.alerts,
    };
  }

  async getEvents(): Promise<LedgerEvent[]> {
    return [...this.events];
  }

  async suggestVoucher(voucherId: string): Promise<AccountingSuggestion | undefined> {
    const voucher = this.vouchers.get(voucherId);
    if (!voucher) return undefined;

    const ruleHits = evaluateVoucherRules(voucher);
    const suggestion = buildDeterministicSuggestion(voucher, ruleHits);
    this.suggestions.set(voucherId, suggestion);
    return suggestion;
  }

  async applyReviewDecision(
    reviewId: string,
    action: ReviewAction,
    input: ReviewDecisionInput,
  ): Promise<ReviewTask | undefined> {
    const review = this.reviews.get(reviewId);
    if (!review) return undefined;

    const voucher = this.vouchers.get(review.voucherId);
    if (!voucher) return undefined;
    // Review decisions are single-use mutations; replayed requests should not post duplicate ledger lines.
    if (review.status !== "needs-review") return review;

    const occurredAt = nowIso();
    review.status = action === "approve" ? "approved" : action === "reject" ? "rejected" : "booked-without-vat";
    voucher.status = review.status;
    review.provenanceTimeline.push({
      id: createId("step"),
      label:
        action === "approve"
          ? "Review approved"
          : action === "reject"
            ? "Review rejected"
            : "Booked without VAT deduction",
      timestamp: occurredAt,
      actor: input.actorId,
    });

    this.appendEvent({
      organizationId: voucher.organizationId,
      workspaceId: voucher.workspaceId,
      aggregateType: "review",
      aggregateId: reviewId,
      eventType: action === "approve" ? "ReviewApproved" : "ReviewRejected",
      actorId: input.actorId,
      occurredAt,
      payload: { action, notes: input.notes },
    });

    if (action !== "reject" && review.suggestion) {
      this.ledgerLines.push(...buildPostingLines(voucher, review.suggestion, action, occurredAt));

      this.appendEvent({
        organizationId: voucher.organizationId,
        workspaceId: voucher.workspaceId,
        aggregateType: "ledger",
        aggregateId: voucher.id,
        eventType: "PostedToLedger",
        actorId: input.actorId,
        occurredAt,
        payload: { action, suggestion: review.suggestion },
      });
    }

    return review;
  }

  async answerAssistantQuestion(question: string): Promise<AssistantSession> {
    const answer = buildAssistantScaffold(question);
    this.assistantExamples.unshift(answer);
    return answer;
  }

  async runSimulation(input: SimulationRequest): Promise<SimulationRun> {
    // Dedup at boundary (Rule 23): Postgres .in() dedupes server-side; Memory
    // must match for parity (Rule 11).
    const reviewIds = [...new Set(input.reviewIds)];
    const requestedReviews = reviewIds.map((id) => this.reviews.get(id)).filter((r): r is ReviewTask => Boolean(r));
    if (requestedReviews.length !== reviewIds.length) {
      const found = new Set(requestedReviews.map((r) => r.id));
      throw new ReviewNotFoundError(reviewIds.filter((id) => !found.has(id)));
    }
    const requestedVouchers = requestedReviews
      .map((r) => this.vouchers.get(r.voucherId))
      .filter((v): v is Voucher => Boolean(v));
    const requestedSuggestions = requestedReviews
      .map((r) => r.suggestion)
      .filter((s): s is AccountingSuggestion => Boolean(s));

    const { balanceDelta, vatDelta, affectedAccounts } = simulateApprovals(
      requestedReviews,
      requestedSuggestions,
      requestedVouchers,
      input.action,
    );

    const result: SimulationRun = {
      id: createId("sim"),
      title: input.title,
      scenario: input.scenario,
      outcomeSummary: `Simulated ${requestedReviews.length} review(s); ${affectedAccounts.length} accounts affected. No production postings were changed.`,
      affectedAccounts,
      balanceDelta,
      vatDelta,
    };

    this.appendEvent({
      organizationId: defaultOrganizationId,
      workspaceId: defaultWorkspaceId,
      aggregateType: "simulation",
      aggregateId: result.id,
      eventType: "SimulationExecuted",
      actorId: input.actorId,
      occurredAt: nowIso(),
      payload: result,
    });

    return result;
  }

  async refreshComplianceAlerts(): Promise<ComplianceAlert[]> {
    const detected = detectComplianceIssues([...this.reviews.values()], [...this.vouchers.values()], today());
    const detectedById = new Map(detected.map((a) => [a.id, a]));

    // Immutable single-pass rebuild (CONVENTIONS Rules 17, 24): clone before
    // mutating so prior snapshot consumers don't observe spooky state flips.
    // Auto-detected alerts can transition open<->resolved; user states
    // (acknowledged, dismissed) and seeded non-auto kinds pass through unchanged.
    const rebuilt: ComplianceAlert[] = this.alerts.map((alert) => {
      if (!AUTO_DETECTED_KINDS.has(alert.kind)) return { ...alert };
      const stillDetected = detectedById.has(alert.id);
      if (alert.status === "open" && !stillDetected) return { ...alert, status: "resolved" };
      if (alert.status === "resolved" && stillDetected) return { ...alert, status: "open" };
      return { ...alert };
    });

    const existingIds = new Set(rebuilt.map((a) => a.id));
    for (const alert of detected) {
      if (!existingIds.has(alert.id)) rebuilt.push({ ...alert });
    }

    // Bound accumulation (Rule 25): cap auto-detected entries; seeded alerts pinned.
    const seeded = rebuilt.filter((a) => !AUTO_DETECTED_KINDS.has(a.kind));
    const auto = rebuilt.filter((a) => AUTO_DETECTED_KINDS.has(a.kind));
    const capRemaining = Math.max(0, MEMORY_ALERT_CAP - seeded.length);
    const trimmedAuto = auto.length > capRemaining ? auto.slice(-capRemaining) : auto;

    this.alerts = [...seeded, ...trimmedAuto];
    return [...this.alerts];
  }

  async getCompanySettings(): Promise<CompanySettings | null> {
    return this.companySettings ? { ...this.companySettings } : null;
  }

  async putCompanySettings(input: CompanySettings): Promise<CompanySettings> {
    this.companySettings = { ...input };
    return { ...this.companySettings };
  }

  async getCloseRun(): Promise<CloseRun> {
    return {
      id: "close_current",
      period: "2026-03",
      generatedAt: nowIso(),
      checklist: [
        { id: "close_1", label: "Confirm all uploaded evidence has a linked voucher", status: "ready" },
        { id: "close_2", label: "Review blocked VAT deductions", status: "open" },
        { id: "close_3", label: "Export SIE package for accountant review", status: "ready" },
      ],
    };
  }
}
