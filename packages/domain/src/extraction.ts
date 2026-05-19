import type { AccountingMethod, EvidenceCreateInput, ExtractedField } from "@jpx-accounting/contracts";
import { today } from "./ids";

export function guessSupplier(input: EvidenceCreateInput): string {
  const value = `${input.title} ${input.originalFilename} ${input.extractedText ?? ""}`.toLowerCase();
  if (value.includes("microsoft")) return "Microsoft Ireland";
  if (value.includes("openai")) return "OpenAI Ireland";
  if (value.includes("ica")) return "ICA Maxi";
  if (value.includes("sl")) return "Storstockholms Lokaltrafik";
  return "Unclassified supplier";
}

export function guessAccountingMethod(input: EvidenceCreateInput): AccountingMethod {
  const text = `${input.title} ${input.originalFilename}`.toLowerCase();
  return text.includes("invoice") ? "invoice" : "cash";
}

export function buildExtractedFields(input: EvidenceCreateInput): ExtractedField[] {
  return [
    { key: "supplierName", label: "Supplier", value: guessSupplier(input), confidence: 0.71, required: true },
    { key: "receiptDate", label: "Receipt date", value: today(), confidence: 0.98, required: true },
    { key: "transactionDate", label: "Transaction date", value: today(), confidence: 0.85, required: false },
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
