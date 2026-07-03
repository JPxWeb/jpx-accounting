"use client";

import type { EvidenceObject } from "@jpx-accounting/contracts";
import { useQuery } from "@tanstack/react-query";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { apiClient } from "../../lib/client";
import { Input } from "../ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

export function EvidenceArchiveTable() {
  const t = useTranslations("capture.archive");
  const [filter, setFilter] = useState("");
  const { data } = useQuery({ queryKey: ["workspace"], queryFn: () => apiClient.getSnapshot() });
  const evidence = data?.evidence ?? [];

  const columns = useMemo<ColumnDef<EvidenceObject>[]>(
    () => [
      { accessorKey: "title", header: t("headerTitle") },
      { accessorKey: "mimeType", header: t("headerType") },
      {
        id: "hash",
        header: t("headerHash"),
        accessorFn: (row) => row.hash,
        cell: ({ row }) => {
          const hash = row.original.hash;
          return (
            <button
              type="button"
              className="text-mono text-xs underline"
              onClick={() => {
                void navigator.clipboard.writeText(hash);
                toast.success(t("hashCopied"));
              }}
            >
              {hash.slice(0, 8)}…
            </button>
          );
        },
      },
      {
        accessorKey: "createdAt",
        header: t("headerUploaded"),
        cell: ({ row }) => row.original.createdAt.slice(0, 10),
      },
      {
        id: "open",
        header: "",
        cell: ({ row }) => (
          <Link href={`/capture/evidence/${row.original.id}`} data-testid="evidence-open" className="text-sm underline">
            {t("open")}
          </Link>
        ),
      },
    ],
    [t],
  );

  const table = useReactTable({
    data: evidence,
    columns,
    state: { globalFilter: filter },
    onGlobalFilterChange: setFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <section className="glass-panel rounded-xl p-5" data-testid="evidence-archive">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <Input
          data-testid="evidence-search"
          placeholder={t("searchPlaceholder")}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="max-w-xs"
        />
      </div>
      {evidence.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground" data-testid="evidence-empty">
          {t("empty")}
        </p>
      ) : (
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} data-testid="evidence-row">
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
