"use client";

import { parseAsStringEnum, useQueryState } from "nuqs";
import { CloseView } from "../books/close-view";
import { GeneralLedgerView } from "../books/general-ledger-view";
import { JournalView } from "../books/journal-view";
import { PeriodSelector } from "../books/period-selector";
import { SuppliersView } from "../books/suppliers-view";
import { TrialBalanceView } from "../books/trial-balance-view";
import { ScreenHeader } from "../ui/screen-header";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";

const views = ["journal", "general-ledger", "trial-balance", "suppliers", "close"] as const;
type View = (typeof views)[number];

export function BooksScreen() {
  const [view, setView] = useQueryState("view", parseAsStringEnum<View>([...views]).withDefault("journal"));

  return (
    <div className="page-shell space-y-6">
      <ScreenHeader
        eyebrow="Books"
        title="The ledger, drillable."
        description="Journal, general ledger, trial balance, suppliers, and close — all scoped to a period."
        aside={<PeriodSelector />}
      />
      <Tabs value={view} onValueChange={(v) => setView(v as View)}>
        <TabsList data-testid="books-tabs">
          <TabsTrigger value="journal">Journal</TabsTrigger>
          <TabsTrigger value="general-ledger">General ledger</TabsTrigger>
          <TabsTrigger value="trial-balance">Trial balance</TabsTrigger>
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
          <TabsTrigger value="close">Close</TabsTrigger>
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
