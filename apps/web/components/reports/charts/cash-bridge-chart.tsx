"use client";

import type { CashBridge } from "@jpx-accounting/contracts";
import { useTranslations } from "next-intl";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useWorkspaceProfile } from "../../providers/workspace-profile-provider";
import { Money } from "../../ui/money";
import { SectionLabel } from "../../ui/section-label";
import { TableCell, TableRow } from "../../ui/table";
import { ChartDataTable } from "../chart-data-table";
import { CHART_PLOT_HEIGHT, CHART_TICK, ChartTooltipFrame } from "./chart-kit";

/**
 * Cash-bridge waterfall (advisory-pivot Phase 4, Task 4.7): opening balance →
 * ≤4 driver deltas → other → closing balance, straight from
 * `pack.cashBridge` (≤7 bars by construction). Rendered as a stacked BarChart
 * with an invisible base segment and a visible delta segment — the standard
 * waterfall trick, which recharts' plain (`none`) stack offset supports even
 * when the running balance dips negative.
 *
 * Driver bars drill into the account drawer via `onDrill(accountNumber)`;
 * the `ChartDataTable` twin is fed the SAME rows array and carries
 * `cash-bridge-row-<accountNumber>` buttons as the keyboard drill path.
 */

type WaterfallRow = {
  key: string;
  kind: "edge" | "delta";
  accountNumber?: string;
  /** Full label for tooltip + table (edges localized, drivers `number name`). */
  label: string;
  /** Short axis label (edges localized, drivers the account number). */
  axisLabel: string;
  /** The value the bar MEANS: balance for edges, signed delta for drivers/other. */
  amount: number;
  /** Invisible stack segment: where the visible span starts. */
  base: number;
  /** Visible stack segment: |delta| (or |balance| for edges). */
  span: number;
};

export function buildWaterfallRows(
  bridge: CashBridge,
  labels: { opening: string; closing: string; other: string },
): WaterfallRow[] {
  const rows: WaterfallRow[] = [
    {
      key: "opening",
      kind: "edge",
      label: labels.opening,
      axisLabel: labels.opening,
      amount: bridge.opening,
      base: Math.min(0, bridge.opening),
      span: Math.abs(bridge.opening),
    },
  ];

  let running = bridge.opening;
  for (const driver of bridge.drivers) {
    const start = running;
    running += driver.amount;
    rows.push({
      key: `driver-${driver.accountNumber}`,
      kind: "delta",
      accountNumber: driver.accountNumber,
      label: `${driver.accountNumber} ${driver.accountName}`,
      axisLabel: driver.accountNumber,
      amount: driver.amount,
      base: Math.min(start, running),
      span: Math.abs(driver.amount),
    });
  }

  if (Math.abs(bridge.other.amount) > 0.005) {
    const start = running;
    running += bridge.other.amount;
    rows.push({
      key: "other",
      kind: "delta",
      label: labels.other,
      axisLabel: labels.other,
      amount: bridge.other.amount,
      base: Math.min(start, running),
      span: Math.abs(bridge.other.amount),
    });
  }

  rows.push({
    key: "closing",
    kind: "edge",
    label: labels.closing,
    axisLabel: labels.closing,
    amount: bridge.closing,
    base: Math.min(0, bridge.closing),
    span: Math.abs(bridge.closing),
  });

  return rows;
}

function rowFill(row: WaterfallRow): string {
  if (row.kind === "edge") return "var(--chart-3)";
  return row.amount >= 0 ? "var(--positive)" : "var(--negative)";
}

/** Tooltip shows the row's MEANING (signed delta / balance), not the stack segments. */
function BridgeTooltipContent({ active, payload }: { active?: boolean; payload?: { payload?: WaterfallRow }[] }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) {
    return null;
  }
  return (
    <ChartTooltipFrame>
      <p className="font-semibold text-foreground">{row.label}</p>
      <Money value={row.amount} />
    </ChartTooltipFrame>
  );
}

export function CashBridgeChart({
  bridge,
  onDrill,
}: {
  bridge: CashBridge;
  onDrill?: (accountNumber: string) => void;
}) {
  const t = useTranslations("reports.charts.cashBridge");
  const { locale } = useWorkspaceProfile();

  // ONE rows array: the chart and its data-table twin share the reference.
  const rows = buildWaterfallRows(bridge, {
    opening: t("opening"),
    closing: t("closing"),
    other: t("other"),
  });

  return (
    <section id="cash-bridge" data-testid="cash-bridge" className="glass-panel rounded-xl p-5 break-inside-avoid">
      <SectionLabel>{t("title")}</SectionLabel>
      <div className="mt-4 min-w-0 print:hidden" style={{ height: CHART_PLOT_HEIGHT }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            role="img"
            aria-label={t("aria")}
            accessibilityLayer
            margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
          >
            <XAxis dataKey="axisLabel" tickLine={false} axisLine={false} tick={CHART_TICK} interval={0} />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={CHART_TICK}
              width={56}
              tickFormatter={(value: number) => new Intl.NumberFormat(locale, { notation: "compact" }).format(value)}
            />
            <Tooltip
              isAnimationActive={false}
              cursor={{ fill: "var(--muted)", fillOpacity: 0.4 }}
              content={<BridgeTooltipContent />}
            />
            {/* Invisible base lifts each visible span to its running-balance start. */}
            <Bar dataKey="base" stackId="waterfall" fill="transparent" isAnimationActive={false} />
            <Bar
              dataKey="span"
              stackId="waterfall"
              isAnimationActive={false}
              maxBarSize={40}
              radius={[2, 2, 2, 2]}
              onClick={(entry: { payload?: WaterfallRow }) => {
                const accountNumber = entry.payload?.accountNumber;
                if (accountNumber && onDrill) onDrill(accountNumber);
              }}
            >
              {rows.map((row) => (
                <Cell key={row.key} fill={rowFill(row)} cursor={row.accountNumber && onDrill ? "pointer" : undefined} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartDataTable
        chartId="cash-bridge"
        headers={[
          { key: "step", label: t("headerStep") },
          { key: "amount", label: t("headerAmount"), align: "right" },
        ]}
        rows={rows}
        renderRow={(row) => (
          <TableRow key={row.key}>
            <TableCell>
              {row.accountNumber ? (
                <button
                  type="button"
                  data-testid={`cash-bridge-row-${row.accountNumber}`}
                  className="rounded-md text-left underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label={t("drillAria", { account: row.accountNumber })}
                  onClick={onDrill ? () => onDrill(row.accountNumber!) : undefined}
                >
                  {row.label}
                </button>
              ) : (
                row.label
              )}
            </TableCell>
            <TableCell className="text-right">
              <Money value={row.amount} />
            </TableCell>
          </TableRow>
        )}
      />
    </section>
  );
}
