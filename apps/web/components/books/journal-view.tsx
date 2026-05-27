"use client";

import { useQuery } from "@tanstack/react-query";
import { usePeriodScope } from "../../hooks/use-period-scope";
import { apiClient } from "../../lib/client";
import { formatMoney } from "../../lib/presentation";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

export function JournalView() {
  const { period } = usePeriodScope();
  const { data } = useQuery({
    queryKey: ["workspace"],
    queryFn: () => apiClient.getSnapshot(),
  });

  const entries = (data?.reports.journal ?? []).filter((entry) => {
    if (!period.start || !period.end) return true;
    const date = entry.bookedAt.slice(0, 10);
    return date >= period.start && date <= period.end;
  });

  return (
    <div className="glass-panel rounded-xl p-5" data-testid="journal-view">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Voucher</TableHead>
            <TableHead>Account</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Debit</TableHead>
            <TableHead className="text-right">Credit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={`${entry.voucherId}-${entry.accountNumber}`}>
              <TableCell>{entry.bookedAt.slice(0, 10)}</TableCell>
              <TableCell className="text-mono">{entry.voucherId}</TableCell>
              <TableCell>
                {entry.accountNumber} {entry.accountName}
              </TableCell>
              <TableCell>{entry.description}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(entry.debit)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(entry.credit)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
