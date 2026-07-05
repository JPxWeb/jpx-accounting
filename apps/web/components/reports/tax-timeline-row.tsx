"use client";

import { buildTaxTimeline, currentVatPeriodToken, TAX_DEADLINE_SOURCES } from "@jpx-accounting/domain";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { apiClient } from "../../lib/client";
import { useWorkspaceProfile } from "../providers/workspace-profile-provider";
import { Money } from "../ui/money";

const VISIBLE_DEADLINES = 5;

/** Local calendar day (`YYYY-MM-DD`) — never `toISOString().slice` (UTC bug). */
function localTodayIso(): string {
  const now = new Date();
  const pad2 = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/**
 * Statutory tax timeline on the Reports screen (Task 5.10): the next upcoming
 * deadlines from the domain tax calendar — calm, dated, and source-cited with
 * the verbatim Skatteverket/ÅRL statements the dates were encoded from. Only
 * VAT deadlines carry an amount (pack box 49, joined through the ONE
 * VAT-period `ReportPack` fetch shared with the dashboard — plan finding 15);
 * employer/F-skatt/annual-report render date-only, which is honest.
 *
 * `id="tax-timeline"` is the anchor the deadline-proximity observation links
 * to (`/reports#tax-timeline`).
 */
export function TaxTimelineRow() {
  const t = useTranslations("reports.taxTimeline");
  const profile = useWorkspaceProfile();
  const today = localTodayIso();
  const vatToken = currentVatPeriodToken(profile.vatPeriod, profile.fiscalYearStart, today);

  const deadlines = useMemo(
    () =>
      buildTaxTimeline({
        profile: { vatPeriod: profile.vatPeriod, fiscalYearStart: profile.fiscalYearStart },
        today,
        limit: VISIBLE_DEADLINES,
      }),
    [profile.vatPeriod, profile.fiscalYearStart, today],
  );

  // Same query key as the dashboard's VAT widgets — one cache entry per token.
  const vatPackQuery = useQuery({
    queryKey: ["reports", "pack", vatToken],
    queryFn: () => apiClient.getReportPack(vatToken),
  });
  const vatPack = vatPackQuery.data;
  const box49 = vatPack?.vatReturn.find((box) => box.box === "49");

  const dateFormatter = new Intl.DateTimeFormat(profile.locale, { dateStyle: "medium" });
  const sourceKeys = [...new Set(deadlines.map((deadline) => deadline.sourceKey))];

  return (
    <section id="tax-timeline" data-testid="tax-timeline" className="glass-panel rounded-xl p-5 break-inside-avoid">
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{t("description")}</p>

      {deadlines.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {deadlines.map((deadline) => {
            const amount =
              deadline.amountRef === "box49" && box49 && deadline.periodToken === vatPack?.period.token
                ? box49.amount
                : null;
            return (
              <li
                key={deadline.id}
                data-testid="tax-timeline-row"
                data-kind={deadline.kind}
                data-due={deadline.dueDate}
                className="glass-panel-soft flex items-center justify-between gap-3 rounded-lg px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{t(`kinds.${deadline.kind}`)}</p>
                  <p className="mt-0.5 text-caption text-muted-foreground">{deadline.periodLabel}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums">
                    {dateFormatter.format(new Date(deadline.dueDate))}
                  </p>
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
      )}

      {sourceKeys.length > 0 ? (
        <div className="mt-4 border-t border-border pt-3">
          <p className="text-eyebrow">{t("sourcesLabel")}</p>
          <ul className="mt-2 space-y-1">
            {sourceKeys.map((key) => (
              <li key={key} data-testid="tax-timeline-source" className="text-caption leading-5 text-muted-foreground">
                {TAX_DEADLINE_SOURCES[key]}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
