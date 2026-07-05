"use client";

import { useTranslations } from "next-intl";

import { Money } from "../../ui/money";
import type { DashboardData } from "../use-dashboard-data";

/**
 * VAT status over the workspace's CURRENT VAT PERIOD (not the calendar month
 * unless they coincide): box 49 as att betala / att få tillbaka, plus the
 * set-aside nudge when there is money to reserve. Same sign convention as the
 * reports VAT table: positive box 49 = to pay.
 */
export function VatStatusWidget({ data }: { data: DashboardData }) {
  const t = useTranslations("dashboard.widgets.vat-status");
  const tDashboard = useTranslations("dashboard");
  const vatPack = data.vatPack;

  if (!vatPack) {
    return <p className="text-sm text-muted-foreground">{tDashboard("loading")}</p>;
  }

  const box49 = vatPack.vatReturn.find((box) => box.box === "49");
  if (!box49 || (box49.amount === 0 && vatPack.vatReturn.every((box) => box.amount === 0))) {
    return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  }

  const toPay = box49.amount >= 0;

  return (
    <div className="space-y-2">
      <p className="text-eyebrow">{toPay ? t("toPay") : t("toRefund")}</p>
      <p className="text-2xl font-semibold">
        <Money value={Math.abs(box49.amount)} />
      </p>
      <p className="text-sm text-muted-foreground">{t("period", { token: vatPack.period.token })}</p>
      {box49.amount > 0 ? <p className="text-sm leading-6 text-muted-foreground">{t("setAside")}</p> : null}
    </div>
  );
}
