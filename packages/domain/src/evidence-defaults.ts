import type { AccountingMethod, EvidenceCreateInput, ExtractedField, VoucherField } from "@jpx-accounting/contracts";

import { defaultCoaTemplate, findCoaAccount } from "./coa/registry";
import { deriveDeterministicExtraction } from "./deterministic-extraction";
import { nowIso, today } from "./ids";
import type { LedgerLine } from "./projections";

/**
 * Scaffold helpers for turning a freshly-uploaded evidence object into review-ready
 * fields, postings, and a method guess. Shared between MemoryLedgerStore and
 * PostgresLedgerStore so the two stay in lockstep — both stores expect identical
 * behavior so parity tests in tests/integration/postgres-ledger.test.ts pass.
 */

export function guessSupplier(input: EvidenceCreateInput): string {
  const value = `${input.title} ${input.originalFilename} ${input.extractedText ?? ""}`.toLowerCase();
  if (value.includes("microsoft")) return "Microsoft Ireland";
  if (value.includes("openai")) return "OpenAI Ireland";
  if (value.includes("ica")) return "ICA Maxi";
  if (value.includes("sl")) return "Storstockholms Lokaltrafik";
  return "Unclassified supplier";
}

export function buildExtractedFields(input: EvidenceCreateInput): ExtractedField[] {
  // Deterministic file-seeded fields whenever the create input carries a real
  // file size (promoted uploads always do). Inputs without `sizeBytes` — the
  // seeded demo evidence and legacy callers — keep the exact canned values
  // below so seed-dependent pins (simulation tests, api.spec journal counts,
  // visual baselines) stay byte-stable. Do NOT touch the legacy values or
  // confidences.
  if (input.sizeBytes !== undefined) {
    return deriveDeterministicExtraction({ filename: input.originalFilename, sizeBytes: input.sizeBytes }, today());
  }

  const dateIso = today();
  return [
    { key: "supplierName", label: "Supplier", value: guessSupplier(input), confidence: 0.71, required: true },
    { key: "receiptDate", label: "Receipt date", value: dateIso, confidence: 0.98, required: true },
    { key: "transactionDate", label: "Transaction date", value: dateIso, confidence: 0.85, required: false },
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

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Derive the voucher-level field summary from extracted fields. Replaces the
 * hardcoded `grossAmount: 1249` literal both stores used to carry: amounts are
 * parsed from the extraction when present, with a 25% Swedish-standard-rate
 * fallback deriving net/VAT from gross (the legacy canned fields reproduce the
 * historical `{1249, 999.2, 249.8, 25}` exactly — pinned by unit test).
 */
export function deriveVoucherFields(
  extractedFields: ExtractedField[],
  input: Pick<EvidenceCreateInput, "title">,
): VoucherField {
  const text = (key: string) => extractedFields.find((field) => field.key === key)?.value;
  const num = (key: string) => {
    const raw = text(key);
    if (raw === undefined) return undefined;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const grossAmount = num("grossAmount");
  const vatRate = num("vatRate") ?? 25;
  const netAmount =
    num("netAmount") ?? (grossAmount !== undefined ? round2(grossAmount / (1 + vatRate / 100)) : undefined);
  const vatAmount =
    num("vatAmount") ??
    (grossAmount !== undefined && netAmount !== undefined ? round2(grossAmount - netAmount) : undefined);

  return {
    supplierName: text("supplierName"),
    supplierVatNumber: text("supplierVatNumber"),
    invoiceNumber: text("invoiceNumber"),
    receiptDate: text("receiptDate"),
    transactionDate: text("transactionDate"),
    description: input.title,
    grossAmount,
    netAmount,
    vatAmount,
    vatRate,
    currency: "SEK",
  };
}

export function guessAccountingMethod(input: EvidenceCreateInput): AccountingMethod {
  const text = `${input.title} ${input.originalFilename}`.toLowerCase();
  return text.includes("invoice") ? "invoice" : "cash";
}

export function initialLedgerLines(): LedgerLine[] {
  const bookedAt = nowIso();
  const coa = defaultCoaTemplate;
  const itServices = findCoaAccount(coa, "6540")!;
  const inputVat = findCoaAccount(coa, coa.roles.inputVat)!;
  const bank = findCoaAccount(coa, coa.roles.bank)!;
  return [
    {
      voucherId: "voucher_seed_1",
      accountNumber: itServices.number,
      accountName: itServices.name,
      description: "Seeded SaaS subscription",
      debit: 1000,
      credit: 0,
      vatCode: itServices.defaultVatCode,
      bookedAt,
      deductible: true,
    },
    {
      voucherId: "voucher_seed_1",
      accountNumber: inputVat.number,
      accountName: inputVat.name,
      description: "Seeded input VAT",
      debit: 250,
      credit: 0,
      vatCode: "VAT25",
      bookedAt,
      deductible: true,
    },
    {
      voucherId: "voucher_seed_1",
      accountNumber: bank.number,
      accountName: bank.name,
      description: "Seeded bank outflow",
      debit: 0,
      credit: 1250,
      vatCode: "NA",
      bookedAt,
      deductible: false,
    },
  ];
}
