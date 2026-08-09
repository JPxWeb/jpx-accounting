"use client";

import type { SkuMovementListRow } from "@jpx-accounting/contracts";
import { useTranslations } from "next-intl";

export function SkuMovementsPanel({
  rows,
  loading = false,
  hasError = false,
}: {
  rows: SkuMovementListRow[];
  loading?: boolean;
  hasError?: boolean;
}) {
  const t = useTranslations("books.lists.skuMovements");

  return (
    <section
      data-testid="sku-movements-panel"
      aria-labelledby="sku-movements-heading"
      className="glass-panel rounded-xl p-5"
    >
      <h2 id="sku-movements-heading" className="text-lg font-semibold text-foreground">
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
        <p data-testid="sku-movements-empty" className="mt-4 text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="pb-2 font-medium">{t("sku")}</th>
                <th className="pb-2 font-medium">{t("directionLabel")}</th>
                <th className="pb-2 text-right font-medium">{t("quantity")}</th>
                <th className="pb-2 text-right font-medium">{t("runningQuantity")}</th>
                <th className="pb-2 text-right font-medium">{t("bookedAt")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.id} data-testid="sku-movement-row">
                  <td className="py-3">
                    <code>{row.skuId}</code>
                    <span className="mt-1 block text-xs text-muted-foreground">{row.id}</span>
                  </td>
                  <td className="py-3">{t(`direction.${row.direction}`)}</td>
                  <td className="py-3 text-right font-mono tabular-nums">
                    {row.quantity} {row.uom}
                  </td>
                  <td className="py-3 text-right font-mono tabular-nums">
                    {row.runningQuantity} {row.uom}
                  </td>
                  <td className="py-3 text-right font-mono tabular-nums" data-visual-mask>
                    {row.bookedAt}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
