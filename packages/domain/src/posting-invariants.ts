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

/**
 * Thrown when journal lines about to be posted carry an amount finer than one
 * öre. Same class as `UnbalancedPostingError` — a server-side invariant
 * violation surfacing as the catch-all 500, never a client-correctable input
 * error (client input is rejected earlier as `InvalidManualVoucherError` /
 * `InvalidReviewEditError` → 422) — so it deliberately has no dedicated
 * `app.onError` branch, and nothing is appended to the ledger.
 */
export class NonOreExactPostingError extends Error {
  readonly amount: number;

  constructor(amount: number, side: "debit" | "credit", accountNumber: string | undefined, context?: string) {
    super(
      `Non-öre-exact posting${context ? ` for ${context}` : ""}: ${side} ${amount}${
        accountNumber ? ` on account ${accountNumber}` : ""
      } has more precision than one öre.`,
    );
    this.name = "NonOreExactPostingError";
    this.amount = amount;
  }
}

/**
 * True when `value` is a finite amount expressible in whole öre (at most two
 * decimals).
 *
 * This is the blind spot `postingImbalanceOre` cannot cover: it compares
 * INTEGER öre, so a 100.003 debit against a 100.00 credit rounds to a
 * PERFECTLY BALANCED entry — while the raw 100.003 is what actually gets
 * stored and re-summed as a float by every projection. Balance and precision
 * are two separate invariants; check both.
 */
export function isOreExact(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value * 100 - Math.round(value * 100)) <= 1e-6;
}

/**
 * Assert every line amount is öre-exact. Returns the same array so producers
 * can compose it with `assertBalancedPosting`; throws
 * `NonOreExactPostingError` otherwise.
 *
 * Belongs on any path that posts amounts VERBATIM (manual vouchers), where no
 * derivation rounds the inputs on the way in. Derived shapes in
 * `buildPostingLines` compute their legs from extracted voucher fields and are
 * covered by `assertBalancedPosting` alone.
 */
export function assertOreExactLines<T extends PostingAmounts & { accountNumber?: string }>(
  lines: T[],
  context?: string,
): T[] {
  for (const line of lines) {
    for (const [side, value] of [
      ["debit", line.debit],
      ["credit", line.credit],
    ] as const) {
      if (!isOreExact(value)) {
        throw new NonOreExactPostingError(value, side, line.accountNumber, context);
      }
    }
  }
  return lines;
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
