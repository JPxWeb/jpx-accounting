import type { AccountingSuggestion, EvidenceCreateInput, ReviewTask, Voucher } from "@jpx-accounting/contracts";

import { buildExtractedFields, guessAccountingMethod } from "./extraction";
import { createId } from "./ids";
import { buildDeterministicSuggestion, evaluateVoucherRules } from "./rules";

export type VoucherDraftInput = {
  voucherId: string;
  packetId: string;
  voucherNumber: string;
  createdAt: string;
  input: EvidenceCreateInput;
  // Authenticated actor for audit attribution on the initial provenance step.
  // Supabase store passes this.ctx.userId; the demo MemoryLedgerStore passes
  // input.actorId since it has no auth context. Domain "createdBy" fields stay
  // sourced from input.actorId (they record the request's claimed creator,
  // which the audit trail is for verifying, not for attribution).
  actorUserId: string;
};

export function buildVoucherDraft(d: VoucherDraftInput): {
  voucher: Voucher;
  review: ReviewTask;
  suggestion: AccountingSuggestion;
} {
  const extractedFields = buildExtractedFields(d.input);
  const voucher: Voucher = {
    id: d.voucherId,
    organizationId: d.input.organizationId,
    workspaceId: d.input.workspaceId,
    evidencePacketId: d.packetId,
    voucherNumber: d.voucherNumber,
    status: "needs-review",
    accountingMethod: guessAccountingMethod(d.input),
    extractedFields,
    voucherFields: {
      supplierName: extractedFields.find((f) => f.key === "supplierName")?.value,
      supplierVatNumber: extractedFields.find((f) => f.key === "supplierVatNumber")?.value,
      invoiceNumber: extractedFields.find((f) => f.key === "invoiceNumber")?.value,
      receiptDate: extractedFields.find((f) => f.key === "receiptDate")?.value,
      transactionDate: extractedFields.find((f) => f.key === "transactionDate")?.value,
      description: d.input.title,
      grossAmount: 1249,
      netAmount: 999.2,
      vatAmount: 249.8,
      vatRate: 25,
      currency: "SEK",
    },
    createdAt: d.createdAt,
    createdBy: d.input.actorId,
  };

  const ruleHits = evaluateVoucherRules(voucher);
  const suggestion = buildDeterministicSuggestion(voucher, ruleHits);
  const blocked = ruleHits.some((r) => r.severity === "blocking");
  const review: ReviewTask = {
    id: createId("review"),
    voucherId: d.voucherId,
    title: `Review ${d.voucherNumber}`,
    status: "needs-review",
    blockedReason: blocked
      ? "Mandatory bookkeeping or VAT data must be confirmed before deductible VAT can be approved."
      : undefined,
    suggestedAction: blocked ? "Request more evidence or post without VAT deduction." : "Approve the proposed posting.",
    suggestion,
    provenanceTimeline: [
      { id: createId("step"), label: "Evidence received", timestamp: d.createdAt, actor: d.actorUserId },
      { id: createId("step"), label: "Fields extracted", timestamp: d.createdAt, actor: "system-extractor" },
      { id: createId("step"), label: "Rules applied", timestamp: d.createdAt, actor: "system-rules" },
      { id: createId("step"), label: "Suggestion generated", timestamp: d.createdAt, actor: "system-ai" },
    ],
  };

  return { voucher, review, suggestion };
}
