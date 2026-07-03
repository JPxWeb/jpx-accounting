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
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { apiClient } from "../../lib/client";
import { Input } from "../ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

const columns: ColumnDef<EvidenceObject>[] = [
  { accessorKey: "title", header: "Title" },
  { accessorKey: "mimeType", header: "Type" },
  {
    id: "hash",
    header: "Hash",
    accessorFn: (row) => row.hash,
    cell: ({ row }) => {
      const hash = row.original.hash;
      return (
        <button
          type="button"
          className="text-mono text-xs underline"
          onClick={() => {
            void navigator.clipboard.writeText(hash);
            toast.success("Hash copied.");
          }}
        >
          {hash.slice(0, 8)}…
        </button>
      );
    },
  },
  {
    accessorKey: "createdAt",
    header: "Uploaded",
    cell: ({ row }) => row.original.createdAt.slice(0, 10),
  },
  {
    id: "open",
    header: "",
    cell: ({ row }) => (
      <Link href={`/capture/evidence/${row.original.id}`} data-testid="evidence-open" className="text-sm underline">
        Open
      </Link>
    ),
  },
];

export function EvidenceArchiveTable() {
  const [filter, setFilter] = useState("");
  const { data } = useQuery({ queryKey: ["workspace"], queryFn: () => apiClient.getSnapshot() });
  const evidence = data?.evidence ?? [];

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
        <h2 className="text-lg font-semibold">Evidence archive</h2>
        <Input
          data-testid="evidence-search"
          placeholder="Search evidence…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="max-w-xs"
        />
      </div>
      {evidence.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground" data-testid="evidence-empty">
          No archived evidence yet. Promote a draft above to populate the archive.
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
