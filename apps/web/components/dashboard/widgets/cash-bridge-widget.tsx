"use client";

import { useTranslations } from "next-intl";

import { Money } from "../../ui/money";
import { MiniBars } from "../mini-bars";
import type { DashboardData } from "../use-dashboard-data";

const VISIBLE_DRIVERS = 2;

/**
 * Compact cash bridge for the current month: opening balance → the top two
 * movement drivers (by attributed cash impact, from the pack builder) →
 * closing balance, with a mini-bar strip of the same figures. The invariant
 * `opening + Σ drivers + other = closing` is held by the pack builder — this
 * widget only renders it.
 */
export function CashBridgeWidget({ data }: { data: DashboardData }) {
  const t = useTranslations("dashboard.widgets.cash-bridge");
  const tDashboard = useTranslations("dashboard");
  const bridge = data.pack?.cashBridge;

  if (!bridge) {
    return <p className="text-sm text-muted-foreground">{tDashboard("loading")}</p>;
  }

  if (bridge.opening === 0 && bridge.closing === 0 && bridge.drivers.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  }

  const drivers = bridge.drivers.slice(0, VISIBLE_DRIVERS);

  return (
    <div className="space-y-3">
      <dl className="space-y-1.5 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">{t("opening")}</dt>
          <dd className="font-semibold">
            <Money value={bridge.opening} />
          </dd>
        </div>
        {drivers.map((driver) => (
          <div key={driver.accountNumber} className="flex items-center justify-between gap-3">
            <dt className="min-w-0 truncate text-muted-foreground">
              {driver.accountNumber} {driver.accountName}
            </dt>
            <dd className="shrink-0 font-semibold">
              <Money value={driver.amount} />
            </dd>
          </div>
        ))}
        {bridge.other.amount !== 0 ? (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">{t("other")}</dt>
            <dd className="font-semibold">
              <Money value={bridge.other.amount} />
            </dd>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-3 border-t border-border pt-1.5">
          <dt className="text-muted-foreground">{t("closing")}</dt>
          <dd className="font-semibold">
            <Money value={bridge.closing} />
          </dd>
        </div>
      </dl>
      <MiniBars values={[bridge.opening, ...drivers.map((driver) => driver.amount), bridge.closing]} />
    </div>
  );
}
