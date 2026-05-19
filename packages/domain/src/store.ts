import type {
  AccountingSuggestion,
  AssistantSession,
  CloseRun,
  CompanySettings,
  ComplianceAlert,
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
import { ACCOUNT_COMPANY_BANK, ACCOUNT_INPUT_VAT, findBasAccount, VAT_CODE_NONE } from "./bas";
import { buildEventHash } from "./hash-chain";
import { createId, nowIso } from "./ids";
import type { LedgerLine } from "./ledger-line";
import { buildPostingLines } from "./posting";
import { buildBalances, buildJournal, buildVat } from "./projections";
import { buildDeterministicSuggestion, evaluateVoucherRules } from "./rules";
import { buildVoucherDraft } from "./voucher-draft";

export type ReviewAction = "approve" | "reject" | "book-without-vat";

export interface LedgerStore {
  createEvidence(input: EvidenceCreateInput): Promise<EvidenceCreateResult>;
  composeEvidence(input: EvidenceComposeInput): Promise<EvidencePacket>;
  getEvidenceContext(
    evidenceId: string,
  ): Promise<{ evidence: EvidenceObject; packet?: EvidencePacket; voucher?: Voucher } | undefined>;
  findReviewByVoucher(voucherId: string): Promise<ReviewTask | undefined>;
  getReviewFeed(): Promise<ReviewTask[]>;
  getReports(): Promise<ReportBundle>;
  getBalances(): Promise<ReportBundle["balances"]>;
  getVat(): Promise<ReportBundle["vat"]>;
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
  getCompanySettings(): Promise<CompanySettings | null>;
  saveCompanySettings(input: CompanySettings): Promise<CompanySettings>;
}

const defaultOrganizationId = "org_jpx";
const defaultWorkspaceId = "workspace_main";

function initialLedgerLines(): LedgerLine[] {
  return [
    {
      voucherId: "voucher_seed_1",
      accountNumber: "6540",
      accountName: "IT-tjänster",
      description: "Seeded SaaS subscription",
      debit: 1000,
      credit: 0,
      vatCode: "VAT25",
      bookedAt: nowIso(),
      deductible: true,
    },
    {
      voucherId: "voucher_seed_1",
      accountNumber: ACCOUNT_INPUT_VAT,
      accountName: findBasAccount(ACCOUNT_INPUT_VAT)!.name,
      description: "Seeded input VAT",
      debit: 250,
      credit: 0,
      vatCode: "VAT25",
      bookedAt: nowIso(),
      deductible: true,
    },
    {
      voucherId: "voucher_seed_1",
      accountNumber: ACCOUNT_COMPANY_BANK,
      accountName: findBasAccount(ACCOUNT_COMPANY_BANK)!.name,
      description: "Seeded bank outflow",
      debit: 0,
      credit: 1250,
      vatCode: VAT_CODE_NONE,
      bookedAt: nowIso(),
      deductible: false,
    },
  ];
}

export class MemoryLedgerStore implements LedgerStore {
  private readonly evidence = new Map<string, EvidenceObject>();
  private companySettings: CompanySettings = {
    organizationId: "org_jpx",
    organizationName: "JPX Demo AB",
    organizationNumber: "556677-8899",
    addressLine1: "Kungsgatan 1",
    postalCode: "111 22",
    city: "Stockholm",
    contactEmail: "hello@example.com",
  };
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
  private readonly alerts: ComplianceAlert[] = [
    {
      id: "alert_vat_1",
      title: "Representation review queue",
      source: "Skatteverket / internal policy",
      detectedAt: nowIso(),
      impactSummary:
        "Two receipts look like representation and should be checked against attendee and VAT-limit rules.",
    },
  ];

  constructor() {
    this.seedDemoData();
  }

  private seedDemoData() {
    // createEvidence is async only to satisfy the LedgerStore interface; this in-memory
    // implementation has no await, so the call runs synchronously and the stores below
    // are fully populated by the time the constructor returns.
    void this.createEvidence({
      organizationId: defaultOrganizationId,
      workspaceId: defaultWorkspaceId,
      actorId: "user_founder",
      title: "OpenAI subscription invoice",
      originalFilename: "openai-march-2026.pdf",
      mimeType: "application/pdf",
      modalities: ["pdf", "upload"],
      extractedText: "OpenAI March 2026 subscription invoice",
    });

    const [review] = this.reviews.values();
    if (!review) return;
    review.title = "Approve AI subscription posting";

    this.assistantExamples.push({
      id: createId("assistant"),
      question: "Can we deduct VAT on this invoice right away?",
      answer:
        "The invoice looks deductible, but the system still requires a human approval because deductible VAT should only be posted after invoice requirements are confirmed.",
      status: "grounded",
      citations: review.suggestion?.citations ?? [],
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

    const voucherNumber = `V-${this.vouchers.size + 1001}`;
    const { voucher, review, suggestion } = buildVoucherDraft({
      voucherId,
      packetId,
      voucherNumber,
      createdAt,
      input,
    });

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
      payload: { extractedFields: voucher.extractedFields },
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

  async composeEvidence(input: EvidenceComposeInput) {
    const packet: EvidencePacket = {
      id: createId("packet"),
      evidenceIds: input.evidenceIds,
      note: input.note,
      voiceTranscript: input.voiceTranscript,
    };
    this.evidencePackets.set(packet.id, packet);
    for (const eid of input.evidenceIds) {
      this.evidenceIdToPacketId.set(eid, packet.id);
    }
    return packet;
  }

  async getEvidenceContext(
    evidenceId: string,
  ): Promise<{ evidence: EvidenceObject; packet?: EvidencePacket; voucher?: Voucher } | undefined> {
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

  async findReviewByVoucher(voucherId: string) {
    const reviewId = this.voucherIdToReviewId.get(voucherId);
    return reviewId ? this.reviews.get(reviewId) : undefined;
  }

  async getReviewFeed() {
    return [...this.reviews.values()].sort((left, right) => right.id.localeCompare(left.id));
  }

  async getReports(): Promise<ReportBundle> {
    return {
      journal: buildJournal(this.ledgerLines),
      balances: buildBalances(this.ledgerLines),
      vat: buildVat(this.ledgerLines),
    };
  }

  async getBalances() {
    return buildBalances(this.ledgerLines);
  }

  async getVat() {
    return buildVat(this.ledgerLines);
  }

  async getSnapshot(): Promise<WorkspaceSnapshot> {
    const [reviews, reports, closeRun] = await Promise.all([
      this.getReviewFeed(),
      this.getReports(),
      this.getCloseRun(),
    ]);
    return {
      evidence: [...this.evidence.values()],
      vouchers: [...this.vouchers.values()],
      reviews,
      reports,
      assistantExamples: this.assistantExamples,
      closeRun,
      alerts: this.alerts,
    };
  }

  async getEvents() {
    return [...this.events];
  }

  async suggestVoucher(voucherId: string) {
    const voucher = this.vouchers.get(voucherId);
    if (!voucher) return undefined;

    const ruleHits = evaluateVoucherRules(voucher);
    const suggestion = buildDeterministicSuggestion(voucher, ruleHits);
    this.suggestions.set(voucherId, suggestion);
    return suggestion;
  }

  async applyReviewDecision(reviewId: string, action: ReviewAction, input: ReviewDecisionInput) {
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

  async answerAssistantQuestion(question: string) {
    const answer: AssistantSession = {
      id: createId("assistant"),
      question,
      answer:
        "This scaffold uses grounded, citation-first advisory. In production the answer would combine Azure AI Search retrieval, policy sources, and Responses API reasoning before it reaches the reviewer.",
      status: "grounded",
      citations: [
        {
          id: "cit_arch",
          title: "Internal architecture policy",
          sourceType: "internal",
          excerpt: "AI may suggest and explain, but may not silently mutate accounting state.",
        },
      ],
    };
    this.assistantExamples.unshift(answer);
    return answer;
  }

  async runSimulation(input: SimulationRequest): Promise<SimulationRun> {
    const result: SimulationRun = {
      id: createId("sim"),
      title: input.title,
      scenario: input.scenario,
      outcomeSummary:
        "Shadow ledger run completed. No production postings were changed; the scenario should be reviewed against the active VAT and policy rules before adoption.",
      affectedAccounts: ["6071", "2641", "6991"],
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

  async getCompanySettings(): Promise<CompanySettings | null> {
    return this.companySettings;
  }

  async saveCompanySettings(input: CompanySettings): Promise<CompanySettings> {
    this.companySettings = input;
    return this.companySettings;
  }
}
