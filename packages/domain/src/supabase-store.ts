import type {
  AccountingSuggestion,
  AssistantSession,
  CloseRun,
  CompanySettings,
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
import type { SupabaseClient } from "@jpx-accounting/supabase-client";

import { buildEventHash } from "./hash-chain";
import { createId, nowIso } from "./ids";
import { buildDeterministicSuggestion, evaluateVoucherRules } from "./rules";
import type { LedgerStore, ReviewAction } from "./store";

type StoreContext = {
  organizationId: string;
  workspaceId: string;
};

export class SupabaseLedgerStore implements LedgerStore {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly ctx: StoreContext,
  ) {}

  // ── helpers ──────────────────────────────────────────────

  private async appendEvent(
    event: Omit<LedgerEvent, "id" | "eventHash" | "previousHash" | "digestDate" | "organizationId" | "workspaceId">,
  ): Promise<LedgerEvent> {
    // Fetch last event hash for chain continuity
    const { data: lastEvent } = await this.supabase
      .from("ledger.events")
      .select("event_hash")
      .eq("organization_id", this.ctx.organizationId)
      .eq("workspace_id", this.ctx.workspaceId)
      .order("sequence_number", { ascending: false })
      .limit(1)
      .single();

    const previousHash = lastEvent?.event_hash ?? "GENESIS";
    const payload = JSON.stringify(event.payload);
    const eventHash = buildEventHash(previousHash, payload);
    const digestDate = new Date().toISOString().slice(0, 10);

    const fullEvent = {
      id: createId("evt"),
      organization_id: this.ctx.organizationId,
      workspace_id: this.ctx.workspaceId,
      aggregate_type: event.aggregateType,
      aggregate_id: event.aggregateId,
      event_type: event.eventType,
      actor_id: event.actorId,
      occurred_at: event.occurredAt,
      payload: event.payload,
      previous_hash: previousHash,
      event_hash: eventHash,
      digest_date: digestDate,
    };

    const { error } = await this.supabase.from("ledger.events").insert(fullEvent);
    if (error) throw new Error(`Failed to append event: ${error.message}`);

    return this.mapEventRow(fullEvent);
  }

  private mapEventRow(row: Record<string, unknown>): LedgerEvent {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      workspaceId: row.workspace_id as string,
      aggregateType: row.aggregate_type as LedgerEvent["aggregateType"],
      aggregateId: row.aggregate_id as string,
      eventType: row.event_type as LedgerEvent["eventType"],
      actorId: row.actor_id as string,
      occurredAt: row.occurred_at as string,
      payload: row.payload as Record<string, unknown>,
      previousHash: row.previous_hash as string,
      eventHash: row.event_hash as string,
      digestDate: row.digest_date as string,
    };
  }

  private buildExtractedFields(input: EvidenceCreateInput): ExtractedField[] {
    return [
      { key: "supplierName", label: "Supplier", value: this.guessSupplier(input), confidence: 0.71, required: true },
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
      { key: "grossAmount", label: "Gross amount", value: "0", confidence: 0.5, required: true },
      {
        key: "invoiceNumber",
        label: "Invoice number",
        value: input.originalFilename.replace(/\W+/g, "-"),
        confidence: 0.61,
        required: false,
      },
      { key: "supplierVatNumber", label: "VAT number", value: "", confidence: 0.1, required: false },
    ];
  }

  private guessSupplier(input: EvidenceCreateInput): string {
    const value = `${input.title} ${input.originalFilename} ${input.extractedText ?? ""}`.toLowerCase();
    if (value.includes("microsoft")) return "Microsoft Ireland";
    if (value.includes("openai")) return "OpenAI Ireland";
    if (value.includes("ica")) return "ICA Maxi";
    if (value.includes("sl")) return "Storstockholms Lokaltrafik";
    return "Unclassified supplier";
  }

  // ── LedgerStore interface ────────────────────────────────

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

    const extractedFields = this.buildExtractedFields(input);
    const voucher: Voucher = {
      id: voucherId,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      evidencePacketId: packetId,
      voucherNumber: `V-${Date.now() % 100000}`,
      status: "needs-review",
      accountingMethod: input.title.toLowerCase().includes("invoice") ? "invoice" : "cash",
      extractedFields,
      voucherFields: {
        supplierName: extractedFields.find((f) => f.key === "supplierName")?.value,
        supplierVatNumber: extractedFields.find((f) => f.key === "supplierVatNumber")?.value,
        invoiceNumber: extractedFields.find((f) => f.key === "invoiceNumber")?.value,
        receiptDate: extractedFields.find((f) => f.key === "receiptDate")?.value,
        transactionDate: extractedFields.find((f) => f.key === "transactionDate")?.value,
        description: input.title,
        grossAmount: 0,
        netAmount: 0,
        vatAmount: 0,
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
      blockedReason: ruleHits.some((r) => r.severity === "blocking")
        ? "Mandatory bookkeeping or VAT data must be confirmed before deductible VAT can be approved."
        : undefined,
      suggestedAction: ruleHits.some((r) => r.severity === "blocking")
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

    const packet: EvidencePacket = {
      id: packetId,
      evidenceIds: [evidenceId],
      note: input.note,
      voiceTranscript: input.extractedText,
    };

    // Fire-and-forget: persist to Supabase asynchronously.
    // The method signature is synchronous (matching the LedgerStore interface),
    // so we kick off the writes without awaiting.
    this.persistCreateEvidence(evidence, packet, voucher, review, suggestion, input).catch((err) =>
      console.error("Failed to persist evidence:", err),
    );

    return { evidence, packet, voucher, review, voucherId };
  }

  private async persistCreateEvidence(
    evidence: EvidenceObject,
    packet: EvidencePacket,
    voucher: Voucher,
    review: ReviewTask,
    suggestion: AccountingSuggestion,
    input: EvidenceCreateInput,
  ) {
    // Insert evidence object
    await this.supabase.from("ledger.evidence_objects").insert({
      id: evidence.id,
      organization_id: evidence.organizationId,
      workspace_id: evidence.workspaceId,
      title: evidence.title,
      modalities: evidence.modalities,
      created_by: evidence.createdBy,
      created_at: evidence.createdAt,
      original_filename: evidence.originalFilename,
      mime_type: evidence.mimeType,
      blob_path: evidence.blobPath,
      hash: evidence.hash,
      trust_level: evidence.trustLevel,
    });

    // Insert evidence packet
    await this.supabase.from("ledger.evidence_packets").insert({
      id: packet.id,
      organization_id: this.ctx.organizationId,
      workspace_id: this.ctx.workspaceId,
      note: packet.note ?? null,
      voice_transcript: packet.voiceTranscript ?? null,
    });

    // Link evidence to packet
    await this.supabase.from("ledger.evidence_packet_items").insert({
      evidence_packet_id: packet.id,
      evidence_object_id: evidence.id,
    });

    // Insert voucher
    await this.supabase.from("ledger.vouchers").insert({
      id: voucher.id,
      organization_id: voucher.organizationId,
      workspace_id: voucher.workspaceId,
      evidence_packet_id: voucher.evidencePacketId,
      voucher_number: voucher.voucherNumber,
      accounting_method: voucher.accountingMethod,
      status: voucher.status,
      voucher_fields: voucher.voucherFields,
      extracted_fields: voucher.extractedFields,
      created_by: voucher.createdBy,
      created_at: voucher.createdAt,
    });

    // Insert suggestion
    await this.supabase.from("ledger.suggestions").insert({
      id: suggestion.id,
      voucher_id: suggestion.voucherId,
      account_number: suggestion.accountNumber,
      account_name: suggestion.accountName,
      vat_code: suggestion.vatCode,
      confidence: suggestion.confidence,
      reasoning: suggestion.reasoning,
      kind: suggestion.kind,
      citations: suggestion.citations,
      rule_hits: suggestion.ruleHits,
    });

    // Insert review task
    await this.supabase.from("ledger.review_tasks").insert({
      id: review.id,
      organization_id: this.ctx.organizationId,
      workspace_id: this.ctx.workspaceId,
      voucher_id: review.voucherId,
      title: review.title,
      status: review.status,
      blocked_reason: review.blockedReason ?? null,
      suggested_action: review.suggestedAction,
      suggestion: review.suggestion ?? null,
      provenance_timeline: review.provenanceTimeline,
    });

    // Append domain events
    await this.appendEvent({
      aggregateType: "evidence",
      aggregateId: evidence.id,
      eventType: "EvidenceReceived",
      actorId: input.actorId,
      occurredAt: evidence.createdAt,
      payload: evidence as unknown as Record<string, unknown>,
    });

    await this.appendEvent({
      aggregateType: "voucher",
      aggregateId: voucher.id,
      eventType: "VoucherCreated",
      actorId: input.actorId,
      occurredAt: evidence.createdAt,
      payload: voucher as unknown as Record<string, unknown>,
    });

    await this.appendEvent({
      aggregateType: "review",
      aggregateId: review.id,
      eventType: "SuggestionGenerated",
      actorId: "system-ai",
      occurredAt: evidence.createdAt,
      payload: suggestion as unknown as Record<string, unknown>,
    });
  }

  composeEvidence(input: EvidenceComposeInput): EvidencePacket {
    const packet: EvidencePacket = {
      id: createId("packet"),
      evidenceIds: input.evidenceIds,
      note: input.note,
      voiceTranscript: input.voiceTranscript,
    };

    this.persistComposeEvidence(packet, input).catch((err: unknown) =>
      console.error("Failed to persist composed packet:", err),
    );

    return packet;
  }

  private async persistComposeEvidence(packet: EvidencePacket, input: EvidenceComposeInput) {
    await this.supabase.from("ledger.evidence_packets").insert({
      id: packet.id,
      organization_id: this.ctx.organizationId,
      workspace_id: this.ctx.workspaceId,
      note: packet.note ?? null,
      voice_transcript: packet.voiceTranscript ?? null,
    });

    await Promise.all(
      input.evidenceIds.map((eid) =>
        this.supabase.from("ledger.evidence_packet_items").insert({
          evidence_packet_id: packet.id,
          evidence_object_id: eid,
        }),
      ),
    );
  }

  async getEvidenceContext(
    _evidenceId: string,
  ): Promise<{ evidence: EvidenceObject; packet?: EvidencePacket; voucher?: Voucher } | undefined> {
    // TODO: Query ledger.evidence_objects when fully implemented
    return undefined;
  }

  async findReviewByVoucher(_voucherId: string): Promise<ReviewTask | undefined> {
    // TODO: Query ledger.review_tasks when fully implemented
    return undefined;
  }

  async getReviewFeed(): Promise<ReviewTask[]> {
    // TODO: Query ledger.review_tasks when fully implemented
    return [];
  }

  async getReports(): Promise<ReportBundle> {
    // TODO: Build from ledger lines when fully implemented
    return { journal: [], balances: [], vat: [] };
  }

  async getSnapshot(): Promise<WorkspaceSnapshot> {
    return {
      evidence: [],
      vouchers: [],
      reviews: await this.getReviewFeed(),
      reports: await this.getReports(),
      assistantExamples: [],
      closeRun: await this.getCloseRun(),
      alerts: [],
    };
  }

  async getEvents(): Promise<LedgerEvent[]> {
    // TODO: Query ledger.events when fully implemented
    return [];
  }

  async suggestVoucher(_voucherId: string): Promise<AccountingSuggestion | undefined> {
    // TODO: Query ledger.suggestions when fully implemented
    return undefined;
  }

  async applyReviewDecision(
    _reviewId: string,
    _action: ReviewAction,
    _input: ReviewDecisionInput,
  ): Promise<ReviewTask | undefined> {
    // TODO: Implement review decision persistence
    return undefined;
  }

  async answerAssistantQuestion(question: string): Promise<AssistantSession> {
    return {
      id: createId("assistant"),
      question,
      answer: "Database-backed assistant sessions are not yet implemented.",
      status: "grounded",
      citations: [],
    };
  }

  async runSimulation(input: SimulationRequest): Promise<SimulationRun> {
    return {
      id: createId("sim"),
      title: input.title,
      scenario: input.scenario,
      outcomeSummary: "Database-backed simulations are not yet implemented.",
      affectedAccounts: [],
    };
  }

  async getCloseRun(): Promise<CloseRun> {
    return {
      id: "close_current",
      period: new Date().toISOString().slice(0, 7),
      generatedAt: nowIso(),
      checklist: [
        { id: "close_1", label: "Confirm all uploaded evidence has a linked voucher", status: "open" },
        { id: "close_2", label: "Review blocked VAT deductions", status: "open" },
        { id: "close_3", label: "Export SIE package for accountant review", status: "open" },
      ],
    };
  }

  async getCompanySettings(): Promise<CompanySettings | null> {
    // TODO: Query organization settings from Supabase when fully implemented
    return null;
  }

  async saveCompanySettings(_input: CompanySettings): Promise<CompanySettings> {
    // TODO: Persist organization settings to Supabase when fully implemented
    throw new Error("saveCompanySettings is not yet implemented in SupabaseLedgerStore.");
  }
}
