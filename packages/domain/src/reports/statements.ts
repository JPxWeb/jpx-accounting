import type {
  BalanceSheetStatement,
  ProfitLossStatement,
  StatementGroup,
  StatementGroupKey,
  StatementLine,
} from "@jpx-accounting/contracts";

import { classifyAccountNumber, defaultCoaTemplate } from "../coa/registry";
import type { CoaAccountClass, CoaTemplate } from "../coa/types";
import type { LedgerLine } from "../projections";
import { filterLedgerLines } from "../projections";

/**
 * Swedish statement builders (advisory-pivot Phase 4). Grouping comes from
 * CoA account classes via `classifyAccountNumber` (template lookup with a
 * BAS first-digit fallback for out-of-template SIE accounts; unclassifiable
 * accounts are excluded). Sign conventions:
 * - P&L lines: credit − debit (revenue positive, costs negative).
 * - Balance-sheet assets: debit − credit.
 * - Balance-sheet equity/liabilities: credit − debit.
 *
 * Note: `personnel` includes 78xx depreciation because that's how the
 * bas-2026 68-account subset classes 7832/7835 — a documented limitation.
 */

/** Account classes that make up the period result (everything not on the balance sheet). */
const RESULT_CLASSES: ReadonlySet<CoaAccountClass> = new Set([
  "revenue",
  "materials",
  "external-cost",
  "personnel",
  "financial",
]);

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function creditMinusDebit(line: LedgerLine): number {
  return line.credit - line.debit;
}

function debitMinusCredit(line: LedgerLine): number {
  return line.debit - line.credit;
}

function buildGroup(
  key: StatementGroupKey,
  lines: LedgerLine[],
  accountClass: CoaAccountClass,
  amountOf: (line: LedgerLine) => number,
  coa: CoaTemplate,
): StatementGroup {
  const byAccount = new Map<string, StatementLine>();
  for (const line of lines) {
    if (classifyAccountNumber(line.accountNumber, coa) !== accountClass) continue;
    const current = byAccount.get(line.accountNumber) ?? {
      accountNumber: line.accountNumber,
      accountName: line.accountName,
      amount: 0,
    };
    current.amount += amountOf(line);
    byAccount.set(line.accountNumber, current);
  }
  const sorted = [...byAccount.values()]
    .map((entry) => ({ ...entry, amount: round2(entry.amount) }))
    .sort((left, right) => left.accountNumber.localeCompare(right.accountNumber));
  const total = round2(sorted.reduce((sum, entry) => sum + entry.amount, 0));
  return { key, lines: sorted, total };
}

/** Resultatrapport over an inclusive day range. Empty groups are kept with total 0. */
export function buildProfitLoss(
  lines: LedgerLine[],
  range: { from: string; to: string },
  coa: CoaTemplate = defaultCoaTemplate,
): ProfitLossStatement {
  const scoped = filterLedgerLines(lines, range);
  const revenue = buildGroup("revenue", scoped, "revenue", creditMinusDebit, coa);
  const materials = buildGroup("materials", scoped, "materials", creditMinusDebit, coa);
  const externalCost = buildGroup("externalCost", scoped, "external-cost", creditMinusDebit, coa);
  const personnel = buildGroup("personnel", scoped, "personnel", creditMinusDebit, coa);
  const financial = buildGroup("financial", scoped, "financial", creditMinusDebit, coa);

  const operatingResult = round2(revenue.total + materials.total + externalCost.total + personnel.total);
  const financialNet = financial.total;
  const periodResult = round2(operatingResult + financialNet);

  return {
    period: { from: range.from, to: range.to },
    groups: [revenue, materials, externalCost, personnel, financial],
    operatingResult,
    financialNet,
    periodResult,
  };
}

/**
 * Balansrapport as of a day (cumulative over ALL lines up to and including
 * `asOf`). `computedResult` is the cumulative P&L result — no closing entries
 * exist, so the sheet only balances once it is added to equity/liabilities:
 * balanced ⇔ |assets − (equityAndLiabilities + computedResult)| ≤ 0.005.
 */
export function buildBalanceSheet(
  lines: LedgerLine[],
  asOf: string,
  coa: CoaTemplate = defaultCoaTemplate,
): BalanceSheetStatement {
  const scoped = filterLedgerLines(lines, { to: asOf });
  const assets = buildGroup("assets", scoped, "asset", debitMinusCredit, coa);
  const equityAndLiabilities = buildGroup("equityAndLiabilities", scoped, "equity-liability", creditMinusDebit, coa);

  let computed = 0;
  for (const line of scoped) {
    const accountClass = classifyAccountNumber(line.accountNumber, coa);
    if (accountClass && RESULT_CLASSES.has(accountClass)) {
      computed += creditMinusDebit(line);
    }
  }
  const computedResult = round2(computed);
  const balanced = Math.abs(assets.total - (equityAndLiabilities.total + computedResult)) <= 0.005;

  return { asOf, assets, equityAndLiabilities, computedResult, balanced };
}
