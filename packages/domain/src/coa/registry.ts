import type { CountryCode } from "@jpx-accounting/contracts";

import { bas2026 } from "./bas-2026";
import type { CoaAccount, CoaTemplate } from "./types";

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
