"use client";

import type { ValuedMovementListRow } from "@jpx-accounting/contracts";
import { useTranslations } from "next-intl";

import { formatMoney } from "../../lib/presentation";
import { useWorkspaceProfile } from "../providers/workspace-profile-provider";

export function ValuedMovementsPanel({
  rows,
  loading = false,
  hasError = false,
}: {
  rows: ValuedMovementListRow[];
  loading?: boolean;
  hasError?: boolean;
}) {
  const t = useTranslations("books.lists.valuedMovements");
  const profile = useWorkspaceProfile();

  return (
    <section
      data-testid="valued-movements-panel"
      aria-labelledby="valued-movements-heading"
      className="glass-panel rounded-xl p-5"
    >
      <h2 id="valued-movements-heading" className="text-lg font-semibold text-foreground">
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
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="pb-2 font-medium">{t("sku")}</th>
                <th className="pb-2 font-medium">{t("directionLabel")}</th>
                <th className="pb-2 text-right font-medium">{t("quantity")}</th>
                <th data-testid="valued-unit-cost-column" className="pb-2 text-right font-medium">
                  {t("unitCost")}
                </th>
                <th data-testid="valued-extended-amount-column" className="pb-2 text-right font-medium">
                  {t("extendedAmount")}
                </th>
                <th className="pb-2 text-right font-medium">{t("bookedAt")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 ? (
                <tr>
                  <td data-testid="valued-movements-empty" colSpan={6} className="py-4 text-muted-foreground">
                    {t("empty")}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} data-testid="valued-movement-row">
                    <td className="py-3">
                      <code>{row.skuId}</code>
                      <span className="mt-1 block text-xs text-muted-foreground">{row.id}</span>
                    </td>
                    <td className="py-3">{t(`direction.${row.direction}`)}</td>
                    <td className="py-3 text-right font-mono tabular-nums">
                      {row.quantity} {row.uom}
                    </td>
                    <td className="py-3 text-right font-mono tabular-nums">
                      {formatMoney(row.unitCost, { locale: profile.locale, currency: row.currency })}
                    </td>
                    <td className="py-3 text-right font-mono tabular-nums">
                      {formatMoney(row.extendedAmount, { locale: profile.locale, currency: row.currency })}
                    </td>
                    <td className="py-3 text-right font-mono tabular-nums" data-visual-mask>
                      {row.bookedAt}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
