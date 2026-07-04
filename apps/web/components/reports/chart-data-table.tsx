"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useState } from "react";

import { Table, TableBody, TableHead, TableHeader, TableRow } from "../ui/table";

/**
 * The accessibility twin of a chart (advisory-pivot Phase 4, Task 4.7): a
 * plain table fed the SAME array reference the chart renders, so the two can
 * never disagree. Collapsed by default behind a `chart-table-toggle-<chartId>`
 * button; the container is `hidden print:block` while collapsed, which makes
 * the table the print fallback for the (print-hidden) chart SVGs in Task 4.9.
 */
export function ChartDataTable<Row>({
  chartId,
  headers,
  rows,
  renderRow,
}: {
  chartId: string;
  headers: { key: string; label: string; align?: "right" }[];
  /** MUST be the same array reference the chart consumes (reconciled by construction). */
  rows: readonly Row[];
  renderRow: (row: Row, index: number) => ReactNode;
}) {
  const t = useTranslations("reports.charts");
  const [open, setOpen] = useState(false);
  const containerId = `chart-table-${chartId}`;

  return (
    <div className="mt-3">
      <button
        type="button"
        data-testid={`chart-table-toggle-${chartId}`}
        aria-expanded={open}
        aria-controls={containerId}
        onClick={() => setOpen((value) => !value)}
        className="rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary print:hidden"
      >
        {open ? t("hideTable") : t("showTable")}
      </button>
      <div id={containerId} data-testid={containerId} className={open ? "mt-3" : "mt-3 hidden print:block"}>
        <Table>
          <TableHeader>
            <TableRow>
              {headers.map((header) => (
                <TableHead key={header.key} className={header.align === "right" ? "text-right" : undefined}>
                  {header.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>{rows.map((row, index) => renderRow(row, index))}</TableBody>
        </Table>
      </div>
    </div>
  );
}
