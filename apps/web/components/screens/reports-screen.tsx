"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";

import { getErrorMessage } from "../../lib/request-errors";
import { formatMoney } from "../../lib/presentation";
import { summarizeBalances, summarizeJournal, summarizeVat } from "@jpx-accounting/reporting";
import { apiClient } from "../../lib/client";
import { getPeriodDayRange, journalEntryInPeriod, type ReportPeriodPreset } from "../../lib/report-period";
import { ScreenHeader } from "../ui/screen-header";
import { UnavailableState } from "../ui/unavailable-state";
import { SectionLabel } from "../ui/section-label";
import { ScreenSkeleton } from "../ui/skeleton";
import { StatusBadge } from "../ui/status-badge";

const periodOptions: { value: ReportPeriodPreset; label: string }[] = [
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "q1", label: "Q1" },
  { value: "q2", label: "Q2" },
  { value: "q3", label: "Q3" },
  { value: "q4", label: "Q4" },
  { value: "ytd", label: "Year to date" },
  { value: "all", label: "All periods" },
];

export function ReportsScreen() {
  const [period, setPeriod] = useState<ReportPeriodPreset>("this-month");
  const [exporting, setExporting] = useState(false);

  const workspaceQuery = useQuery({
    queryKey: ["workspace"],
    queryFn: () => apiClient.getSnapshot(),
  });
  const { data } = workspaceQuery;

  const { startDay, endDay } = useMemo(() => getPeriodDayRange(period), [period]);

  const filteredJournal = useMemo(() => {
    const journal = data?.reports.journal ?? [];
    if (period === "all") return journal;
    return journal.filter((entry) => journalEntryInPeriod(entry.bookedAt, startDay, endDay));
  }, [data?.reports.journal, period, startDay, endDay]);

  const journalSummary = summarizeJournal(filteredJournal);
  const balanceSummary = summarizeBalances(data?.reports.balances ?? []);
  const vatSummary = summarizeVat(data?.reports.vat ?? []);

  async function exportSie() {
    setExporting(true);
    try {
      const text = await apiClient.fetchSieExport();
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const day = new Date().toISOString().slice(0, 10);
      anchor.href = url;
      anchor.download = `jpx-export-${day}.si`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(getErrorMessage(error, "SIE export failed."));
    } finally {
      setExporting(false);
    }
  }

  if (workspaceQuery.error && !data) {
    return (
      <UnavailableState
        testId="reports-unavailable"
        title="Reports unavailable"
        message={getErrorMessage(
          workspaceQuery.error,
          "Reports could not be loaded. Check the runtime configuration and API availability.",
        )}
      />
    );
  }

  if (!data) {
    return <ScreenSkeleton />;
  }

  return (
    <div className="page-shell space-y-6">
      <ScreenHeader
        eyebrow="Reports"
        title="Reports"
        description="Journal, balances, and VAT views all project from the same append-only event history, so the polished UI never drifts away from the audit spine."
        aside={
          <div className="flex w-full flex-col gap-3 sm:items-end">
            <button
              type="button"
              data-testid="export-sie"
              disabled={exporting}
              onClick={() => void exportSie()}
              className="rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-white shadow-md disabled:opacity-60"
            >
              {exporting ? "Exporting…" : "Export SIE"}
            </button>
            <p className="text-xs text-muted-foreground">Downloads the workspace SIE file from the API.</p>
          </div>
        }
      />

      <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background/90 px-3 py-2 shadow-sm backdrop-blur-md sm:gap-3">
        <span className="text-eyebrow">Reporting period</span>
        <label className="sr-only" htmlFor="report-period">
          Reporting period
        </label>
        <select
          id="report-period"
          data-testid="report-period"
          value={period}
          onChange={(event) => setPeriod(event.target.value as ReportPeriodPreset)}
          className="glass-panel-inset max-w-[14rem] rounded-lg px-3 py-2 text-sm outline-none"
        >
          {periodOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          Journal metrics respect this range. Balances and VAT remain full snapshot.
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          data-testid="journal-summary"
          className="glass-panel rounded-xl p-5"
        >
          <h2 className="text-lg font-semibold">Journal summary</h2>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[
              { label: "Entries", value: journalSummary.count },
              { label: "Debit", value: formatMoney(journalSummary.totalDebit) },
              { label: "Credit", value: formatMoney(journalSummary.totalCredit) },
            ].map((item) => (
              <div key={item.label} className="glass-panel-soft rounded-xl p-4">
                <SectionLabel>{item.label}</SectionLabel>
                <p className="mt-3 text-xl font-semibold tabular-nums">{item.value}</p>
              </div>
            ))}
          </div>
        </motion.section>

        <section className="glass-panel rounded-xl p-5" data-testid="trial-balance">
          <h2 className="text-lg font-semibold">Trial balance view</h2>
          <div className="mt-4 space-y-3">
            {balanceSummary.map((balance) => (
              <article key={balance.accountNumber} className="glass-panel-soft rounded-xl p-4 text-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-medium text-foreground">{balance.accountName}</p>
                    <p className="text-mono text-xs text-muted-foreground">{balance.accountNumber}</p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums text-foreground">{formatMoney(balance.balance)}</p>
                </div>
                <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="glass-panel-inset rounded-xl px-3 py-3">
                    <dt className="text-eyebrow">Debit</dt>
                    <dd className="mt-2 font-semibold tabular-nums text-foreground">{formatMoney(balance.debit)}</dd>
                  </div>
                  <div className="glass-panel-inset rounded-xl px-3 py-3">
                    <dt className="text-eyebrow">Credit</dt>
                    <dd className="mt-2 font-semibold tabular-nums text-foreground">{formatMoney(balance.credit)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </section>
      </div>

      <section className="glass-panel rounded-xl p-5" data-testid="vat-preparation">
        <h2 className="text-lg font-semibold">VAT preparation</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {vatSummary.map((entry) => (
            <div key={entry.vatCode} className="glass-panel-soft rounded-xl p-4">
              <SectionLabel>{entry.label}</SectionLabel>
              <p className="mt-3 text-2xl font-semibold tabular-nums">{formatMoney(entry.vatAmount)}</p>
              <p className="mt-2 text-sm tabular-nums text-muted-foreground">Base {formatMoney(entry.baseAmount)}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="compliance-watch" className="glass-panel rounded-xl p-5" data-testid="alerts-panel">
        <SectionLabel>Compliance watch</SectionLabel>
        <h2 className="mt-2 text-lg font-semibold">Deadlines and regulatory signals</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Pulled from the same compliance feed as the inbox notifications surface.
        </p>
        <div className="mt-4 space-y-3">
          {data.alerts.map((alert) => (
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
    </div>
  );
}
