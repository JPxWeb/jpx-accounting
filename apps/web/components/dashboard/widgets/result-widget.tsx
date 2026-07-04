"use client";

import { useTranslations } from "next-intl";

import { Money } from "../../ui/money";
import { MiniBars } from "../mini-bars";
import type { DashboardData } from "../use-dashboard-data";

const RESULT_BAR_MONTHS = 6;

/**
 * Period result straight from the month pack's income statement, the delta
 * against the equal-kind previous period when the pack carries one, and a
 * 6-month result mini-bar series — the same numbers the reports screen prints.
 */
export function ResultWidget({ data }: { data: DashboardData }) {
  const t = useTranslations("dashboard.widgets.result");
  const tDashboard = useTranslations("dashboard");
  const pack = data.pack;

  if (!pack) {
    return <p className="text-sm text-muted-foreground">{tDashboard("loading")}</p>;
  }

  const periodResult = pack.profitLoss.periodResult;
  const previousResult = pack.previousProfitLoss?.periodResult;
  const delta = previousResult === undefined ? null : periodResult - previousResult;
  const series = pack.monthly.slice(-RESULT_BAR_MONTHS).map((point) => point.result);
  const hasActivity = pack.monthly.some((point) => point.result !== 0) || periodResult !== 0;

  if (!hasActivity) {
    return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-eyebrow">{t("periodResult")}</p>
        <p className="mt-1 text-2xl font-semibold">
          <Money value={periodResult} />
        </p>
        {delta !== null ? (
          <p className="mt-1 text-sm text-muted-foreground">
            <Money value={delta} className={delta >= 0 ? "text-success" : "text-danger"} /> {t("delta")}
          </p>
        ) : null}
      </div>
      <MiniBars values={series} />
    </div>
  );
}
