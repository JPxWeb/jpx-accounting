import type { AccountingSuggestion, Citation, ExtractedField, RuleHit, Voucher } from "@jpx-accounting/contracts";

import { defaultCoaTemplate, findCoaAccount } from "./coa/registry";
import { createId } from "./ids";

const bookkeepingCitation: Citation = {
  id: "c_bokforingslagen_5_7",
  title: "Bokföringslagen 5 kap. 7 §",
  sourceType: "official",
  url: "https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/bokforingslag-19991078_sfs-1999-1078/",
  excerpt: "Verifikation ska innehålla uppgifter som gör sambandet med affärshändelsen tydligt.",
  effectiveDate: "1999-12-10",
};

const vatCitation: Citation = {
  id: "c_skv552_invoice",
  title: "Skatteverket SKV 552B",
  sourceType: "official",
  url: "https://skatteverket.se/download/18.361dc8c15312eff6fd117b1/1708607408713/the-vat-brochure-skv552b-utgava15.pdf",
  excerpt: "Avdrag för ingående moms kräver korrekt fakturaunderlag.",
};

function hasField(fields: ExtractedField[], key: string) {
  return fields.some((field) => field.key === key && field.value.trim().length > 0);
}

/**
 * ONE shared confidence-band vocabulary (advisory pivot Phase 5). Replaces the
 * web's former 0.95/0.80 tiers (`filter-types.ts` delegates here): the seeded
 * demo review at 0.86 lands in "high", making batch-approve exercisable in
 * demo E2E — deliberate (plan finding 3). Bands render as text + color, never
 * color alone.
 */
export type ConfidenceBand = "high" | "medium" | "low";

export const CONFIDENCE_HIGH_THRESHOLD = 0.85;
export const CONFIDENCE_MEDIUM_THRESHOLD = 0.6;

export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= CONFIDENCE_HIGH_THRESHOLD) return "high";
  if (confidence >= CONFIDENCE_MEDIUM_THRESHOLD) return "medium";
  return "low";
}

export function evaluateVoucherRules(voucher: Voucher) {
  const ruleHits: RuleHit[] = [];
  const fields = voucher.extractedFields;
  const vatAmount = voucher.voucherFields.vatAmount ?? 0;

  if (!hasField(fields, "supplierName")) {
    ruleHits.push({
      id: createId("rule"),
      code: "VOUCHER_SUPPLIER_MISSING",
      title: "Supplier missing",
      severity: "blocking",
      message: "Supplier name must be confirmed before the voucher can be posted.",
      sourceIds: [bookkeepingCitation.id],
    });
  }

  if (!hasField(fields, "receiptDate")) {
    ruleHits.push({
      id: createId("rule"),
      code: "VOUCHER_DATE_MISSING",
      title: "Date missing",
      severity: "blocking",
      message: "Receipt or invoice date must be present for the verification chain.",
      sourceIds: [bookkeepingCitation.id],
    });
  }

  if (!hasField(fields, "grossAmount")) {
    ruleHits.push({
      id: createId("rule"),
      code: "AMOUNT_MISSING",
      title: "Amount missing",
      severity: "blocking",
      message: "Gross amount is required before the voucher can be reviewed.",
      sourceIds: [bookkeepingCitation.id],
    });
  }

  if (vatAmount > 0 && !hasField(fields, "supplierVatNumber")) {
    ruleHits.push({
      id: createId("rule"),
      code: "VAT_NUMBER_MISSING",
      title: "VAT invoice data incomplete",
      severity: "blocking",
      message: "Supplier VAT number is missing, so deductible VAT should be blocked pending review.",
      sourceIds: [vatCitation.id],
    });
  }

  if (vatAmount > 0 && !hasField(fields, "invoiceNumber")) {
    ruleHits.push({
      id: createId("rule"),
      code: "INVOICE_NUMBER_MISSING",
      title: "Invoice number missing",
      severity: "warning",
      message: "Invoice number is recommended for stronger traceability and VAT support.",
      sourceIds: [vatCitation.id, bookkeepingCitation.id],
    });
  }

  return ruleHits;
}

export function buildDeterministicSuggestion(voucher: Voucher, ruleHits: RuleHit[]): AccountingSuggestion {
  const description = voucher.voucherFields.description?.toLowerCase() ?? "";
  const supplier = voucher.voucherFields.supplierName?.toLowerCase() ?? "";
  const coa = defaultCoaTemplate;
  let account = findCoaAccount(coa, coa.roles.fallbackExpense)!;
  let confidence = 0.64;

  if (supplier.includes("ica") || description.includes("office")) {
    account = findCoaAccount(coa, "6110") ?? account;
    confidence = 0.82;
  } else if (supplier.includes("uber") || supplier.includes("sl")) {
    account = findCoaAccount(coa, "5610") ?? account;
    confidence = 0.77;
  } else if (description.includes("subscription") || supplier.includes("microsoft") || supplier.includes("openai")) {
    account = findCoaAccount(coa, "6540") ?? account;
    confidence = 0.86;
  } else if (description.includes("lunch") || description.includes("representation")) {
    account = findCoaAccount(coa, "6071") ?? account;
    confidence = 0.73;
  } else if (description.includes("material")) {
    account = findCoaAccount(coa, "5460") ?? account;
    confidence = 0.8;
  }

  const blockingHits = ruleHits.filter((rule) => rule.severity === "blocking");

  return {
    id: createId("sug"),
    voucherId: voucher.id,
    accountNumber: account.number,
    accountName: account.name,
    vatCode: blockingHits.length > 0 ? "VAT-REVIEW" : account.defaultVatCode,
    confidence: blockingHits.length > 0 ? Math.min(confidence, 0.49) : confidence,
    reasoning:
      blockingHits.length > 0
        ? "A likely account was identified, but the voucher is blocked by mandatory review checks before deductible VAT can be used."
        : "The suggestion combines extracted merchant context, description cues, and BAS-oriented heuristics for Swedish SME bookkeeping.",
    kind: "recommendation",
    citations: [bookkeepingCitation, vatCitation],
    ruleHits,
  };
}
