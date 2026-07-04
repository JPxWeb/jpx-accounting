"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { parseAsString, useQueryState } from "nuqs";
import { useMemo } from "react";
import { usePeriodScope } from "../../hooks/use-period-scope";
import { apiClient } from "../../lib/client";
import { Money } from "../ui/money";
import { SectionLabel } from "../ui/section-label";

export function GeneralLedgerView() {
  const t = useTranslations("books.generalLedger");
  const { from, to } = usePeriodScope();
  const [account, setAccount] = useQueryState("account", parseAsString);

  // Server-filtered (Phase 4): the period window is applied by the API; the
  // client only groups the returned lines by account.
  const journalQuery = useQuery({
    queryKey: ["reports", "journal", from, to],
    queryFn: () => apiClient.getJournal({ from, to }),
  });

  const grouped = useMemo(() => {
    const journal = journalQuery.data ?? [];
    const map = new Map<string, typeof journal>();
    for (const entry of journal) {
      const list = map.get(entry.accountNumber) ?? [];
      list.push(entry);
      map.set(entry.accountNumber, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [journalQuery.data]);

  const visible = account ? grouped.filter(([accountNumber]) => accountNumber === account) : grouped;

  return (
    <div className="space-y-3" data-testid="general-ledger-view">
      {account ? (
        <div className="flex items-center gap-2">
          <span
            data-testid="ledger-account-filter"
            className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary"
          >
            {t("accountChip", { account })}
            <button
              type="button"
              data-testid="ledger-account-filter-clear"
              aria-label={t("clearAccountAria")}
              className="rounded-full leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              onClick={() => void setAccount(null)}
            >
              ×
            </button>
          </span>
        </div>
      ) : null}
      {visible.length === 0 ? (
        <div className="glass-panel rounded-xl p-8 text-center">
          <p className="text-sm text-muted-foreground">{account ? t("emptyForAccount", { account }) : t("empty")}</p>
        </div>
      ) : (
        visible.map(([accountNumber, entries]) => {
          const debit = entries.reduce((sum, e) => sum + e.debit, 0);
          const credit = entries.reduce((sum, e) => sum + e.credit, 0);
          const accountName = entries[0]?.accountName ?? "";
          return (
            <details key={accountNumber} className="glass-panel rounded-xl p-4" open={accountNumber === account}>
              <summary className="flex cursor-pointer items-center justify-between gap-4">
                <span>
                  <SectionLabel>{accountNumber}</SectionLabel>
                  <p className="text-sm font-semibold">{accountName}</p>
                </span>
                <span className="text-sm">
                  {t("net")} <Money value={debit - credit} />
                </span>
              </summary>
              <ul className="mt-4 space-y-2 text-sm">
                {entries.map((entry) => (
                  <li key={`${entry.voucherId}-${entry.bookedAt}`} className="flex justify-between gap-3">
                    <span>
                      {entry.bookedAt.slice(0, 10)} · {entry.description}
                    </span>
                    <Money value={entry.debit - entry.credit} />
                  </li>
                ))}
              </ul>
            </details>
          );
        })
      )}
    </div>
  );
}
