"use client";

import { useTranslations } from "next-intl";

import { formatShortDate } from "../../../lib/presentation";
import { useWorkspaceProfile } from "../../providers/workspace-profile-provider";
import { Money } from "../../ui/money";
import type { DashboardData } from "../use-dashboard-data";

const VISIBLE_DEADLINES = 3;

/**
 * Next statutory deadlines from the domain tax calendar. Only VAT deadlines
 * carry an amount (pack box 49, and only when the deadline's period token
 * matches the fetched VAT-period pack) — employer/F-skatt/annual-report render
 * date-only, which is honest (plan finding 15).
 */
export function TaxTimelineWidget({ data }: { data: DashboardData }) {
  const t = useTranslations("dashboard.widgets.tax-timeline");
  const { locale } = useWorkspaceProfile();

  const deadlines = data.deadlines.slice(0, VISIBLE_DEADLINES);
  if (deadlines.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  }

  const box49 = data.vatPack?.vatReturn.find((box) => box.box === "49");

  return (
    <ul className="space-y-2">
      {deadlines.map((deadline) => {
        const amount =
          deadline.amountRef === "box49" && box49 && deadline.periodToken === data.vatPack?.period.token
            ? box49.amount
            : null;
        return (
          <li
            key={deadline.id}
            data-testid={`tax-deadline-${deadline.kind}`}
            className="glass-panel-soft flex items-center justify-between gap-3 rounded-lg px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{t(`kinds.${deadline.kind}`)}</p>
              <p className="mt-0.5 text-caption text-muted-foreground">{deadline.periodLabel}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-semibold tabular-nums">{formatShortDate(deadline.dueDate, locale)}</p>
              {amount !== null ? (
                <p className="mt-0.5 text-caption text-muted-foreground">
                  <Money value={amount} />
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
