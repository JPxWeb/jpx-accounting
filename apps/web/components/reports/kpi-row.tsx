"use client";

import type { ReportKpis } from "@jpx-accounting/reporting";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Money } from "../ui/money";
import { SectionLabel } from "../ui/section-label";

type KpiId = "result" | "cash" | "revenue" | "vat";

/**
 * The four headline KPIs, every value read off the same `ReportPack` the
 * statements render (via `buildKpis` — reconciled by construction). The
 * `sparklines` slots are wired by the chart kit in Task 4.7.
 */
export function KpiRow({ kpis, sparklines }: { kpis: ReportKpis; sparklines?: Partial<Record<KpiId, ReactNode>> }) {
  const t = useTranslations("reports.kpis");

  const tiles: { id: KpiId; value: number }[] = [
    { id: "result", value: kpis.result },
    { id: "cash", value: kpis.cash },
    { id: "revenue", value: kpis.revenue },
    { id: "vat", value: kpis.vat },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="kpi-row">
      {tiles.map((tile) => (
        <div key={tile.id} data-testid={`kpi-${tile.id}`} className="glass-panel rounded-xl p-4">
          <SectionLabel>{t(tile.id)}</SectionLabel>
          <p className="mt-3 text-xl font-semibold">
            <Money value={tile.value} />
          </p>
          {sparklines?.[tile.id] ?? null}
        </div>
      ))}
    </div>
  );
}
