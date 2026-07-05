import type { CashBridge, MonthlyPoint } from "@jpx-accounting/contracts";

import { classifyAccountNumber, defaultCoaTemplate } from "../coa/registry";
import type { CoaAccountClass, CoaTemplate } from "../coa/types";
import type { LedgerLine } from "../projections";
import { filterLedgerLines } from "../projections";

/**
 * Cash reporting (advisory-pivot Phase 4). "Cash" means the BAS 19xx range
 * (kassa/bank). The bridge explains the period's cash movement by attributing
 * each voucher's cash delta across its non-cash counterpart lines,
 * proportionally to |debit − credit|. Vouchers with zero cash delta
 * (depreciation, accruals, pure 19xx↔19xx transfers) are skipped — they move
 * no cash.
 */

const RESULT_CLASSES: ReadonlySet<CoaAccountClass> = new Set([
  "revenue",
  "materials",
  "external-cost",
  "personnel",
  "financial",
]);

function isCashAccount(accountNumber: string): boolean {
  return accountNumber.startsWith("19");
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function cashBalance(lines: LedgerLine[], predicate: (day: string) => boolean): number {
  let balance = 0;
  for (const line of lines) {
    if (!isCashAccount(line.accountNumber)) continue;
    if (!predicate(line.bookedAt.slice(0, 10))) continue;
    balance += line.debit - line.credit;
  }
  return round2(balance);
}

export type CashBridgeOptions = { maxDrivers?: number };

/**
 * Build the opening → drivers → other → closing cash bridge for a period.
 *
 * Invariant held BY CONSTRUCTION: `other.amount` is the residual
 * `closing − opening − Σ drivers`, where `closing` is the independent 19xx
 * balance at `to` — so opening + Σ drivers + other = closing exactly, with
 * rounding drift and unattributable deltas absorbed by the other bucket.
 */
export function buildCashBridge(
  lines: LedgerLine[],
  range: { from: string; to: string },
  options: CashBridgeOptions = {},
): CashBridge {
  const maxDrivers = options.maxDrivers ?? 4;
  const opening = cashBalance(lines, (day) => day < range.from);
  const closing = cashBalance(lines, (day) => day <= range.to);

  const byVoucher = new Map<string, LedgerLine[]>();
  for (const line of filterLedgerLines(lines, range)) {
    const group = byVoucher.get(line.voucherId);
    if (group) {
      group.push(line);
    } else {
      byVoucher.set(line.voucherId, [line]);
    }
  }

  const attributed = new Map<string, { accountName: string; amount: number }>();
  for (const voucherLines of byVoucher.values()) {
    let cashDelta = 0;
    for (const line of voucherLines) {
      if (isCashAccount(line.accountNumber)) cashDelta += line.debit - line.credit;
    }
    // Skip non-cash vouchers — nothing to bridge.
    if (Math.abs(cashDelta) <= 0.005) continue;

    const counterparts = voucherLines.filter((line) => !isCashAccount(line.accountNumber));
    const totalWeight = counterparts.reduce((sum, line) => sum + Math.abs(line.debit - line.credit), 0);
    // No attributable counterpart lines → the residual other bucket absorbs it.
    if (totalWeight <= 0) continue;

    for (const line of counterparts) {
      const weight = Math.abs(line.debit - line.credit);
      if (weight === 0) continue;
      const entry = attributed.get(line.accountNumber) ?? { accountName: line.accountName, amount: 0 };
      entry.amount += cashDelta * (weight / totalWeight);
      attributed.set(line.accountNumber, entry);
    }
  }

  const ranked = [...attributed.entries()]
    .map(([accountNumber, entry]) => ({
      accountNumber,
      accountName: entry.accountName,
      amount: round2(entry.amount),
    }))
    .filter((entry) => Math.abs(entry.amount) > 0.005)
    .sort(
      (left, right) =>
        Math.abs(right.amount) - Math.abs(left.amount) || left.accountNumber.localeCompare(right.accountNumber),
    );

  const drivers = ranked.slice(0, maxDrivers);
  const rest = ranked.slice(maxDrivers);
  const driverSum = drivers.reduce((sum, driver) => sum + driver.amount, 0);

  return {
    opening,
    drivers,
    other: {
      amount: round2(closing - opening - driverSum),
      accountNumbers: rest.map((entry) => entry.accountNumber).sort((left, right) => left.localeCompare(right)),
    },
    closing,
  };
}

const MONTH_TOKEN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * Trailing monthly series ending at `endMonth` (inclusive). `cashClosing` is
 * cumulative from the dawn of the ledger — history before the series start is
 * folded into the first point's closing balance.
 */
export function buildMonthlySeries(
  lines: LedgerLine[],
  endMonth: string,
  months = 12,
  coa: CoaTemplate = defaultCoaTemplate,
): MonthlyPoint[] {
  const match = MONTH_TOKEN.exec(endMonth);
  if (!match) {
    throw new Error(`Invalid endMonth "${endMonth}" — expected YYYY-MM.`);
  }

  const endIndex = Number(match[1]) * 12 + (Number(match[2]) - 1);
  const monthTokens: string[] = [];
  for (let index = endIndex - months + 1; index <= endIndex; index += 1) {
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    monthTokens.push(`${year}-${String(month).padStart(2, "0")}`);
  }
  const firstMonth = monthTokens[0]!;

  let cumulativeCash = 0;
  const pointByMonth = new Map<
    string,
    { cashIn: number; cashOut: number; cashDelta: number; revenue: number; result: number }
  >(monthTokens.map((month) => [month, { cashIn: 0, cashOut: 0, cashDelta: 0, revenue: 0, result: 0 }]));

  for (const line of lines) {
    const month = line.bookedAt.slice(0, 7);
    const cash = isCashAccount(line.accountNumber);
    if (month < firstMonth) {
      if (cash) cumulativeCash += line.debit - line.credit;
      continue;
    }
    const point = pointByMonth.get(month);
    if (!point) continue; // after the series end
    if (cash) {
      point.cashIn += line.debit;
      point.cashOut += line.credit;
      point.cashDelta += line.debit - line.credit;
    }
    const accountClass = classifyAccountNumber(line.accountNumber, coa);
    if (accountClass && RESULT_CLASSES.has(accountClass)) {
      point.result += line.credit - line.debit;
      if (accountClass === "revenue") point.revenue += line.credit - line.debit;
    }
  }

  return monthTokens.map((month) => {
    const point = pointByMonth.get(month)!;
    cumulativeCash += point.cashDelta;
    return {
      month,
      cashIn: round2(point.cashIn),
      cashOut: round2(point.cashOut),
      cashClosing: round2(cumulativeCash),
      revenue: round2(point.revenue),
      result: round2(point.result),
    };
  });
}
