import type { ProfitLossStatement, ReportPack, StatementGroupKey, StatementLine } from "@jpx-accounting/contracts";

/**
 * Deterministic narrative facts derived from ONE `ReportPack` (advisory-pivot
 * Phase 4). No LLM, no fetching, no re-computation: every value is copied
 * from the pack the tables render, so prose reconciles with the statements by
 * construction. Only deltas are derived — and a delta is, by definition, the
 * difference of two pack values.
 *
 * Fact order is fixed and deterministic:
 * period-result → biggest-mover → cash-delta → vat-position.
 */
export type NarrativeFact =
  | { id: "period-result"; amount: number; previousAmount?: number; delta?: number }
  | {
      id: "biggest-mover";
      accountNumber: string;
      accountName: string;
      amount: number;
      previousAmount: number;
      delta: number;
    }
  | { id: "cash-delta"; opening: number; closing: number; delta: number }
  | { id: "vat-position"; amount: number; box: "49" };

/** Cost groups eligible for the biggest-mover fact — revenue is deliberately excluded. */
const MOVER_GROUP_KEYS: ReadonlySet<StatementGroupKey> = new Set([
  "materials",
  "externalCost",
  "personnel",
  "financial",
]);

/** Below this a delta is rounding noise, not movement (same epsilon as the cash bridge). */
const MOVEMENT_EPSILON = 0.005;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function costLinesByAccount(statement: ProfitLossStatement): Map<string, StatementLine> {
  const byAccount = new Map<string, StatementLine>();
  for (const group of statement.groups) {
    if (!MOVER_GROUP_KEYS.has(group.key)) continue;
    for (const line of group.lines) {
      byAccount.set(line.accountNumber, line);
    }
  }
  return byAccount;
}

/**
 * Largest |current − previous| across cost-group lines. Accounts absent from
 * one window count as 0 there (no activity). Omitted when the pack has no
 * previous P&L or nothing moved. Ties break to the lowest account number, so
 * the pick is deterministic.
 */
function buildBiggestMover(pack: ReportPack): Extract<NarrativeFact, { id: "biggest-mover" }> | undefined {
  const previousStatement = pack.previousProfitLoss;
  if (!previousStatement) return undefined;

  const currentLines = costLinesByAccount(pack.profitLoss);
  const previousLines = costLinesByAccount(previousStatement);
  const accountNumbers = [...new Set([...currentLines.keys(), ...previousLines.keys()])].sort((left, right) =>
    left.localeCompare(right),
  );

  let best: Extract<NarrativeFact, { id: "biggest-mover" }> | undefined;
  for (const accountNumber of accountNumbers) {
    const current = currentLines.get(accountNumber);
    const previous = previousLines.get(accountNumber);
    const amount = current?.amount ?? 0;
    const previousAmount = previous?.amount ?? 0;
    const delta = round2(amount - previousAmount);
    if (Math.abs(delta) <= MOVEMENT_EPSILON) continue;
    // Strict > keeps the first (lowest) account number on equal |delta|.
    if (best && Math.abs(delta) <= Math.abs(best.delta)) continue;
    best = {
      id: "biggest-mover",
      accountNumber,
      accountName: current?.accountName ?? previous?.accountName ?? accountNumber,
      amount,
      previousAmount,
      delta,
    };
  }
  return best;
}

/**
 * Build the narrative facts for one pack. Always emits `period-result` and
 * `cash-delta`; `biggest-mover` requires a previous window with movement;
 * `vat-position` requires the regime to declare a box 49 (the Swedish regime
 * always does — positive = att betala, negative = att få tillbaka).
 */
export function buildReportNarrative(pack: ReportPack): NarrativeFact[] {
  const facts: NarrativeFact[] = [];

  const previousResult = pack.previousProfitLoss?.periodResult;
  facts.push({
    id: "period-result",
    amount: pack.profitLoss.periodResult,
    ...(previousResult !== undefined
      ? { previousAmount: previousResult, delta: round2(pack.profitLoss.periodResult - previousResult) }
      : {}),
  });

  const mover = buildBiggestMover(pack);
  if (mover) facts.push(mover);

  facts.push({
    id: "cash-delta",
    opening: pack.cashBridge.opening,
    closing: pack.cashBridge.closing,
    delta: round2(pack.cashBridge.closing - pack.cashBridge.opening),
  });

  const netVat = pack.vatReturn.find((entry) => entry.box === "49");
  if (netVat) {
    facts.push({ id: "vat-position", amount: netVat.amount, box: "49" });
  }

  return facts;
}
