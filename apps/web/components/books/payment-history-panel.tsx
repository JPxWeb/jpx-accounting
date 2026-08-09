"use client";

import type { PaymentHistoryListRow } from "@jpx-accounting/contracts";
import { useTranslations } from "next-intl";

import { formatMoney } from "../../lib/presentation";
import { useWorkspaceProfile } from "../providers/workspace-profile-provider";

export function PaymentHistoryPanel({
  rows,
  loading = false,
  hasError = false,
}: {
  rows: PaymentHistoryListRow[];
  loading?: boolean;
  hasError?: boolean;
}) {
  const t = useTranslations("books.lists.paymentHistory");
  const profile = useWorkspaceProfile();

  return (
    <section
      data-testid="payment-history-panel"
      aria-labelledby="payment-history-heading"
      className="glass-panel rounded-xl p-5"
    >
      <h2 id="payment-history-heading" className="text-lg font-semibold text-foreground">
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
        <p data-testid="payment-history-empty" className="mt-4 text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {rows.map((row) => (
            <li
              key={row.id}
              data-testid="payment-history-row"
              className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
            >
              <span className="min-w-0">
                <code className="block text-sm font-medium text-foreground">{row.id}</code>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {t("invoice", { invoiceId: row.invoiceId })} ·{" "}
                  {t("allocatedAt", { date: row.allocatedAt.slice(0, 10) })}
                </span>
              </span>
              <span className="font-mono text-sm tabular-nums text-foreground">
                {formatMoney(row.amount, { locale: profile.locale, currency: row.currency })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
