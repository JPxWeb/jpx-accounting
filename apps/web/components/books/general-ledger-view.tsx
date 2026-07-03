"use client";

import { useQuery } from "@tanstack/react-query";
import { parseAsString, useQueryState } from "nuqs";
import { useMemo } from "react";
import { usePeriodScope } from "../../hooks/use-period-scope";
import { apiClient } from "../../lib/client";
import { formatMoney } from "../../lib/presentation";
import { SectionLabel } from "../ui/section-label";

export function GeneralLedgerView() {
  const { period } = usePeriodScope();
  const [account, setAccount] = useQueryState("account", parseAsString);
  const { data } = useQuery({ queryKey: ["workspace"], queryFn: () => apiClient.getSnapshot() });

  const grouped = useMemo(() => {
    const journal = (data?.reports.journal ?? []).filter((entry) => {
      if (!period.start || !period.end) return true;
      const date = entry.bookedAt.slice(0, 10);
      return date >= period.start && date <= period.end;
    });
    const map = new Map<string, typeof journal>();
    for (const entry of journal) {
      const list = map.get(entry.accountNumber) ?? [];
      list.push(entry);
      map.set(entry.accountNumber, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [data, period]);

  const visible = account ? grouped.filter(([accountNumber]) => accountNumber === account) : grouped;

  return (
    <div className="space-y-3" data-testid="general-ledger-view">
      {account ? (
        <div className="flex items-center gap-2">
          <span
            data-testid="ledger-account-filter"
            className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary"
          >
            Account {account}
            <button
              type="button"
              data-testid="ledger-account-filter-clear"
              aria-label="Clear account filter"
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
          <p className="text-sm text-muted-foreground">
            {account ? `No ledger entries for account ${account} in this period.` : "No ledger entries in this period."}
          </p>
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
                <span className="text-sm tabular-nums">Net {formatMoney(debit - credit)}</span>
              </summary>
              <ul className="mt-4 space-y-2 text-sm">
                {entries.map((entry) => (
                  <li key={`${entry.voucherId}-${entry.bookedAt}`} className="flex justify-between gap-3">
                    <span>
                      {entry.bookedAt.slice(0, 10)} · {entry.description}
                    </span>
                    <span className="tabular-nums">{formatMoney(entry.debit - entry.credit)}</span>
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
