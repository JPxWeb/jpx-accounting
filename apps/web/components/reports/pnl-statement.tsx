"use client";

import type { ProfitLossStatement } from "@jpx-accounting/contracts";
import { useTranslations } from "next-intl";

import { Money } from "../ui/money";

/**
 * Resultatrapport rendered straight from the pack's `profitLoss`. Group keys
 * arrive from the server; labels are i18n (Rörelsens intäkter etc. in sv).
 * Line rows are buttons — the account drill drawer wires `onSelectAccount`
 * in Task 4.8; until then they are inert.
 */
export function PnlStatement({
  statement,
  onSelectAccount,
}: {
  statement: ProfitLossStatement;
  onSelectAccount?: (accountNumber: string) => void;
}) {
  const t = useTranslations("reports.pnl");

  return (
    <section id="pnl-statement" data-testid="pnl-statement" className="glass-panel rounded-xl p-5">
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      <div className="mt-4 space-y-5">
        {statement.groups.map((group) => (
          <div key={group.key}>
            <h3 className="text-eyebrow">{t(`groups.${group.key}`)}</h3>
            {group.lines.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {group.lines.map((line) => (
                  <li key={line.accountNumber}>
                    <button
                      type="button"
                      data-testid="pnl-line"
                      data-account={line.accountNumber}
                      className="flex w-full items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      onClick={onSelectAccount ? () => onSelectAccount(line.accountNumber) : undefined}
                    >
                      <span>
                        <span className="text-mono text-xs text-muted-foreground">{line.accountNumber}</span>{" "}
                        {line.accountName}
                      </span>
                      <Money value={line.amount} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-border px-2 pt-2 text-sm font-medium">
              <span>{t("subtotal")}</span>
              <Money value={group.total} />
            </div>
          </div>
        ))}
      </div>
      <dl className="mt-5 space-y-2 border-t border-border pt-4 text-sm">
        <div className="flex items-baseline justify-between gap-3 px-2">
          <dt className="font-medium">{t("operatingResult")}</dt>
          <dd className="font-semibold" data-testid="pnl-operating-result">
            <Money value={statement.operatingResult} />
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 px-2">
          <dt>{t("financialNet")}</dt>
          <dd>
            <Money value={statement.financialNet} />
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 px-2 text-base">
          <dt className="font-semibold">{t("periodResult")}</dt>
          <dd className="font-semibold" data-testid="pnl-period-result">
            <Money value={statement.periodResult} />
          </dd>
        </div>
      </dl>
    </section>
  );
}
