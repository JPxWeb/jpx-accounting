"use client";

import { summarizeVat } from "@jpx-accounting/reporting";
import { useQuery } from "@tanstack/react-query";
import { parseAsStringEnum, useQueryState } from "nuqs";
import { apiClient } from "../../lib/client";
import { formatMoney } from "../../lib/presentation";
import { getErrorMessage } from "../../lib/request-errors";
import { ScreenHeader } from "../ui/screen-header";
import { SectionLabel } from "../ui/section-label";
import { ScreenSkeleton } from "../ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { UnavailableState } from "../ui/unavailable-state";

const views = ["vat", "pl", "bs", "exports"] as const;
type View = (typeof views)[number];

export function ReportsScreen() {
  const [view, setView] = useQueryState("view", parseAsStringEnum<View>([...views]).withDefault("vat"));

  const workspaceQuery = useQuery({
    queryKey: ["workspace"],
    queryFn: () => apiClient.getSnapshot(),
  });
  const { data } = workspaceQuery;

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
        title="VAT, P&L, balance sheet — all projected from the event history."
        description="Reports derive from the same append-only ledger events as the journal. Numbers are always consistent with the audit trail."
      />

      <Tabs value={view} onValueChange={(v) => setView(v as View)}>
        <TabsList data-testid="reports-tabs">
          <TabsTrigger value="vat">VAT</TabsTrigger>
          <TabsTrigger value="pl">P&L</TabsTrigger>
          <TabsTrigger value="bs">Balance sheet</TabsTrigger>
          <TabsTrigger value="exports">Exports</TabsTrigger>
        </TabsList>
      </Tabs>

      <section className="mt-4">
        {view === "vat" ? (
          <section className="glass-panel rounded-xl p-5" data-testid="vat-preparation">
            <h2 className="text-lg font-semibold">VAT preparation</h2>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {vatSummary.map((entry) => (
                <div key={entry.vatCode} className="glass-panel-soft rounded-lg p-4">
                  <SectionLabel>{entry.label}</SectionLabel>
                  <p className="mt-3 text-2xl font-semibold tabular-nums">{formatMoney(entry.vatAmount)}</p>
                  <p className="mt-2 text-sm tabular-nums text-[var(--color-text-muted)]">
                    Base {formatMoney(entry.baseAmount)}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {view === "pl" ? (
          <div className="glass-panel rounded-xl p-8 text-center" data-testid="pl-placeholder">
            <p className="text-lg font-semibold text-[var(--color-text)]">Profit & Loss</p>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">Coming in Phase 7</p>
          </div>
        ) : null}

        {view === "bs" ? (
          <div className="glass-panel rounded-xl p-8 text-center" data-testid="bs-placeholder">
            <p className="text-lg font-semibold text-[var(--color-text)]">Balance Sheet</p>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">Coming in Phase 7</p>
          </div>
        ) : null}

        {view === "exports" ? (
          <div className="glass-panel rounded-xl p-5" data-testid="exports-view">
            <h2 className="text-lg font-semibold">Exports</h2>
            <div className="mt-4 space-y-3">
              <div className="glass-panel-soft rounded-lg px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-[var(--color-text)]">SIE 4 export</p>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      Swedish standard accounting file format
                    </p>
                  </div>
                  <a
                    href="/api-proxy/api/exports/sie"
                    download="ledger.sie"
                    className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white shadow-[var(--shadow-accent)]"
                  >
                    Download SIE 4
                  </a>
                </div>
              </div>
              <div className="glass-panel-soft rounded-lg px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-[var(--color-text)]">CSV export</p>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">Coming in Phase 7</p>
                  </div>
                </div>
              </div>
              <div className="glass-panel-soft rounded-lg px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-[var(--color-text)]">PDF report</p>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">Coming in Phase 7</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
