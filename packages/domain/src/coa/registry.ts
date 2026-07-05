import type { CountryCode } from "@jpx-accounting/contracts";

import { bas2026 } from "./bas-2026";
import type { CoaAccount, CoaAccountClass, CoaTemplate } from "./types";

export const coaTemplates: CoaTemplate[] = [bas2026];

/**
 * Resolve a chart-of-accounts template for a country. Throws on unknown
 * combinations so callers fail loudly instead of silently posting against a
 * missing chart.
 */
export function getCoaTemplate(country: CountryCode, templateId = "bas-2026"): CoaTemplate {
  const template = coaTemplates.find((candidate) => candidate.country === country && candidate.id === templateId);
  if (!template) {
    throw new Error(`Unknown CoA template "${templateId}" for country "${country}"`);
  }
  return template;
}

export const defaultCoaTemplate = bas2026;

export function findCoaAccount(template: CoaTemplate, number: string): CoaAccount | undefined {
  return template.accounts.find((account) => account.number === number);
}

const CLASS_BY_FIRST_DIGIT: Record<string, CoaAccountClass> = {
  "1": "asset",
  "2": "equity-liability",
  "3": "revenue",
  "4": "materials",
  "5": "external-cost",
  "6": "external-cost",
  "7": "personnel",
  "8": "financial",
};

/**
 * Classify an account number for statement grouping (advisory-pivot Phase 4).
 * Template lookup first; accounts outside the template (SIE imports can post
 * anything) fall back to the BAS first-digit range. Non-numeric account
 * numbers — and digits outside 1–8 (BAS 9xxx internal accounting) — return
 * `undefined` and are excluded from statements.
 */
export function classifyAccountNumber(
  accountNumber: string,
  coa: CoaTemplate = defaultCoaTemplate,
): CoaAccountClass | undefined {
  const account = findCoaAccount(coa, accountNumber);
  if (account) return account.accountClass;
  if (!/^\d+$/.test(accountNumber)) return undefined;
  return CLASS_BY_FIRST_DIGIT[accountNumber[0]!];
}
