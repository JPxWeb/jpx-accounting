import type { LedgerLine } from "./projections";

/**
 * Double-entry balance invariant for posted journal lines (Bokföringslagen):
 * Σdebit must equal Σcredit to the öre. Sums are compared in integer öre so
 * IEEE-754 accumulation noise (e.g. 98.76 + 24.69) can neither fake nor mask
 * an imbalance.
 */

export type PostingAmounts = Pick<LedgerLine, "debit" | "credit">;

/**
 * Thrown when a posting path is about to write journal lines whose debits and
 * credits do not match to the öre. This is a server-side invariant violation,
 * not a client-correctable input error (those are rejected earlier as
 * `InvalidReviewEditError` → 422), so it deliberately has no dedicated
 * `app.onError` branch: it surfaces as the catch-all 500 with a structured
 * error log, and — crucially — nothing is appended to the ledger.
 */
export class UnbalancedPostingError extends Error {
  readonly debitTotal: number;
  readonly creditTotal: number;

  constructor(debitTotal: number, creditTotal: number, context?: string) {
    super(
      `Unbalanced posting${context ? ` for ${context}` : ""}: debits ${debitTotal.toFixed(2)} != credits ${creditTotal.toFixed(2)}.`,
    );
    this.name = "UnbalancedPostingError";
    this.debitTotal = debitTotal;
    this.creditTotal = creditTotal;
  }
}

function toOre(value: number): number {
  return Math.round(value * 100);
}

/** Σdebit − Σcredit in integer öre; 0 means the lines balance. */
export function postingImbalanceOre(lines: ReadonlyArray<PostingAmounts>): number {
  let imbalance = 0;
  for (const line of lines) {
    imbalance += toOre(line.debit) - toOre(line.credit);
  }
  return imbalance;
}

/**
 * Assert Σdebit === Σcredit to the öre. Returns the same array so producers
 * can `return assertBalancedPosting(lines, ...)`; throws
 * `UnbalancedPostingError` (also on NaN/non-finite amounts) otherwise.
 */
export function assertBalancedPosting<T extends PostingAmounts>(lines: T[], context?: string): T[] {
  const imbalance = postingImbalanceOre(lines);
  // NaN/±Infinity amounts also land here: `NaN !== 0` is true.
  if (imbalance !== 0) {
    const debitTotal = lines.reduce((sum, line) => sum + toOre(line.debit), 0) / 100;
    const creditTotal = lines.reduce((sum, line) => sum + toOre(line.credit), 0) / 100;
    throw new UnbalancedPostingError(debitTotal, creditTotal, context);
  }
  return lines;
}
