"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { usePeriodScope } from "../../hooks/use-period-scope";
import { apiClient } from "../../lib/client";
import { formatMoney } from "../../lib/presentation";
import { SectionLabel } from "../ui/section-label";

export function GeneralLedgerView() {
  const { period } = usePeriodScope();
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

  return (
    <div className="space-y-3" data-testid="general-ledger-view">
      {grouped.map(([accountNumber, entries]) => {
        const debit = entries.reduce((sum, e) => sum + e.debit, 0);
        const credit = entries.reduce((sum, e) => sum + e.credit, 0);
        const accountName = entries[0]?.accountName ?? "";
        return (
          <details key={accountNumber} className="glass-panel rounded-lg p-4">
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
      })}
    </div>
  );
}
