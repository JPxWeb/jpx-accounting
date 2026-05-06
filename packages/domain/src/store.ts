import type {
  AccountingMethod,
  AccountingSuggestion,
  AssistantSession,
  ComplianceAlert,
  CloseRun,
  EvidenceComposeInput,
  EvidenceCreateInput,
  EvidenceCreateResult,
  EvidenceObject,
  EvidencePacket,
  ExtractedField,
  LedgerEvent,
  ReportBundle,
  ReviewDecisionInput,
  ReviewTask,
  SimulationRequest,
  SimulationRun,
  Voucher,
  WorkspaceSnapshot,
} from "@jpx-accounting/contracts";

import { buildJournal, buildBalances, buildVat } from "./projections";
import { buildDeterministicSuggestion, evaluateVoucherRules } from "./rules";
import { buildEventHash } from "./hash-chain";
import { createId, nowIso } from "./ids";

type LedgerLine = Parameters<typeof buildJournal>[0][number];
export type ReviewAction = "approve" | "reject" | "book-without-vat";

export interface LedgerStore {
  createEvidence(input: EvidenceCreateInput): EvidenceCreateResult;
  composeEvidence(input: EvidenceComposeInput): EvidencePacket;
  getEvidenceContext(evidenceId: string):
    | {
        evidence: EvidenceObject;
        packet?: EvidencePacket;
        voucher?: Voucher;
      }
    | undefined;
  findReviewByVoucher(voucherId: string): ReviewTask | undefined;
  getReviewFeed(): ReviewTask[];
  getReports(): ReportBundle;
  getSnapshot(): WorkspaceSnapshot;
  getEvents(): LedgerEvent[];
  suggestVoucher(voucherId: string): AccountingSuggestion | undefined;
  applyReviewDecision(reviewId: string, action: ReviewAction, input: ReviewDecisionInput): ReviewTask | undefined;
  answerAssistantQuestion(question: string): AssistantSession;
  runSimulation(input: SimulationRequest): SimulationRun;
  getCloseRun(): CloseRun;
}

const defaultOrganizationId = "org_jpx";
const defaultWorkspaceId = "workspace_main";

function guessSupplier(input: EvidenceCreateInput) {
  const value = `${input.title} ${input.originalFilename} ${input.extractedText ?? ""}`.toLowerCase();
  if (value.includes("microsoft")) return "Microsoft Ireland";
  if (value.includes("openai")) return "OpenAI Ireland";
  if (value.includes("ica")) return "ICA Maxi";
  if (value.includes("sl")) return "Storstockholms Lokaltrafik";
  return "Unclassified supplier";
}

function buildExtractedFields(input: EvidenceCreateInput): ExtractedField[] {
  return [
    { key: "supplierName", label: "Supplier", value: guessSupplier(input), confidence: 0.71, required: true },
    {
      key: "receiptDate",
      label: "Receipt date",
      value: new Date().toISOString().slice(0, 10),
      confidence: 0.98,
      required: true,
    },
    {
      key: "transactionDate",
      label: "Transaction date",
      value: new Date().toISOString().slice(0, 10),
      confidence: 0.85,
      required: false,
    },
    { key: "grossAmount", label: "Gross amount", value: "1249.00", confidence: 0.84, required: true },
    {
      key: "invoiceNumber",
      label: "Invoice number",
      value: input.originalFilename.replace(/\W+/g, "-"),
      confidence: 0.61,
      required: false,
    },
    { key: "supplierVatNumber", label: "VAT number", value: "SE556677889901", confidence: 0.51, required: false },
  ];
}

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
      accountNumber: "2641",
      accountName: "Debiterad ingående moms",
      description: "Seeded input VAT",
      debit: 250,
      credit: 0,
      vatCode: "VAT25",
      bookedAt: nowIso(),
      deductible: true,
    },
    {
      voucherId: "voucher_seed_1",
      accountNumber: "1930",
      accountName: "Företagskonto",
      description: "Seeded bank outflow",
      debit: 0,
      credit: 1250,
      vatCode: "NA",
      bookedAt: nowIso(),
      deductible: false,
    },
  ];
}

function guessAccountingMethod(input: EvidenceCreateInput): AccountingMethod {
  const text = `${input.title} ${input.originalFilename}`.toLowerCase();
  return text.includes("invoice") ? "invoice" : "cash";
}

function buildPostingLines(
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
    const seededEvidence = this.createEvidence({
      organizationId: defaultOrganizationId,
      workspaceId: defaultWorkspaceId,
      actorId: "user_founder",
      title: "OpenAI subscription invoice",
      originalFilename: "openai-march-2026.pdf",
      mimeType: "application/pdf",
      modalities: ["pdf", "upload"],
      extractedText: "OpenAI March 2026 subscription invoice",
    });

    const review = this.findReviewByVoucher(seededEvidence.voucherId);
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

  createEvidence(input: EvidenceCreateInput): EvidenceCreateResult {
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

  composeEvidence(input: EvidenceComposeInput) {
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

  getEvidenceContext(evidenceId: string):
    | {
        evidence: EvidenceObject;
        packet?: EvidencePacket;
        voucher?: Voucher;
      }
    | undefined {
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

  findReviewByVoucher(voucherId: string) {
    const reviewId = this.voucherIdToReviewId.get(voucherId);
    return reviewId ? this.reviews.get(reviewId) : undefined;
  }

  getReviewFeed() {
    return [...this.reviews.values()].sort((left, right) => right.id.localeCompare(left.id));
  }

  getReports(): ReportBundle {
    return {
      journal: buildJournal(this.ledgerLines),
      balances: buildBalances(this.ledgerLines),
      vat: buildVat(this.ledgerLines),
    };
  }

  getSnapshot(): WorkspaceSnapshot {
    return {
      evidence: [...this.evidence.values()],
      vouchers: [...this.vouchers.values()],
      reviews: this.getReviewFeed(),
      reports: this.getReports(),
      assistantExamples: this.assistantExamples,
      closeRun: this.getCloseRun(),
      alerts: this.alerts,
    };
  }

  getEvents() {
    return [...this.events];
  }

  suggestVoucher(voucherId: string) {
    const voucher = this.vouchers.get(voucherId);
    if (!voucher) return undefined;

    const ruleHits = evaluateVoucherRules(voucher);
    const suggestion = buildDeterministicSuggestion(voucher, ruleHits);
    this.suggestions.set(voucherId, suggestion);
    return suggestion;
  }

  applyReviewDecision(reviewId: string, action: ReviewAction, input: ReviewDecisionInput) {
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

  answerAssistantQuestion(question: string) {
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

  runSimulation(input: SimulationRequest): SimulationRun {
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

  getCloseRun(): CloseRun {
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
