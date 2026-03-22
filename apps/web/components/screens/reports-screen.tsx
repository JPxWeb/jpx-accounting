"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";

import { getErrorMessage } from "../../lib/request-errors";
import { formatMoney } from "../../lib/presentation";
import { summarizeBalances, summarizeJournal, summarizeVat } from "@jpx-accounting/reporting";
import { apiClient } from "../../lib/client";
import { ScreenHeader } from "../ui/screen-header";
import { UnavailableState } from "../ui/unavailable-state";
import { MetricCard } from "../ui/metric-card";
import { SectionLabel } from "../ui/section-label";
import { ScreenSkeleton } from "../ui/skeleton";

export function ReportsScreen() {
  const workspaceQuery = useQuery({
    queryKey: ["workspace"],
    queryFn: () => apiClient.getSnapshot(),
  });
  const { data } = workspaceQuery;

  const journalSummary = summarizeJournal(data?.reports.journal ?? []);
  const balanceSummary = summarizeBalances(data?.reports.balances ?? []);
  const vatSummary = summarizeVat(data?.reports.vat ?? []);

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
        title="Fast reporting with the ledger still in plain sight."
        description="Journal, balances, and VAT views all project from the same append-only event history, so the polished UI never drifts away from the audit spine."
        aside={
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard label="Entries" value={journalSummary.count} />
            <MetricCard label="Accounts" value={balanceSummary.length} />
            <MetricCard label="VAT slices" value={vatSummary.length} />
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          data-testid="journal-summary"
          className="glass-panel rounded-3xl p-5"
        >
          <h2 className="text-lg font-semibold">Journal summary</h2>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[
              { label: "Entries", value: journalSummary.count },
              { label: "Debit", value: formatMoney(journalSummary.totalDebit) },
              { label: "Credit", value: formatMoney(journalSummary.totalCredit) },
            ].map((item) => (
              <div key={item.label} className="glass-panel-soft rounded-2xl p-4">
                <SectionLabel>{item.label}</SectionLabel>
                <p className="mt-3 text-xl font-semibold tabular-nums">{item.value}</p>
              </div>
            ))}
          </div>
        </motion.section>

        <section className="glass-panel rounded-3xl p-5" data-testid="trial-balance">
          <h2 className="text-lg font-semibold">Trial balance view</h2>
          <div className="mt-4 space-y-3">
            {balanceSummary.map((balance) => (
              <article key={balance.accountNumber} className="glass-panel-soft rounded-2xl p-4 text-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-medium text-[var(--color-text)]">{balance.accountName}</p>
                    <p className="text-mono text-xs text-[var(--color-text-muted)]">{balance.accountNumber}</p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums text-[var(--color-text)]">{formatMoney(balance.balance)}</p>
                </div>
                <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="glass-panel-inset rounded-xl px-3 py-3">
                    <dt className="text-eyebrow">Debit</dt>
                    <dd className="mt-2 font-semibold tabular-nums text-[var(--color-text)]">{formatMoney(balance.debit)}</dd>
                  </div>
                  <div className="glass-panel-inset rounded-xl px-3 py-3">
                    <dt className="text-eyebrow">Credit</dt>
                    <dd className="mt-2 font-semibold tabular-nums text-[var(--color-text)]">{formatMoney(balance.credit)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </section>
      </div>

      <section className="glass-panel rounded-3xl p-5" data-testid="vat-preparation">
        <h2 className="text-lg font-semibold">VAT preparation</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {vatSummary.map((entry) => (
            <div key={entry.vatCode} className="glass-panel-soft rounded-2xl p-4">
              <SectionLabel>{entry.label}</SectionLabel>
              <p className="mt-3 text-2xl font-semibold tabular-nums">{formatMoney(entry.vatAmount)}</p>
              <p className="mt-2 text-sm tabular-nums text-[var(--color-text-muted)]">Base {formatMoney(entry.baseAmount)}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
