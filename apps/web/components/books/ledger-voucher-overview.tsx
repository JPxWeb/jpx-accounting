"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";

import type { LedgerMode } from "../../lib/ledger/ledger-mode-storage";
import type { LedgerVoucherViewModel } from "../../lib/ledger/ledger-voucher-view-model";
import { Money } from "../ui/money";
import { LedgerVoucherDetail } from "./ledger-voucher-detail";

type LedgerVoucherOverviewProps = {
  mode: LedgerMode;
  vouchers: LedgerVoucherViewModel[];
  expandedVoucherId: string | null;
  onToggle: (voucherId: string) => void;
};

export function LedgerVoucherOverview({ mode, vouchers, expandedVoucherId, onToggle }: LedgerVoucherOverviewProps) {
  const t = useTranslations("books.journal");
  const listId = useId();

  return (
    <div className="glass-panel rounded-xl p-5" data-testid="ledger-voucher-overview">
      <div
        className="mb-2 hidden grid-cols-[minmax(0,5.5rem)_minmax(0,4.5rem)_minmax(0,1fr)_minmax(0,5rem)_minmax(0,5rem)] gap-3 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:grid"
        aria-hidden="true"
      >
        <span>{t("headerDate")}</span>
        <span>{t("headerVoucher")}</span>
        <span>{t("headerDescription")}</span>
        <span className="text-right">{t("headerDebit")}</span>
        <span className="text-right">{t("headerCredit")}</span>
      </div>
      <ul className="divide-y divide-border">
        {vouchers.map((vm) => {
          const expanded = mode === "inline" && expandedVoucherId === vm.voucherId;
          const panelId = `${listId}-${vm.voucherId}-panel`;
          const description = vm.lines[0]?.description ?? vm.supplierName;

          return (
            <li key={vm.voucherId}>
              <button
                type="button"
                data-testid="ledger-voucher-toggle"
                aria-expanded={mode === "inline" ? expanded : expandedVoucherId === vm.voucherId}
                aria-controls={mode === "inline" ? panelId : undefined}
                onClick={() => onToggle(vm.voucherId)}
                className="flex w-full flex-col gap-1 rounded-lg px-3 py-3 text-left transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:grid sm:grid-cols-[minmax(0,5.5rem)_minmax(0,4.5rem)_minmax(0,1fr)_minmax(0,5rem)_minmax(0,5rem)] sm:items-center sm:gap-3"
              >
                <span className="text-xs text-muted-foreground sm:contents">
                  <span data-visual-mask>{vm.bookedAt.slice(0, 10)}</span>
                  <span className="text-mono text-sm text-primary">{vm.voucherNumber}</span>
                  <span className="font-medium text-foreground">{description}</span>
                  <span className="text-right sm:text-right">
                    <Money value={vm.lines.reduce((sum, line) => sum + line.debit, 0)} />
                  </span>
                  <span className="text-right sm:text-right">
                    <Money value={vm.lines.reduce((sum, line) => sum + line.credit, 0)} />
                  </span>
                </span>
              </button>
              {expanded ? (
                <div id={panelId} role="region" className="border-t border-border px-3 pb-4 pt-3">
                  <LedgerVoucherDetail vm={vm} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
