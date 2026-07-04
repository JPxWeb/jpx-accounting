"use client";

import type { MonthlyPoint } from "@jpx-accounting/contracts";
import { useTranslations } from "next-intl";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useIsMobile } from "../../../hooks/use-mobile";
import { useWorkspaceProfile } from "../../providers/workspace-profile-provider";
import { Money } from "../../ui/money";
import { SectionLabel } from "../../ui/section-label";
import { TableCell, TableRow } from "../../ui/table";
import { ChartDataTable } from "../chart-data-table";
import { CHART_PLOT_HEIGHT, CHART_TICK, ChartTooltipContent, formatMonthLabel, formatMonthTick } from "./chart-kit";

/**
 * Cash in / cash out per calendar month (advisory-pivot Phase 4, Task 4.7):
 * grouped bars over `pack.monthly` — the trailing twelve months the KPI
 * sparklines also draw from, so every surface reads the same series. The
 * `ChartDataTable` twin is fed the SAME `monthly` array reference.
 *
 * Mobile has no hover, so the tooltip switches to click-trigger there
 * (recharts handles the touch events); keyboard users get the recharts
 * accessibility layer's arrow-key navigation either way.
 */
export function MonthlyBarsChart({ monthly }: { monthly: MonthlyPoint[] }) {
  const t = useTranslations("reports.charts.monthly");
  const { locale } = useWorkspaceProfile();
  const isMobile = useIsMobile();

  return (
    <section id="monthly-bars" data-testid="monthly-bars" className="glass-panel rounded-xl p-5 break-inside-avoid">
      <SectionLabel>{t("title")}</SectionLabel>
      <div className="mt-4 min-w-0 print:hidden" style={{ height: CHART_PLOT_HEIGHT }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={monthly}
            role="img"
            aria-label={t("aria")}
            accessibilityLayer
            margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
            barCategoryGap="24%"
            barGap={2}
          >
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
              tick={CHART_TICK}
              tickFormatter={(month: string) => formatMonthTick(month, locale)}
              interval="preserveStartEnd"
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={CHART_TICK}
              width={56}
              tickFormatter={(value: number) => new Intl.NumberFormat(locale, { notation: "compact" }).format(value)}
            />
            <Tooltip
              trigger={isMobile ? "click" : "hover"}
              isAnimationActive={false}
              cursor={{ fill: "var(--muted)", fillOpacity: 0.4 }}
              content={<ChartTooltipContent formatLabel={(month) => formatMonthLabel(month, locale)} />}
            />
            <Legend
              formatter={(value: string) => <span className="text-xs text-muted-foreground">{value}</span>}
              iconSize={8}
            />
            <Bar
              dataKey="cashIn"
              name={t("cashIn")}
              fill="var(--chart-1)"
              radius={[4, 4, 0, 0]}
              maxBarSize={18}
              isAnimationActive={false}
            />
            <Bar
              dataKey="cashOut"
              name={t("cashOut")}
              fill="var(--chart-3)"
              radius={[4, 4, 0, 0]}
              maxBarSize={18}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartDataTable
        chartId="monthly-bars"
        headers={[
          { key: "month", label: t("headerMonth") },
          { key: "cashIn", label: t("cashIn"), align: "right" },
          { key: "cashOut", label: t("cashOut"), align: "right" },
        ]}
        rows={monthly}
        renderRow={(point) => (
          <TableRow key={point.month}>
            <TableCell>{formatMonthLabel(point.month, locale)}</TableCell>
            <TableCell className="text-right">
              <Money value={point.cashIn} />
            </TableCell>
            <TableCell className="text-right">
              <Money value={point.cashOut} />
            </TableCell>
          </TableRow>
        )}
      />
    </section>
  );
}
