"use client";

import { useTranslations } from "next-intl";
import { parseAsStringEnum, useQueryState } from "nuqs";
import { CloseView } from "../books/close-view";
import { GeneralLedgerView } from "../books/general-ledger-view";
import { JournalView } from "../books/journal-view";
import { SuppliersView } from "../books/suppliers-view";
import { TrialBalanceView } from "../books/trial-balance-view";
import { PeriodSelector } from "../period/period-selector";
import { useOnboarding } from "../onboarding/onboarding-context";
import { ScreenHeader } from "../ui/screen-header";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";

const views = ["journal", "general-ledger", "trial-balance", "suppliers", "close"] as const;
type View = (typeof views)[number];

export function BooksScreen() {
  const t = useTranslations("books");
  const tOnboarding = useTranslations("onboarding.replay");
  const { startTour } = useOnboarding();
  const [view, setView] = useQueryState("view", parseAsStringEnum<View>([...views]).withDefault("journal"));

  return (
    <div className="page-shell space-y-6">
      <ScreenHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        aside={
          <div className="flex flex-col items-end gap-3">
            <button
              type="button"
              data-testid="books-onboarding-help"
              onClick={() => startTour("books-period", { force: true })}
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground print:hidden"
            >
              {tOnboarding("booksHelp")}
            </button>
            <PeriodSelector />
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
      </section>
    </div>
  );
}
