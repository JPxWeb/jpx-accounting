"use client";

import { useQuery } from "@tanstack/react-query";
import { parseAsString, parseAsStringEnum, useQueryState } from "nuqs";
import { useMemo } from "react";

import { apiClient } from "../../lib/client";
import { Money } from "../ui/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

const views = ["journal", "general-ledger", "trial-balance", "suppliers", "close"] as const;
type View = (typeof views)[number];

export function SuppliersView() {
  const [, setView] = useQueryState("view", parseAsStringEnum<View>([...views]).withDefault("journal"));
  const [, setSupplier] = useQueryState("supplier", parseAsString);

  const { data } = useQuery({
    queryKey: ["workspace"],
    queryFn: () => apiClient.getSnapshot(),
  });

  const suppliers = useMemo(() => {
    const vouchers = data?.vouchers ?? [];
    const map = new Map<string, { count: number; totalGross: number }>();

    for (const voucher of vouchers) {
      const name = voucher.voucherFields.supplierName ?? "(Unknown supplier)";
      const existing = map.get(name) ?? { count: 0, totalGross: 0 };
      map.set(name, {
        count: existing.count + 1,
        totalGross: existing.totalGross + (voucher.voucherFields.grossAmount ?? 0),
      });
    }

    return Array.from(map.entries())
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  async function handleViewInJournal(supplierName: string) {
    await setSupplier(supplierName);
    await setView("journal");
  }

  if (suppliers.length === 0) {
    return (
      <div className="glass-panel rounded-xl p-8 text-center" data-testid="suppliers-view">
        <p className="text-sm text-muted-foreground">No suppliers yet. Vouchers with a supplier name appear here.</p>
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-xl p-5" data-testid="suppliers-view">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Supplier</TableHead>
            <TableHead className="text-right">Vouchers</TableHead>
            <TableHead className="text-right">Total spent</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {suppliers.map((supplier) => (
            <TableRow key={supplier.name}>
              <TableCell className="font-medium">{supplier.name}</TableCell>
              <TableCell className="text-right tabular-nums">{supplier.count}</TableCell>
              <TableCell className="text-right">
                <Money value={supplier.totalGross} />
              </TableCell>
              <TableCell>
                <button
                  type="button"
                  data-testid="supplier-open-journal"
                  className="text-xs text-primary hover:underline focus-visible:outline-none focus-visible:underline"
                  onClick={() => handleViewInJournal(supplier.name)}
                >
                  View in journal
                </button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
