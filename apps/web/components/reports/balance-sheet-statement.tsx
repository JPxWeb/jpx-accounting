"use client";

import type { BalanceSheetStatement as BalanceSheetStatementData, StatementGroup } from "@jpx-accounting/contracts";
import { useTranslations } from "next-intl";

import { Money } from "../ui/money";
import { StatusBadge } from "../ui/status-badge";

/**
 * Balansrapport as of the period's last day, straight from the pack's
 * `balanceSheet`. No closing entries exist yet, so the cumulative period
 * result is shown as its own `bs-computed-result` row on the equity side and
 * included in the equity/liabilities total — the `bs-balanced` chip styles the
 * integrity check.
 */
export function BalanceSheetStatement({
  statement,
  onSelectAccount,
}: {
  statement: BalanceSheetStatementData;
  onSelectAccount?: (accountNumber: string) => void;
}) {
  const t = useTranslations("reports.balanceSheet");

  function groupLines(group: StatementGroup) {
    return (
      <ul className="mt-2 space-y-1">
        {group.lines.map((line) => (
          <li key={line.accountNumber}>
            <button
              type="button"
              data-testid="bs-line"
              data-account={line.accountNumber}
              className="flex w-full items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              onClick={onSelectAccount ? () => onSelectAccount(line.accountNumber) : undefined}
            >
              <span>
                <span className="text-mono text-xs text-muted-foreground">{line.accountNumber}</span> {line.accountName}
              </span>
              <Money value={line.amount} />
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section id="balance-sheet" data-testid="balance-sheet" className="glass-panel rounded-xl p-5 break-inside-avoid">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("asOf", { date: statement.asOf })}</p>
        </div>
        <StatusBadge
          testId="bs-balanced"
          status={statement.balanced ? t("balanced") : t("notBalanced")}
          variant={statement.balanced ? "success" : "danger"}
        />
      </div>
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="text-eyebrow">{t("groups.assets")}</h3>
          {groupLines(statement.assets)}
          <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-border px-2 pt-2 text-sm font-semibold">
            <span>{t("totalAssets")}</span>
            <span data-testid="bs-total-assets">
              <Money value={statement.assets.total} />
            </span>
          </div>
        </div>
        <div>
          <h3 className="text-eyebrow">{t("groups.equityAndLiabilities")}</h3>
          {groupLines(statement.equityAndLiabilities)}
          <div className="mt-2 flex items-baseline justify-between gap-3 px-2 text-sm">
            <span className="text-muted-foreground">{t("computedResult")}</span>
            <span data-testid="bs-computed-result">
              <Money value={statement.computedResult} />
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-border px-2 pt-2 text-sm font-semibold">
            <span>{t("totalEquityAndLiabilities")}</span>
            <span data-testid="bs-total-equity-liabilities">
              <Money value={statement.equityAndLiabilities.total + statement.computedResult} />
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
