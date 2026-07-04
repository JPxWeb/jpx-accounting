"use client";

import { buildKpis, buildReportNarrative } from "@jpx-accounting/reporting";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { parseAsString, useQueryState } from "nuqs";
import { useState } from "react";
import { toast } from "sonner";

import { usePeriodScope } from "../../hooks/use-period-scope";
import { apiClient } from "../../lib/client";
import { getErrorMessage } from "../../lib/request-errors";
import { PeriodSelector } from "../period/period-selector";
import { AccountDrillDrawer } from "../reports/account-drill-drawer";
import { BalanceSheetStatement } from "../reports/balance-sheet-statement";
import { ChartSkeleton } from "../reports/charts/chart-kit";
import { KpiRow } from "../reports/kpi-row";
import { NarrativeCard } from "../reports/narrative-card";
import { PnlStatement } from "../reports/pnl-statement";
import { PrintHeader } from "../reports/print-header";
import { TaxTimelineRow } from "../reports/tax-timeline-row";
import { VatReturnTable } from "../reports/vat-return-table";
import { ScreenHeader } from "../ui/screen-header";
import { SectionLabel } from "../ui/section-label";
import { ScreenSkeleton } from "../ui/skeleton";
import { StatusBadge } from "../ui/status-badge";
import { UnavailableState } from "../ui/unavailable-state";

/**
 * Reports v2 (advisory-pivot Phase 4): narrative-first, ONE `ReportPack` per
 * period is the single source object — prose, KPIs, charts, and the
 * statements all render from the same fetched values, so they can never
 * disagree.
 *
 * Recharts stays out of the eager bundle: every chart module is loaded via
 * `next/dynamic({ ssr: false })` (this screen is already a client component,
 * so `ssr: false` is allowed), with `ChartSkeleton` holding the layout while
 * the chunk arrives. All three dynamic imports share the ONE
 * `../reports/charts` barrel specifier on purpose: separate specifiers made
 * Turbopack emit a ~290 kB recharts core per chart (see the barrel's note).
 */
const MonthlyBarsChart = dynamic(() => import("../reports/charts").then((mod) => mod.MonthlyBarsChart), {
  ssr: false,
  loading: ChartSkeleton,
});
const CashBridgeChart = dynamic(() => import("../reports/charts").then((mod) => mod.CashBridgeChart), {
  ssr: false,
  loading: ChartSkeleton,
});
const Sparkline = dynamic(() => import("../reports/charts").then((mod) => mod.Sparkline), { ssr: false });
export function ReportsScreen() {
  const t = useTranslations("reports");
  const { raw } = usePeriodScope();
  const [exporting, setExporting] = useState(false);
  // The drill drawer's open account IS the ?drill= URL param (Task 4.8); the
  // drawer component reads the same key, so this setter is the one wiring
  // every drill source (statement rows, waterfall bars, mover chip) needs.
  const [, setDrill] = useQueryState("drill", parseAsString);

  function openDrill(accountNumber: string) {
    void setDrill(accountNumber);
  }

  const packQuery = useQuery({
    queryKey: ["reports", "pack", raw],
    queryFn: () => apiClient.getReportPack(raw),
  });
  // The snapshot only feeds the compliance alerts panel; the pack carries
  // every reporting number.
  const workspaceQuery = useQuery({
    queryKey: ["workspace"],
    queryFn: () => apiClient.getSnapshot(),
  });

  const pack = packQuery.data;

  async function exportSie() {
    setExporting(true);
    try {
      // PC8/CP437 bytes from the real domain serializer — never re-encode as UTF-8.
      const bytes = await apiClient.fetchSieExport();
      const blob = new Blob([bytes], { type: "text/plain;charset=ibm437" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const day = new Date().toISOString().slice(0, 10);
      anchor.href = url;
      anchor.download = `jpx-export-${day}.se`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(getErrorMessage(error, t("export.error")));
    } finally {
      setExporting(false);
    }
  }

  if (packQuery.error && !pack) {
    return (
      <UnavailableState
        testId="reports-unavailable"
        title={t("unavailable.title")}
        message={getErrorMessage(packQuery.error, t("unavailable.message"))}
      />
    );
  }

  if (!pack) {
    return <ScreenSkeleton />;
  }

  const kpis = buildKpis(pack);
  const facts = buildReportNarrative(pack);
  const alerts = workspaceQuery.data?.alerts ?? [];

  return (
    <div className="page-shell space-y-6">
      <PrintHeader generatedAt={pack.generatedAt} />

      <ScreenHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        aside={
          // Interactive controls disappear from the printed pack (Task 4.9).
          <div className="flex w-full flex-col gap-3 sm:items-end print:hidden">
            <div className="flex flex-wrap gap-3 sm:justify-end">
              <button
                type="button"
                data-testid="print-report"
                onClick={() => window.print()}
                className="rounded-lg bg-surface-muted px-5 py-3 text-sm font-semibold text-foreground shadow-sm"
              >
                {t("print.button")}
              </button>
              <button
                type="button"
                data-testid="export-sie"
                disabled={exporting}
                onClick={() => void exportSie()}
                className="rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-white shadow-md disabled:opacity-60"
              >
                {exporting ? t("export.exporting") : t("export.button")}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">{t("export.hint")}</p>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <PeriodSelector />
      </div>

      <KpiRow
        kpis={kpis}
        sparklines={{
          result: <Sparkline values={kpis.sparklines.result} />,
          cash: <Sparkline values={kpis.sparklines.cash} />,
          revenue: <Sparkline values={kpis.sparklines.revenue} />,
        }}
      />

      <NarrativeCard facts={facts} onSelectAccount={openDrill} />

      <MonthlyBarsChart monthly={pack.monthly} />

      <CashBridgeChart bridge={pack.cashBridge} onDrill={openDrill} />

      <PnlStatement statement={pack.profitLoss} onSelectAccount={openDrill} />

      <BalanceSheetStatement statement={pack.balanceSheet} onSelectAccount={openDrill} />

      <VatReturnTable boxes={pack.vatReturn} />

      <TaxTimelineRow />

      <section id="compliance-watch" className="glass-panel rounded-xl p-5" data-testid="alerts-panel">
        <SectionLabel>{t("alerts.label")}</SectionLabel>
        <h2 className="mt-2 text-lg font-semibold">{t("alerts.title")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("alerts.description")}</p>
        <div className="mt-4 space-y-3">
          {alerts.map((alert) => (
            <div key={alert.id} className="glass-panel-soft rounded-xl px-4 py-4">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-semibold text-foreground">{alert.title}</p>
                <StatusBadge status={alert.source} variant="warning" />
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{alert.impactSummary}</p>
            </div>
          ))}
        </div>
      </section>

      <AccountDrillDrawer />
    </div>
  );
}
