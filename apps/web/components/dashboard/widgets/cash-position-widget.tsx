"use client";

import { detectCashRunway } from "@jpx-accounting/reporting";
import { useTranslations } from "next-intl";

import { Money } from "../../ui/money";
import { MiniSparkline } from "../mini-sparkline";
import type { DashboardData } from "../use-dashboard-data";

/**
 * Cash position: current 19xx balance, a 12-month closing-balance sparkline,
 * and the deterministic runway phrase from the cash-runway detector (the SAME
 * detector the observations widget ranks — one truth, two surfaces).
 */
export function CashPositionWidget({ data }: { data: DashboardData }) {
  const t = useTranslations("dashboard.widgets.cash-position");
  const tDashboard = useTranslations("dashboard");
  const tObservations = useTranslations("observations");
  const pack = data.pack;

  if (!pack) {
    return <p className="text-sm text-muted-foreground">{tDashboard("loading")}</p>;
  }

  const active = pack.monthly.filter((point) => point.cashIn !== 0 || point.cashOut !== 0);
  if (active.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  }

  const closing = pack.monthly.at(-1)?.cashClosing ?? 0;
  const runway = detectCashRunway(pack)[0];

  return (
    <div className="space-y-3">
      <div>
        <p className="text-eyebrow">{t("cashLabel")}</p>
        <p className="mt-1 text-2xl font-semibold">
          <Money value={closing} />
        </p>
      </div>
      <MiniSparkline values={pack.monthly.map((point) => point.cashClosing)} />
      <p className="text-sm leading-6 text-muted-foreground">
        {runway ? tObservations(runway.titleKey, runway.params) : t("noHistory")}
      </p>
    </div>
  );
}
