"use client";

import { useQuery } from "@tanstack/react-query";
import { parseAsString, useQueryState } from "nuqs";
import { usePeriodScope } from "../../hooks/use-period-scope";
import { apiClient } from "../../lib/client";
import { Money } from "../ui/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

export function JournalView() {
  const { period } = usePeriodScope();
  const [supplier, setSupplier] = useQueryState("supplier", parseAsString);
  const { data } = useQuery({
    queryKey: ["workspace"],
    queryFn: () => apiClient.getSnapshot(),
  });

  const vouchersById = new Map((data?.vouchers ?? []).map((voucher) => [voucher.id, voucher]));

  const entries = (data?.reports.journal ?? []).filter((entry) => {
    if (period.start && period.end) {
      const date = entry.bookedAt.slice(0, 10);
      if (date < period.start || date > period.end) return false;
    }
    if (supplier) {
      const voucher = vouchersById.get(entry.voucherId);
      const supplierName = voucher ? (voucher.voucherFields.supplierName ?? "(Unknown supplier)") : "";
      if (supplierName.toLowerCase() !== supplier.toLowerCase()) return false;
    }
    return true;
  });

  return (
    <div className="space-y-3" data-testid="journal-view">
      {supplier ? (
        <div className="flex items-center gap-2">
          <span
            data-testid="journal-supplier-filter"
            className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary"
          >
            Supplier {supplier}
            <button
              type="button"
              data-testid="journal-supplier-filter-clear"
              aria-label="Clear supplier filter"
              className="rounded-full leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              onClick={() => void setSupplier(null)}
            >
              ×
            </button>
          </span>
        </div>
      ) : null}
      {entries.length === 0 ? (
        <div className="glass-panel rounded-xl p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {supplier ? `No journal entries for ${supplier} in this period.` : "No journal entries in this period."}
          </p>
        </div>
      ) : (
        <div className="glass-panel rounded-xl p-5">
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
                  <TableCell className="text-mono">
                    {vouchersById.get(entry.voucherId)?.voucherNumber ?? entry.voucherId}
                  </TableCell>
                  <TableCell>
                    {entry.accountNumber} {entry.accountName}
                  </TableCell>
                  <TableCell>{entry.description}</TableCell>
                  <TableCell className="text-right">
                    <Money value={entry.debit} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={entry.credit} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
