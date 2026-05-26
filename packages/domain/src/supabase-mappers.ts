import {
  type AccountingSuggestion,
  type AssistantSession,
  accountingSuggestionSchema,
  assistantSessionSchema,
  type ComplianceAlert,
  complianceAlertSchema,
  type EvidenceObject,
  evidenceObjectSchema,
  type LedgerEvent,
  ledgerEventSchema,
  type ReviewTask,
  reviewTaskSchema,
  type Voucher,
  voucherSchema,
} from "@jpx-accounting/contracts";

import type { LedgerLine } from "./ledger-line";

export function mapEvidenceRow(row: Record<string, unknown>): EvidenceObject {
  return evidenceObjectSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    createdAt: row.created_at,
    createdBy: row.created_by,
    title: row.title,
    modalities: row.modalities,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    blobPath: row.blob_path,
    hash: row.hash,
    trustLevel: row.trust_level,
  });
}

export function mapVoucherRow(row: Record<string, unknown>): Voucher {
  return voucherSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    evidencePacketId: row.evidence_packet_id,
    voucherNumber: row.voucher_number,
    status: row.status,
    accountingMethod: row.accounting_method,
    extractedFields: row.extracted_fields,
    voucherFields: row.voucher_fields,
    createdAt: row.created_at,
    createdBy: row.created_by,
  });
}

export function mapSuggestionRow(row: Record<string, unknown>): AccountingSuggestion {
  return accountingSuggestionSchema.parse({
    id: row.id,
    voucherId: row.voucher_id,
    accountNumber: row.account_number,
    accountName: row.account_name,
    vatCode: row.vat_code,
    confidence: Number(row.confidence),
    reasoning: row.reasoning,
    kind: row.kind,
    citations: row.citations,
    ruleHits: row.rule_hits,
  });
}

export function mapReviewRow(row: Record<string, unknown>, suggestion?: AccountingSuggestion): ReviewTask {
  const embedded = row.suggestion ? accountingSuggestionSchema.parse(row.suggestion) : undefined;
  return reviewTaskSchema.parse({
    id: row.id,
    voucherId: row.voucher_id,
    title: row.title,
    status: row.status,
    blockedReason: row.blocked_reason ?? undefined,
    suggestedAction: row.suggested_action,
    suggestion: suggestion ?? embedded,
    provenanceTimeline: row.provenance_timeline,
  });
}

export function mapJournalRowToLedgerLine(row: Record<string, unknown>): LedgerLine {
  return {
    voucherId: row.voucher_id as string,
    accountNumber: row.account_number as string,
    accountName: row.account_name as string,
    description: row.description as string,
    debit: Number(row.debit),
    credit: Number(row.credit),
    vatCode: row.vat_code as string,
    bookedAt: row.booked_at as string,
    deductible: Boolean(row.deductible),
  };
}

export function mapComplianceAlertRow(row: Record<string, unknown>): ComplianceAlert {
  return complianceAlertSchema.parse({
    id: row.id,
    title: row.title,
    source: row.source,
    detectedAt: row.detected_at,
    impactSummary: row.impact_summary ?? row.body ?? "",
    kind: row.kind ?? "legacy",
    severity: row.severity ?? "info",
    status: row.status ?? "open",
    targetId: row.target_id ?? undefined,
    body: row.body ?? undefined,
  });
}

export function mapAssistantSessionRow(row: Record<string, unknown>): AssistantSession {
  return assistantSessionSchema.parse({
    id: row.id,
    question: row.question,
    answer: row.answer,
    status: row.status,
    citations: row.citations,
  });
}

export function mapEventRow(row: Record<string, unknown>): LedgerEvent {
  return ledgerEventSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    actorId: row.actor_id,
    occurredAt: row.occurred_at,
    payload: row.payload,
    previousHash: row.previous_hash,
    eventHash: row.event_hash,
    digestDate: row.digest_date,
  });
}
