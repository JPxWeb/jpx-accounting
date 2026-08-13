"use client";

import type { TripsListRow } from "@jpx-accounting/contracts";
import { useTranslations } from "next-intl";

import { formatMoney } from "../../lib/presentation";
import { useWorkspaceProfile } from "../providers/workspace-profile-provider";

export function TripsListPanel({
  rows,
  loading = false,
  hasError = false,
}: {
  rows: TripsListRow[];
  loading?: boolean;
  hasError?: boolean;
}) {
  const t = useTranslations("books.lists.trips");
  const profile = useWorkspaceProfile();

  return (
    <section data-testid="trips-list-panel" aria-labelledby="trips-heading" className="glass-panel rounded-xl p-5">
      <h2 id="trips-heading" className="text-lg font-semibold text-foreground">
        {t("title")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      {loading ? (
        <p className="mt-4 text-sm text-muted-foreground" role="status">
          {t("loading")}
        </p>
      ) : hasError ? (
        <p className="mt-4 text-sm text-danger" role="alert">
          {t("error")}
        </p>
      ) : rows.length === 0 ? (
        <p data-testid="trips-list-empty" className="mt-4 text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {rows.map((row) => (
            <li
              key={row.id}
              data-testid="trips-list-row"
              className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
            >
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{row.purpose}</span>
                  <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">
                    {t(`status.${row.status}`)}
                  </span>
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  <code>{row.id}</code> · {t("traveler", { traveler: row.traveler })} ·{" "}
                  {t("dates", { startDate: row.startDate, endDate: row.endDate })}
                </span>
              </span>
              <span className="font-mono text-sm tabular-nums text-foreground sm:text-right">
                {formatMoney(row.expenseTotal, {
                  locale: profile.locale,
                  currency: profile.currency,
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
