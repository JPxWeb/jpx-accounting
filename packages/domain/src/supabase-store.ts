import {
  type AccountingSuggestion,
  type AssistantSession,
  type CloseRun,
  type CompanySettings,
  companySettingsSchema,
  type EvidenceComposeInput,
  type EvidenceCreateInput,
  type EvidenceCreateResult,
  type EvidenceObject,
  type EvidencePacket,
  type LedgerEvent,
  type ReportBundle,
  type ReviewDecisionInput,
  type ReviewTask,
  type SimulationRequest,
  type SimulationRun,
  type TenantScope,
  type Voucher,
  type WorkspaceSnapshot,
} from "@jpx-accounting/contracts";
import type { SupabaseClient } from "@jpx-accounting/supabase-client";

import { buildExtractedFields, guessAccountingMethod } from "./extraction";
import { buildEventHash } from "./hash-chain";
import { createId, nowIso } from "./ids";
import { buildPostingLines } from "./posting";
import { buildBalances, buildJournal, buildVat } from "./projections";
import { buildDeterministicSuggestion, evaluateVoucherRules } from "./rules";
import type { LedgerStore, ReviewAction } from "./store";
import {
  mapAssistantSessionRow,
  mapComplianceAlertRow,
  mapEventRow,
  mapEvidenceRow,
  mapJournalRowToLedgerLine,
  mapReviewRow,
  mapSuggestionRow,
  mapVoucherRow,
} from "./supabase-mappers";

const APPEND_EVENT_MAX_RETRIES = 5;
const APPEND_EVENT_BACKOFF_BASE_MS = 20;
const PG_UNIQUE_VIOLATION = "23505";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class NotImplementedInSupabaseStore extends Error {
  constructor(method: string) {
    super(`${method} is not yet implemented for the Supabase-backed store.`);
    this.name = "NotImplementedInSupabaseStore";
  }
}

export class SupabaseLedgerStore implements LedgerStore {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly ctx: TenantScope & { userId: string },
  ) {}

  private ledger() {
    return this.supabase.schema("ledger");
  }

  private projections() {
    return this.supabase.schema("projections");
  }

  private async appendEvent(
    event: Omit<LedgerEvent, "id" | "eventHash" | "previousHash" | "digestDate" | "organizationId" | "workspaceId">,
  ): Promise<LedgerEvent> {
    const payload = JSON.stringify(event.payload);
    const digestDate = new Date().toISOString().slice(0, 10);

    for (let attempt = 0; attempt < APPEND_EVENT_MAX_RETRIES; attempt++) {
      const { data: lastEvent } = await this.ledger()
        .from("events")
        .select("event_hash")
        .eq("organization_id", this.ctx.organizationId)
        .eq("workspace_id", this.ctx.workspaceId)
        .order("sequence_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      const previousHash = lastEvent?.event_hash ?? "GENESIS";
      const eventHash = buildEventHash(previousHash, payload);

      const fullEvent = {
        id: crypto.randomUUID(),
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

      const { error } = await this.ledger().from("events").insert(fullEvent);
      if (!error) {
        return mapEventRow(fullEvent);
      }

      if (error.code !== PG_UNIQUE_VIOLATION) {
        throw new Error(`Failed to append event: ${error.message}`);
      }

      // A concurrent writer claimed this hash-chain slot. Back off with jitter
      // before re-reading the latest hash so contenders don't retry in lockstep.
      if (attempt < APPEND_EVENT_MAX_RETRIES - 1) {
        await delay(APPEND_EVENT_BACKOFF_BASE_MS * 2 ** attempt + Math.random() * APPEND_EVENT_BACKOFF_BASE_MS);
      }
    }

    throw new Error("append_event: exceeded retry budget on hash-chain contention");
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

    const extractedFields = buildExtractedFields(input);
    const grossAmount = 1249;
    const voucher: Voucher = {
      id: voucherId,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      evidencePacketId: packetId,
      voucherNumber: `V-${Date.now() % 100000}`,
      status: "needs-review",
      accountingMethod: guessAccountingMethod(input),
      extractedFields,
      voucherFields: {
        supplierName: extractedFields.find((f) => f.key === "supplierName")?.value,
        supplierVatNumber: extractedFields.find((f) => f.key === "supplierVatNumber")?.value,
        invoiceNumber: extractedFields.find((f) => f.key === "invoiceNumber")?.value,
        receiptDate: extractedFields.find((f) => f.key === "receiptDate")?.value,
        transactionDate: extractedFields.find((f) => f.key === "transactionDate")?.value,
        description: input.title,
        grossAmount,
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

    await this.persistCreateEvidence(evidence, packet, voucher, review, suggestion, input);

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
    const { error: evidenceError } = await this.ledger().from("evidence_objects").insert({
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
    if (evidenceError) throw new Error(`Failed to persist evidence: ${evidenceError.message}`);

    const { error: packetError } = await this.ledger()
      .from("evidence_packets")
      .insert({
        id: packet.id,
        organization_id: this.ctx.organizationId,
        workspace_id: this.ctx.workspaceId,
        note: packet.note ?? null,
        voice_transcript: packet.voiceTranscript ?? null,
      });
    if (packetError) throw new Error(`Failed to persist packet: ${packetError.message}`);

    const { error: linkError } = await this.ledger().from("evidence_packet_items").insert({
      evidence_packet_id: packet.id,
      evidence_object_id: evidence.id,
    });
    if (linkError) throw new Error(`Failed to link evidence to packet: ${linkError.message}`);

    const { error: voucherError } = await this.ledger().from("vouchers").insert({
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
    if (voucherError) throw new Error(`Failed to persist voucher: ${voucherError.message}`);

    const { error: suggestionError } = await this.ledger().from("suggestions").insert({
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
    if (suggestionError) throw new Error(`Failed to persist suggestion: ${suggestionError.message}`);

    const { error: reviewError } = await this.ledger()
      .from("review_tasks")
      .insert({
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
    if (reviewError) throw new Error(`Failed to persist review: ${reviewError.message}`);

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

  async composeEvidence(input: EvidenceComposeInput): Promise<EvidencePacket> {
    const packet: EvidencePacket = {
      id: createId("packet"),
      evidenceIds: input.evidenceIds,
      note: input.note,
      voiceTranscript: input.voiceTranscript,
    };

    await this.persistComposeEvidence(packet, input);

    return packet;
  }

  private async persistComposeEvidence(packet: EvidencePacket, input: EvidenceComposeInput) {
    const { error: packetError } = await this.ledger()
      .from("evidence_packets")
      .insert({
        id: packet.id,
        organization_id: this.ctx.organizationId,
        workspace_id: this.ctx.workspaceId,
        note: packet.note ?? null,
        voice_transcript: packet.voiceTranscript ?? null,
      });
    if (packetError) throw new Error(`Failed to persist composed packet: ${packetError.message}`);

    const { error: linkError } = await this.ledger()
      .from("evidence_packet_items")
      .insert(
        input.evidenceIds.map((evidenceObjectId) => ({
          evidence_packet_id: packet.id,
          evidence_object_id: evidenceObjectId,
        })),
      );
    if (linkError) throw new Error(`Failed to link evidence to composed packet: ${linkError.message}`);
  }

  async getEvidenceContext(
    evidenceId: string,
  ): Promise<{ evidence: EvidenceObject; packet?: EvidencePacket; voucher?: Voucher } | undefined> {
    const { data: evidenceRow, error: evidenceError } = await this.ledger()
      .from("evidence_objects")
      .select("*")
      .eq("id", evidenceId)
      .eq("organization_id", this.ctx.organizationId)
      .eq("workspace_id", this.ctx.workspaceId)
      .maybeSingle();

    if (evidenceError) throw new Error(`Failed to load evidence: ${evidenceError.message}`);
    if (!evidenceRow) return undefined;

    const evidence = mapEvidenceRow(evidenceRow);

    const { data: linkRow } = await this.ledger()
      .from("evidence_packet_items")
      .select("evidence_packet_id")
      .eq("evidence_object_id", evidenceId)
      .maybeSingle();

    if (!linkRow?.evidence_packet_id) {
      return { evidence };
    }

    const packetId = linkRow.evidence_packet_id as string;
    const { data: packetRow } = await this.ledger()
      .from("evidence_packets")
      .select("*")
      .eq("id", packetId)
      .eq("organization_id", this.ctx.organizationId)
      .eq("workspace_id", this.ctx.workspaceId)
      .maybeSingle();

    const { data: itemRows } = await this.ledger()
      .from("evidence_packet_items")
      .select("evidence_object_id")
      .eq("evidence_packet_id", packetId);

    const packet: EvidencePacket | undefined = packetRow
      ? {
          id: packetId,
          evidenceIds: (itemRows ?? []).map((r) => r.evidence_object_id as string),
          note: (packetRow.note as string | null) ?? undefined,
          voiceTranscript: (packetRow.voice_transcript as string | null) ?? undefined,
        }
      : undefined;

    let voucherRow: Record<string, unknown> | null = null;
    const { data: packetVoucher } = await this.ledger()
      .from("vouchers")
      .select("*")
      .eq("evidence_packet_id", packetId)
      .eq("organization_id", this.ctx.organizationId)
      .eq("workspace_id", this.ctx.workspaceId)
      .maybeSingle();
    voucherRow = packetVoucher;

    if (!voucherRow) {
      const { data: packets } = await this.ledger()
        .from("evidence_packet_items")
        .select("evidence_packet_id")
        .eq("evidence_object_id", evidenceId);

      for (const row of packets ?? []) {
        const { data: candidate } = await this.ledger()
          .from("vouchers")
          .select("*")
          .eq("evidence_packet_id", row.evidence_packet_id as string)
          .eq("organization_id", this.ctx.organizationId)
          .eq("workspace_id", this.ctx.workspaceId)
          .maybeSingle();
        if (candidate) {
          voucherRow = candidate;
          break;
        }
      }
    }

    return {
      evidence,
      ...(packet ? { packet } : {}),
      ...(voucherRow ? { voucher: mapVoucherRow(voucherRow) } : {}),
    };
  }

  async findReviewByVoucher(voucherId: string): Promise<ReviewTask | undefined> {
    const { data, error } = await this.ledger()
      .from("review_tasks")
      .select("*")
      .eq("voucher_id", voucherId)
      .eq("organization_id", this.ctx.organizationId)
      .eq("workspace_id", this.ctx.workspaceId)
      .maybeSingle();

    if (error) throw new Error(`Failed to find review: ${error.message}`);
    if (!data) return undefined;

    return this.hydrateReviewRow(data);
  }

  private async hydrateReviewRow(row: Record<string, unknown>): Promise<ReviewTask> {
    if (row.suggestion) {
      return mapReviewRow(row);
    }

    const { data: suggestionRow } = await this.ledger()
      .from("suggestions")
      .select("*")
      .eq("voucher_id", row.voucher_id as string)
      .maybeSingle();

    const suggestion = suggestionRow ? mapSuggestionRow(suggestionRow) : undefined;
    return mapReviewRow(row, suggestion);
  }

  async getReviewFeed(): Promise<ReviewTask[]> {
    const { data, error } = await this.ledger()
      .from("review_tasks")
      .select("*")
      .eq("organization_id", this.ctx.organizationId)
      .eq("workspace_id", this.ctx.workspaceId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Failed to load review feed: ${error.message}`);
    const rows = data ?? [];

    const missingVoucherIds = rows.filter((r) => !r.suggestion).map((r) => r.voucher_id as string);
    const suggestionsByVoucher = new Map<string, AccountingSuggestion>();
    if (missingVoucherIds.length > 0) {
      // suggestions has no organization_id column; the voucher_ids here come from review_tasks
      // rows already filtered by org+workspace above, so the set is transitively org-scoped.
      const { data: suggestionRows, error: sErr } = await this.ledger()
        .from("suggestions")
        .select("*")
        .in("voucher_id", missingVoucherIds);
      if (sErr) throw new Error(`Failed to load suggestions: ${sErr.message}`);
      for (const row of suggestionRows ?? []) {
        suggestionsByVoucher.set(row.voucher_id as string, mapSuggestionRow(row));
      }
    }

    return rows.map((row) =>
      row.suggestion ? mapReviewRow(row) : mapReviewRow(row, suggestionsByVoucher.get(row.voucher_id as string)),
    );
  }

  async getReports(): Promise<ReportBundle> {
    const { data, error } = await this.projections()
      .from("journal_entries")
      .select("*")
      .eq("organization_id", this.ctx.organizationId)
      .eq("workspace_id", this.ctx.workspaceId)
      .order("booked_at", { ascending: true });

    if (error) throw new Error(`Failed to load journal entries: ${error.message}`);

    const lines = (data ?? []).map((row) => mapJournalRowToLedgerLine(row));
    return {
      journal: buildJournal(lines),
      balances: buildBalances(lines),
      vat: buildVat(lines),
    };
  }

  async getSnapshot(): Promise<WorkspaceSnapshot> {
    const [evidence, vouchers, alerts, assistant, reviews, reports, closeRun] = await Promise.all([
      this.ledger()
        .from("evidence_objects")
        .select("*")
        .eq("organization_id", this.ctx.organizationId)
        .eq("workspace_id", this.ctx.workspaceId)
        .order("created_at", { ascending: false })
        .limit(100),
      this.ledger()
        .from("vouchers")
        .select("*")
        .eq("organization_id", this.ctx.organizationId)
        .eq("workspace_id", this.ctx.workspaceId)
        .order("created_at", { ascending: false }),
      this.ledger()
        .from("compliance_alerts")
        .select("*")
        .eq("organization_id", this.ctx.organizationId)
        .eq("workspace_id", this.ctx.workspaceId)
        .order("detected_at", { ascending: false })
        .limit(20),
      this.ledger()
        .from("assistant_sessions")
        .select("*")
        .eq("organization_id", this.ctx.organizationId)
        .eq("workspace_id", this.ctx.workspaceId)
        .order("created_at", { ascending: false })
        .limit(5),
      this.getReviewFeed(),
      this.getReports(),
      Promise.resolve<CloseRun>({
        id: "close_current",
        period: new Date().toISOString().slice(0, 7),
        generatedAt: nowIso(),
        checklist: [],
      }),
    ]);

    if (evidence.error) throw new Error(`Failed to load evidence: ${evidence.error.message}`);
    if (vouchers.error) throw new Error(`Failed to load vouchers: ${vouchers.error.message}`);
    if (alerts.error) throw new Error(`Failed to load compliance alerts: ${alerts.error.message}`);
    if (assistant.error) throw new Error(`Failed to load assistant sessions: ${assistant.error.message}`);

    return {
      evidence: (evidence.data ?? []).map((row) => mapEvidenceRow(row)),
      vouchers: (vouchers.data ?? []).map((row) => mapVoucherRow(row)),
      reviews,
      reports,
      assistantExamples: (assistant.data ?? []).map((row) => mapAssistantSessionRow(row)),
      closeRun,
      alerts: (alerts.data ?? []).map((row) => mapComplianceAlertRow(row)),
    };
  }

  async getEvents(): Promise<LedgerEvent[]> {
    const { data, error } = await this.ledger()
      .from("events")
      .select("*")
      .eq("organization_id", this.ctx.organizationId)
      .eq("workspace_id", this.ctx.workspaceId)
      .order("sequence_number", { ascending: true })
      .limit(500);

    if (error) throw new Error(`Failed to load events: ${error.message}`);

    return (data ?? []).map((row) => mapEventRow(row));
  }

  async suggestVoucher(voucherId: string): Promise<AccountingSuggestion | undefined> {
    const { data: voucherRow, error: voucherError } = await this.ledger()
      .from("vouchers")
      .select("*")
      .eq("id", voucherId)
      .eq("organization_id", this.ctx.organizationId)
      .eq("workspace_id", this.ctx.workspaceId)
      .maybeSingle();

    if (voucherError) throw new Error(`Failed to load voucher: ${voucherError.message}`);
    if (!voucherRow) return undefined;

    const { data: suggestionRow, error } = await this.ledger()
      .from("suggestions")
      .select("*")
      .eq("voucher_id", voucherId)
      .maybeSingle();

    if (error) throw new Error(`Failed to load suggestion: ${error.message}`);
    if (suggestionRow) return mapSuggestionRow(suggestionRow);

    const voucher = mapVoucherRow(voucherRow);
    const ruleHits = evaluateVoucherRules(voucher);
    return buildDeterministicSuggestion(voucher, ruleHits);
  }

  async applyReviewDecision(
    reviewId: string,
    action: ReviewAction,
    input: ReviewDecisionInput,
  ): Promise<ReviewTask | undefined> {
    const { data: reviewRow, error: reviewError } = await this.ledger()
      .from("review_tasks")
      .select("*")
      .eq("id", reviewId)
      .eq("organization_id", this.ctx.organizationId)
      .eq("workspace_id", this.ctx.workspaceId)
      .maybeSingle();

    if (reviewError) throw new Error(`Failed to load review: ${reviewError.message}`);
    if (!reviewRow) return undefined;

    const review = await this.hydrateReviewRow(reviewRow);
    if (review.status !== "needs-review") return review;

    const { data: voucherRow, error: voucherError } = await this.ledger()
      .from("vouchers")
      .select("*")
      .eq("id", review.voucherId)
      .eq("organization_id", this.ctx.organizationId)
      .eq("workspace_id", this.ctx.workspaceId)
      .maybeSingle();

    if (voucherError) throw new Error(`Failed to load voucher: ${voucherError.message}`);
    if (!voucherRow) return undefined;

    const voucher = mapVoucherRow(voucherRow);
    const occurredAt = nowIso();
    const nextStatus = action === "approve" ? "approved" : action === "reject" ? "rejected" : "booked-without-vat";

    const provenanceTimeline = [
      ...review.provenanceTimeline,
      {
        id: createId("step"),
        label:
          action === "approve"
            ? "Review approved"
            : action === "reject"
              ? "Review rejected"
              : "Booked without VAT deduction",
        timestamp: occurredAt,
        actor: input.actorId,
      },
    ];

    const { error: updateReviewError } = await this.ledger()
      .from("review_tasks")
      .update({
        status: nextStatus,
        provenance_timeline: provenanceTimeline,
      })
      .eq("id", reviewId)
      .eq("organization_id", this.ctx.organizationId);

    if (updateReviewError) throw new Error(`Failed to update review: ${updateReviewError.message}`);

    const { error: updateVoucherError } = await this.ledger()
      .from("vouchers")
      .update({ status: nextStatus })
      .eq("id", voucher.id)
      .eq("organization_id", this.ctx.organizationId);

    if (updateVoucherError) throw new Error(`Failed to update voucher: ${updateVoucherError.message}`);

    await this.appendEvent({
      aggregateType: "review",
      aggregateId: reviewId,
      eventType: action === "approve" ? "ReviewApproved" : "ReviewRejected",
      actorId: input.actorId,
      occurredAt,
      payload: { action, notes: input.notes },
    });

    if (action !== "reject" && review.suggestion) {
      const postingAction = action === "book-without-vat" ? "book-without-vat" : "approve";
      const lines = buildPostingLines(voucher, review.suggestion, postingAction, occurredAt);

      for (const line of lines) {
        const { error: journalError } = await this.projections()
          .from("journal_entries")
          .insert({
            id: createId("journal"),
            organization_id: this.ctx.organizationId,
            workspace_id: this.ctx.workspaceId,
            voucher_id: line.voucherId,
            account_number: line.accountNumber,
            account_name: line.accountName,
            description: line.description,
            debit: line.debit,
            credit: line.credit,
            vat_code: line.vatCode,
            deductible: line.deductible,
            booked_at: line.bookedAt,
          });
        if (journalError) throw new Error(`Failed to post journal line: ${journalError.message}`);
      }

      await this.appendEvent({
        aggregateType: "ledger",
        aggregateId: voucher.id,
        eventType: "PostedToLedger",
        actorId: input.actorId,
        occurredAt,
        payload: { action, suggestion: review.suggestion },
      });
    }

    return {
      ...review,
      status: nextStatus,
      provenanceTimeline,
    };
  }

  async answerAssistantQuestion(question: string): Promise<AssistantSession> {
    const session: AssistantSession = {
      id: createId("assistant"),
      question,
      answer: "Database-backed assistant sessions are not yet implemented.",
      status: "grounded",
      citations: [],
    };

    await this.ledger().from("assistant_sessions").insert({
      id: session.id,
      organization_id: this.ctx.organizationId,
      workspace_id: this.ctx.workspaceId,
      question: session.question,
      answer: session.answer,
      status: session.status,
      citations: session.citations,
      actor_id: null,
    });

    return session;
  }

  async runSimulation(_input: SimulationRequest): Promise<SimulationRun> {
    throw new NotImplementedInSupabaseStore("runSimulation");
  }

  async getCloseRun(): Promise<CloseRun> {
    throw new NotImplementedInSupabaseStore("getCloseRun");
  }

  async getCompanySettings(): Promise<CompanySettings | null> {
    const { data, error } = await this.ledger()
      .from("organization_settings")
      .select("settings")
      .eq("organization_id", this.ctx.organizationId)
      .maybeSingle();

    if (error) throw new Error(`Failed to load company settings: ${error.message}`);
    if (!data?.settings) return null;

    return companySettingsSchema.parse(data.settings);
  }

  async saveCompanySettings(input: CompanySettings): Promise<CompanySettings> {
    const parsed = companySettingsSchema.parse(input);
    const updatedBy = this.ctx.userId;

    const { error } = await this.ledger().from("organization_settings").upsert({
      organization_id: this.ctx.organizationId,
      settings: parsed,
      updated_at: nowIso(),
      updated_by: updatedBy,
    });

    if (error) throw new Error(`Failed to save company settings: ${error.message}`);

    await this.appendEvent({
      aggregateType: "policy",
      aggregateId: this.ctx.organizationId,
      eventType: "OrganizationSettingsUpdated",
      actorId: updatedBy,
      occurredAt: nowIso(),
      payload: parsed as unknown as Record<string, unknown>,
    });

    return parsed;
  }
}
