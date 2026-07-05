import type { ReportPack } from "@jpx-accounting/contracts";

/**
 * The reports screen's four headline KPIs plus sparkline series — every value
 * read straight off the same `ReportPack` the tables render (reconciled by
 * construction). Sparklines follow `pack.monthly` order: the trailing twelve
 * calendar months ending at the period's last month.
 */
export type ReportKpis = {
  /** Period result (`pack.profitLoss.periodResult`). */
  result: number;
  /** Cash (19xx) balance at the period's last day (`pack.cashBridge.closing`). */
  cash: number;
  /** Revenue-group total for the period. */
  revenue: number;
  /** Net VAT position, box 49 (positive = att betala, negative = att få tillbaka). */
  vat: number;
  sparklines: { result: number[]; cash: number[]; revenue: number[] };
};

export function buildKpis(pack: ReportPack): ReportKpis {
  const revenueGroup = pack.profitLoss.groups.find((group) => group.key === "revenue");
  const netVat = pack.vatReturn.find((entry) => entry.box === "49");
  return {
    result: pack.profitLoss.periodResult,
    cash: pack.cashBridge.closing,
    revenue: revenueGroup?.total ?? 0,
    vat: netVat?.amount ?? 0,
    sparklines: {
      result: pack.monthly.map((point) => point.result),
      cash: pack.monthly.map((point) => point.cashClosing),
      revenue: pack.monthly.map((point) => point.revenue),
    },
  };
}
