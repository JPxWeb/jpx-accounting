import type { AccountBalanceProjection } from "@jpx-accounting/contracts";

export * from "./kpis";
export * from "./narrative";
export * from "./observations";

// summarizeJournal/summarizeVat were deleted in Phase 4 Task 4.6 — the
// reports screen renders from the ReportPack (buildKpis/buildReportNarrative).
export function summarizeBalances(balances: AccountBalanceProjection[]) {
  return balances.filter((balance) => Math.abs(balance.balance) > 0).slice(0, 6);
}
