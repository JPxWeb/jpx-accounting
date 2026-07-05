/**
 * Suggested-prompt keys for the advisor screen. The advisor package ships
 * i18n KEYS, never copy — the web's `advisor.prompts.*` message namespace
 * (Task 5.9) owns the localized strings.
 */

/** Observation detector → the prompt key that invites a follow-up question about it. */
const DETECTOR_PROMPT_KEYS: Record<string, string> = {
  "cash-runway": "advisor.prompts.cashRunway",
  "expense-anomaly": "advisor.prompts.expenseAnomaly",
  "vat-set-aside": "advisor.prompts.vatSetAside",
  "deadline-proximity": "advisor.prompts.deadlineProximity",
  "missing-evidence": "advisor.prompts.missingEvidence",
  "supplier-spike": "advisor.prompts.supplierSpike",
};

/** Static trio shown when observations don't fill all three slots. */
export const FALLBACK_PROMPT_KEYS: readonly string[] = [
  "advisor.prompts.cashPosition",
  "advisor.prompts.vatDeadline",
  "advisor.prompts.representationRules",
];

const MAX_PROMPTS = 3;

/**
 * Pick ≤ 3 prompt keys from the (pre-ranked) observations, deduplicated,
 * topped up from the static fallback trio. Pure and order-preserving: the
 * observation ranking from `buildObservations` decides priority.
 */
export function suggestedPromptKeys(observations: readonly { detector: string }[]): string[] {
  const keys: string[] = [];
  for (const observation of observations) {
    if (keys.length === MAX_PROMPTS) return keys;
    const key = DETECTOR_PROMPT_KEYS[observation.detector];
    if (key && !keys.includes(key)) keys.push(key);
  }
  for (const key of FALLBACK_PROMPT_KEYS) {
    if (keys.length === MAX_PROMPTS) break;
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}
