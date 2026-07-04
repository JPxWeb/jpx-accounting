"use client";

import { summarizeBalances } from "@jpx-accounting/reporting";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { parseAsString, parseAsStringEnum, useQueryState } from "nuqs";

import { usePeriodScope } from "../../hooks/use-period-scope";
import { apiClient } from "../../lib/client";
import { Money } from "../ui/money";

const views = ["journal", "general-ledger", "trial-balance", "suppliers", "close"] as const;
type View = (typeof views)[number];

export function TrialBalanceView() {
  const t = useTranslations("books.trialBalance");
  const { from, to } = usePeriodScope();
  const [, setView] = useQueryState("view", parseAsStringEnum<View>([...views]).withDefault("journal"));
  const [, setAccount] = useQueryState("account", parseAsString);

  // Server-filtered (Phase 4): with a range this is deliberately the PERIOD
  // MOVEMENT (only lines booked inside the window), not cumulative balances.
  const { data } = useQuery({
    queryKey: ["reports", "trial-balance", from, to],
    queryFn: () => apiClient.getTrialBalance({ from, to }),
  });

  const balanceSummary = summarizeBalances(data ?? []);

  async function handleRowClick(accountNumber: string) {
    await setAccount(accountNumber);
    await setView("general-ledger");
  }

  if (balanceSummary.length === 0) {
    return (
      <div className="glass-panel rounded-xl p-8 text-center" data-testid="trial-balance-view">
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-xl p-5" data-testid="trial-balance-view">
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      <div className="mt-4 space-y-3">
        {balanceSummary.map((balance) => (
          <button
            key={balance.accountNumber}
            type="button"
            data-testid="trial-balance-row"
            className="w-full text-left glass-panel-soft rounded-lg p-4 text-sm hover:ring-1 hover:ring-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all"
            onClick={() => handleRowClick(balance.accountNumber)}
            title={t("rowTitle", { account: balance.accountNumber })}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-medium text-foreground">{balance.accountName}</p>
                <p className="text-mono text-xs text-muted-foreground">{balance.accountNumber}</p>
              </div>
              <p className="text-sm font-semibold text-foreground">
                <Money value={balance.balance} />
              </p>
            </div>
            <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="glass-panel-inset rounded-lg px-3 py-3">
                <dt className="text-eyebrow">{t("debit")}</dt>
                <dd className="mt-2 font-semibold text-foreground">
                  <Money value={balance.debit} />
                </dd>
              </div>
              <div className="glass-panel-inset rounded-lg px-3 py-3">
                <dt className="text-eyebrow">{t("credit")}</dt>
                <dd className="mt-2 font-semibold text-foreground">
                  <Money value={balance.credit} />
                </dd>
              </div>
            </dl>
          </button>
        ))}
      </div>
    </div>
  );
}
