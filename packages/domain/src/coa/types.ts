import type { CountryCode } from "@jpx-accounting/contracts";

/**
 * Chart-of-accounts registry types (advisory-pivot Phase 2). The CoA is data:
 * Sweden's BAS 2026 subset is a template ENTRY, not a hardcode. Posting,
 * suggestion, and seed code resolve account numbers/names through
 * `CoaTemplate.roles` + `findCoaAccount` instead of string literals.
 */

export type VatCodeId = "VAT25" | "VAT12" | "VAT6" | "VAT0" | "NA" | "VAT-REVIEW";

export type CoaAccountClass =
  | "asset"
  | "equity-liability"
  | "revenue"
  | "materials"
  | "external-cost"
  | "personnel"
  | "financial";

export type CoaAccount = {
  number: string;
  name: string;
  nameEn?: string;
  accountClass: CoaAccountClass;
  defaultVatCode: VatCodeId;
  deductibilityRuleId?: string;
};

export type CoaRoleMap = {
  bank: string;
  cash: string;
  accountsReceivable: string;
  accountsPayable: string;
  inputVat: string;
  outputVatByRate: Record<"VAT25" | "VAT12" | "VAT6", string>;
  vatSettlement: string;
  fallbackExpense: string;
  rounding: string;
};

export type CoaTemplate = {
  id: string;
  country: CountryCode;
  name: string;
  accounts: CoaAccount[];
  roles: CoaRoleMap;
};
