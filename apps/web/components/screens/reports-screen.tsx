"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";

import { summarizeBalances, summarizeJournal, summarizeVat } from "@jpx-accounting/reporting";
import { apiClient } from "../../lib/client";
import { ScreenHeader } from "../ui/screen-header";

export function ReportsScreen() {
  const { data } = useQuery({
    queryKey: ["workspace"],
    queryFn: () => apiClient.getSnapshot(),
  });

  const journalSummary = summarizeJournal(data?.reports.journal ?? []);
  const balanceSummary = summarizeBalances(data?.reports.balances ?? []);
  const vatSummary = summarizeVat(data?.reports.vat ?? []);

  return (
    <div className="page-shell space-y-6">
      <ScreenHeader
        eyebrow="Reports"
        title="Fast reporting with the ledger still in plain sight."
        description="Journal, balances, and VAT views all project from the same append-only event history, so the polished UI never drifts away from the audit spine."
        aside={
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Entries", value: `${journalSummary.count}` },
              { label: "Accounts", value: `${balanceSummary.length}` },
              { label: "VAT slices", value: `${vatSummary.length}` },
            ].map((item) => (
              <div key={item.label} className="glass-panel-soft rounded-[24px] p-4">
                <p className="text-[0.7rem] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">{item.label}</p>
                <p className="mt-3 text-2xl font-semibold">{item.value}</p>
              </div>
            ))}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          data-testid="journal-summary"
          className="glass-panel rounded-[28px] p-5"
        >
          <h2 className="text-lg font-semibold">Journal summary</h2>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {[
              { label: "Entries", value: journalSummary.count },
              { label: "Debit", value: `${journalSummary.totalDebit.toFixed(0)} SEK` },
              { label: "Credit", value: `${journalSummary.totalCredit.toFixed(0)} SEK` },
            ].map((item) => (
              <div key={item.label} className="glass-panel-soft rounded-[22px] p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-text-muted)]">{item.label}</p>
                <p className="mt-3 text-xl font-semibold">{item.value}</p>
              </div>
            ))}
          </div>
        </motion.section>

        <section className="glass-panel rounded-[28px] p-5" data-testid="trial-balance">
          <h2 className="text-lg font-semibold">Trial balance view</h2>
          <div className="mt-4 space-y-3">
            {balanceSummary.map((balance) => (
              <div key={balance.accountNumber} className="grid grid-cols-[1.2fr_0.8fr_0.8fr] gap-3 rounded-[20px] bg-white/60 px-4 py-3 text-sm">
                <div>
                  <p className="font-medium">{balance.accountName}</p>
                  <p className="text-mono text-xs text-[var(--color-text-muted)]">{balance.accountNumber}</p>
                </div>
                <div className="text-right">{balance.debit.toFixed(0)}</div>
                <div className="text-right font-semibold">{balance.balance.toFixed(0)}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="glass-panel rounded-[28px] p-5" data-testid="vat-preparation">
        <h2 className="text-lg font-semibold">VAT preparation</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {vatSummary.map((entry) => (
            <div key={entry.vatCode} className="glass-panel-soft rounded-[22px] p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-text-muted)]">{entry.label}</p>
              <p className="mt-3 text-2xl font-semibold">{entry.vatAmount.toFixed(0)} SEK</p>
              <p className="mt-2 text-sm text-[var(--color-text-muted)]">Base {entry.baseAmount.toFixed(0)} SEK</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
