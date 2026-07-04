import type { AccountBalanceProjection, JournalEntryProjection, VatProjection } from "@jpx-accounting/contracts";

export * from "./kpis";
export * from "./narrative";

// summarizeJournal/summarizeVat below are slated for deletion in Phase 4
// Task 4.6, once the reports-screen rewrite removes their last consumer.
export function summarizeJournal(journal: JournalEntryProjection[]) {
  return {
    count: journal.length,
    totalDebit: journal.reduce((sum, entry) => sum + entry.debit, 0),
    totalCredit: journal.reduce((sum, entry) => sum + entry.credit, 0),
  };
}

export function summarizeBalances(balances: AccountBalanceProjection[]) {
  return balances.filter((balance) => Math.abs(balance.balance) > 0).slice(0, 6);
}

export function summarizeVat(vat: VatProjection[]) {
  return vat.map((entry) => ({
    ...entry,
    label: `${entry.vatCode} - ${entry.deductible ? "deductible" : "review"}`,
  }));
}
