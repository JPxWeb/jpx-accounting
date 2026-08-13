"use client";

import type { OpenInvoiceListRow } from "@jpx-accounting/contracts";
import { useTranslations } from "next-intl";

import { formatMoney } from "../../lib/presentation";
import { useWorkspaceProfile } from "../providers/workspace-profile-provider";

export function OpenInvoicesPanel({
  rows,
  loading = false,
  hasError = false,
}: {
  rows: OpenInvoiceListRow[];
  loading?: boolean;
  hasError?: boolean;
}) {
  const t = useTranslations("books.lists.openInvoices");
  const profile = useWorkspaceProfile();

  return (
    <section
      data-testid="open-invoices-panel"
      aria-labelledby="open-invoices-heading"
      className="glass-panel rounded-xl p-5"
    >
      <h2 id="open-invoices-heading" className="text-lg font-semibold text-foreground">
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
        <p data-testid="open-invoices-empty" className="mt-4 text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {rows.map((row) => (
            <li
              key={row.id}
              data-testid="open-invoice-row"
              className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
            >
              <span className="min-w-0">
                <span className="block font-medium text-foreground">{row.counterparty}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  <code>{row.id}</code> · {t(`direction.${row.direction}`)} · {t("dueDate", { date: row.dueDate })}
                </span>
              </span>
              <span className="text-sm text-foreground sm:text-right">
                <span className="block font-mono tabular-nums">
                  {formatMoney(row.openAmount, { locale: profile.locale, currency: row.currency })}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("originalAmount", {
                    amount: formatMoney(row.originalAmount, { locale: profile.locale, currency: row.currency }),
                  })}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
