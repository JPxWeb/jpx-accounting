"use client";

import { nowIso } from "@jpx-accounting/domain";
import { useTranslations } from "next-intl";
import { parseAsStringEnum, useQueryState } from "nuqs";
import { useState } from "react";
import { CloseView } from "../books/close-view";
import { GeneralLedgerView } from "../books/general-ledger-view";
import { JournalView } from "../books/journal-view";
import { ManualEntryView } from "../books/manual-entry-view";
import { SuppliersView } from "../books/suppliers-view";
import { TrialBalanceView } from "../books/trial-balance-view";
import { PeriodSelector } from "../period/period-selector";
import { useOnboarding } from "../onboarding/onboarding-context";
import { PrintHeader } from "../reports/print-header";
import { ScreenHeader } from "../ui/screen-header";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";

// "manual-entry" is a first-class `?view=` value (deep-linkable) but has no
// tab: it is an authoring surface reached from the "Ny verifikation" action,
// not one of the five read views the tab strip switches between.
const views = ["journal", "general-ledger", "trial-balance", "suppliers", "close", "manual-entry"] as const;
type View = (typeof views)[number];

export function BooksScreen() {
  const t = useTranslations("books");
  const tOnboarding = useTranslations("onboarding.replay");
  const { startTour } = useOnboarding();
  const [view, setView] = useQueryState("view", parseAsStringEnum<View>([...views]).withDefault("journal"));
  // Frozen at mount so a re-render can't restamp the printed "generated at".
  const [generatedAt] = useState(() => nowIso());

  return (
    <div className="page-shell space-y-6">
      <PrintHeader generatedAt={generatedAt} />
      <ScreenHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        aside={
          <div className="flex flex-col items-end gap-3">
            <div className="flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                data-testid="books-onboarding-help"
                onClick={() => startTour("books-period", { force: true })}
                className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground print:hidden"
              >
                {tOnboarding("booksHelp")}
              </button>
              {view === "journal" || view === "general-ledger" ? (
                <button
                  type="button"
                  data-testid="books-print"
                  onClick={() => window.print()}
                  className="rounded-lg bg-surface-muted px-4 py-2 text-sm font-semibold text-foreground shadow-sm print:hidden"
                >
                  {t("print.button")}
                </button>
              ) : null}
              {view !== "manual-entry" ? (
                <button
                  type="button"
                  data-testid="books-new-manual-entry"
                  onClick={() => void setView("manual-entry")}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm print:hidden"
                >
                  {t("newManualEntry")}
                </button>
              ) : null}
            </div>
            <div className="print:hidden">
              <PeriodSelector />
            </div>
          </div>
        }
      />
      <Tabs value={view} onValueChange={(v) => setView(v as View)}>
        <TabsList data-testid="books-tabs" data-tour="books-tabs">
          <TabsTrigger value="journal">{t("tabs.journal")}</TabsTrigger>
          <TabsTrigger value="general-ledger">{t("tabs.generalLedger")}</TabsTrigger>
          <TabsTrigger value="trial-balance">{t("tabs.trialBalance")}</TabsTrigger>
          <TabsTrigger value="suppliers">{t("tabs.suppliers")}</TabsTrigger>
          <TabsTrigger value="close" data-tour="books-close-tab">
            {t("tabs.close")}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <section className="mt-4">
        {view === "journal" ? <JournalView /> : null}
        {view === "general-ledger" ? <GeneralLedgerView /> : null}
        {view === "trial-balance" ? <TrialBalanceView /> : null}
        {view === "suppliers" ? <SuppliersView /> : null}
        {view === "close" ? <CloseView /> : null}
        {view === "manual-entry" ? <ManualEntryView /> : null}
      </section>
    </div>
  );
}
