import type { AccountingMethod, EvidenceCreateInput, ExtractedField } from "@jpx-accounting/contracts";

import { nowIso } from "./ids";
import type { LedgerLine } from "./projections";

/**
 * Scaffold helpers for turning a freshly-uploaded evidence object into review-ready
 * fields, postings, and a method guess. Shared between MemoryLedgerStore and
 * PostgresLedgerStore so the two stay in lockstep — both stores expect identical
 * behavior so parity tests in tests/integration/postgres-ledger.test.ts pass.
 *
 * Replace each helper with the real Document Intelligence output once that flow
 * lands (CLAUDE.md `Don't accidentally redo` → "Phase E.X stub OCR").
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
  const today = new Date().toISOString().slice(0, 10);
  return [
    { key: "supplierName", label: "Supplier", value: guessSupplier(input), confidence: 0.71, required: true },
    { key: "receiptDate", label: "Receipt date", value: today, confidence: 0.98, required: true },
    { key: "transactionDate", label: "Transaction date", value: today, confidence: 0.85, required: false },
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

export function guessAccountingMethod(input: EvidenceCreateInput): AccountingMethod {
  const text = `${input.title} ${input.originalFilename}`.toLowerCase();
  return text.includes("invoice") ? "invoice" : "cash";
}

export function initialLedgerLines(): LedgerLine[] {
  const bookedAt = nowIso();
  return [
    {
      voucherId: "voucher_seed_1",
      accountNumber: "6540",
      accountName: "IT-tjänster",
      description: "Seeded SaaS subscription",
      debit: 1000,
      credit: 0,
      vatCode: "VAT25",
      bookedAt,
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
      bookedAt,
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
      bookedAt,
      deductible: false,
    },
  ];
}
