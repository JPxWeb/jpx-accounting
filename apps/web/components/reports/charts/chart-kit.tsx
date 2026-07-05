"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Money } from "../../ui/money";
import { Skeleton } from "../../ui/skeleton";

/**
 * Shared chart primitives (advisory-pivot Phase 4, Task 4.7).
 *
 * DELIBERATELY recharts-free: the reports screen imports `ChartSkeleton`
 * statically as the `next/dynamic` loading state, so anything in this module
 * lands in the main reports chunk. Recharts itself lives only inside the
 * dynamically imported chart modules (`sparkline`, `monthly-bars-chart`,
 * `cash-bridge-chart`) — the bundle guard in the phase exit gate greps
 * `from "recharts"` under `components/reports/charts/` only.
 *
 * Colors are never Tailwind classes: charts pass `var(--chart-*)`,
 * `var(--positive)` and `var(--negative)` straight into SVG props so both
 * themes restyle them without touching the components.
 */

/** Fixed plot height (px) shared by the big charts and their skeletons — keeps CLS at zero while the chunk loads. */
export const CHART_PLOT_HEIGHT = 240;

/** Loading placeholder for `next/dynamic({ ssr: false, loading: ChartSkeleton })`. */
export function ChartSkeleton() {
  const t = useTranslations("reports.charts");
  return (
    <section className="glass-panel rounded-xl p-5" aria-busy="true">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-4 w-full" style={{ height: CHART_PLOT_HEIGHT }} />
      <p className="sr-only">{t("loading")}</p>
    </section>
  );
}

/**
 * Structural stand-ins for recharts' tooltip content props — typed locally so
 * this module never imports recharts (see module docstring).
 */
export type ChartTooltipEntry = {
  name?: string | number;
  value?: string | number | (string | number)[];
  color?: string;
};

export type ChartTooltipContentProps = {
  active?: boolean;
  label?: string | number;
  payload?: ChartTooltipEntry[];
  /** Optional label transform (e.g. `2026-03` → `mars 2026`). */
  formatLabel?: (label: string) => string;
};

/** Glass container every custom tooltip renders into (charts own their content). */
export function ChartTooltipFrame({ children }: { children: ReactNode }) {
  return <div className="glass-chrome rounded-lg px-3 py-2 text-xs">{children}</div>;
}

/**
 * Default tooltip content: label + one row per series with its swatch and a
 * `Money`-formatted value. Identity text wears text tokens; only the swatch
 * carries the series color.
 */
export function ChartTooltipContent({ active, label, payload, formatLabel }: ChartTooltipContentProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }
  const heading = label === undefined ? undefined : formatLabel ? formatLabel(String(label)) : String(label);
  return (
    <ChartTooltipFrame>
      {heading ? <p className="font-semibold text-foreground">{heading}</p> : null}
      <ul className="mt-1 space-y-0.5">
        {payload.map((entry, index) => (
          <li key={`${String(entry.name)}-${index}`} className="flex items-center gap-2">
            <span aria-hidden="true" className="size-2 rounded-[2px]" style={{ background: entry.color }} />
            <span className="text-muted-foreground">{entry.name}</span>
            <Money className="ml-auto pl-3" value={typeof entry.value === "number" ? entry.value : undefined} />
          </li>
        ))}
      </ul>
    </ChartTooltipFrame>
  );
}

/** `YYYY-MM` → short localized month label for axis ticks ("mar 26"). */
export function formatMonthTick(month: string, locale: string): string {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  return new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit" }).format(new Date(year, monthIndex, 1));
}

/** `YYYY-MM` → long localized month label for tooltips and table rows ("mars 2026"). */
export function formatMonthLabel(month: string, locale: string): string {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(new Date(year, monthIndex, 1));
}

/** Shared axis tick style — recessive, token-driven (SVG props, not classes). */
export const CHART_TICK = { fontSize: 11, fill: "var(--muted-foreground)" } as const;
