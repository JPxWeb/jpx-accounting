import type { ExtractedField } from "@jpx-accounting/contracts";

/**
 * Deterministic file-seeded extraction. Both `createEvidence` (when the input
 * carries `sizeBytes`) and the stub Document Intelligence client derive fields
 * from the same `{filename, sizeBytes}` seed, so an extraction refresh over a
 * freshly-created evidence object is a stable no-op on values (idempotent).
 *
 * The derivation formula is pinned by the Phase 3 plan
 * (docs/superpowers/plans/2026-07-03-advisory-pivot-phase-3-detail.md, Task 3.1)
 * and by tests/unit/deterministic-extraction.test.ts — do not tweak constants
 * without updating both.
 */

export type DeterministicSeed = { filename: string; sizeBytes: number };

/** 32-bit FNV-1a hash over the UTF-16 code units of `input`. */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Swedish-plausible suppliers; index picked via `h % 5`, in lockstep with VAT_RATES.
const SUPPLIERS = [
  "Kontorsgiganten AB",
  "Nordisk Programvara AB",
  "Svea Kontorsmaterial AB",
  "Kaffekompaniet Stockholm AB",
  "Molntjänster Sverige AB",
] as const;

// Swedish VAT rates weighted toward the standard 25% band.
const VAT_RATES = [25, 25, 25, 12, 6] as const;

/**
 * Derive a complete, rule-gate-satisfying `ExtractedField[]` from a file seed.
 * All required fields (supplier, dates, amounts, invoice + VAT numbers) are
 * present so promoted evidence is approvable, exercising the un-blocked review
 * path end-to-end.
 */
export function deriveDeterministicExtraction(seed: DeterministicSeed, dateIso: string): ExtractedField[] {
  const h = fnv1a(`${seed.filename}:${seed.sizeBytes}`);
  const pick = h % 5;
  const supplierName = SUPPLIERS[pick]!;
  const vatRate = VAT_RATES[pick]!;
  const grossAmount = round2(100 + (h % 490000) / 100);
  const netAmount = round2(grossAmount / (1 + vatRate / 100));
  const vatAmount = round2(grossAmount - netAmount);
  const invoiceNumber = `INV-${10000 + (h % 90000)}`;
  const supplierVatNumber = `SE${(h % 1e10).toString().padStart(10, "0")}01`;

  return [
    { key: "supplierName", label: "Supplier", value: supplierName, confidence: 0.93, required: true },
    { key: "receiptDate", label: "Receipt date", value: dateIso, confidence: 0.97, required: true },
    { key: "transactionDate", label: "Transaction date", value: dateIso, confidence: 0.9, required: false },
    { key: "grossAmount", label: "Gross amount", value: grossAmount.toFixed(2), confidence: 0.95, required: true },
    { key: "netAmount", label: "Net amount", value: netAmount.toFixed(2), confidence: 0.9, required: false },
    { key: "vatAmount", label: "VAT amount", value: vatAmount.toFixed(2), confidence: 0.9, required: false },
    { key: "vatRate", label: "VAT rate", value: String(vatRate), confidence: 0.88, required: false },
    { key: "invoiceNumber", label: "Invoice number", value: invoiceNumber, confidence: 0.86, required: false },
    { key: "supplierVatNumber", label: "VAT number", value: supplierVatNumber, confidence: 0.84, required: false },
  ];
}
