"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { parseAsString, parseAsStringEnum, useQueryState } from "nuqs";
import { useMemo } from "react";

import { usePeriodScope } from "../../hooks/use-period-scope";
import { apiClient } from "../../lib/client";
import { groupJournalByVoucher } from "../../lib/ledger/group-vouchers";
import { resolveLedgerMode, type LedgerMode } from "../../lib/ledger/ledger-mode-storage";
import { buildLedgerVoucherViewModel } from "../../lib/ledger/ledger-voucher-view-model";
import { buildVoucherLookup } from "../reports/voucher-link";
import { LedgerVoucherDrawer } from "./ledger-voucher-drawer";
import { LedgerVoucherOverview } from "./ledger-voucher-overview";

const ledgerModes = ["inline", "drawer"] as const;

export function JournalView() {
  const t = useTranslations("books.journal");
  const tBooks = useTranslations("books");
  const { from, to } = usePeriodScope();
  const [supplier, setSupplier] = useQueryState("supplier", parseAsString);
  const [ledgerModeParam] = useQueryState("ledgerMode", parseAsStringEnum([...ledgerModes]));
  const [voucher, setVoucher] = useQueryState("voucher", parseAsString);

  const ledgerMode: LedgerMode = resolveLedgerMode(ledgerModeParam);

  const journalQuery = useQuery({
    queryKey: ["reports", "journal", from, to],
    queryFn: () => apiClient.getJournal({ from, to }),
  });
  const { data: workspace } = useQuery({
    queryKey: ["workspace"],
    queryFn: () => apiClient.getSnapshot(),
  });

  const lookup = buildVoucherLookup(workspace);
  const vouchersById = lookup.vouchersById;

  const entries = (journalQuery.data ?? []).filter((entry) => {
    if (!supplier) return true;
    const voucherRecord = vouchersById.get(entry.voucherId);
    const supplierName = voucherRecord ? (voucherRecord.voucherFields.supplierName ?? tBooks("unknownSupplier")) : "";
    return supplierName.toLowerCase() === supplier.toLowerCase();
  });

  const voucherViewModels = useMemo(() => {
    return groupJournalByVoucher(entries).map((group) => buildLedgerVoucherViewModel(group, lookup));
  }, [entries, lookup]);

  function handleToggle(voucherId: string) {
    void setVoucher(voucher === voucherId ? null : voucherId);
  }

  function handleDrawerClose() {
    void setVoucher(null);
  }

  const selectedViewModel = voucherViewModels.find((vm) => vm.voucherId === voucher) ?? null;
  const drawerOpen = ledgerMode === "drawer" && selectedViewModel !== null;

  return (
    <div className="space-y-3" data-testid="journal-view" data-tour="books-journal">
      {supplier ? (
        <div className="flex items-center gap-2">
          <span
            data-testid="journal-supplier-filter"
            className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary"
          >
            {t("supplierChip", { supplier })}
            <button
              type="button"
              data-testid="journal-supplier-filter-clear"
              aria-label={t("clearSupplierAria")}
              className="rounded-full leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              onClick={() => void setSupplier(null)}
            >
              ×
            </button>
          </span>
        </div>
      ) : null}
      {voucherViewModels.length === 0 ? (
        supplier ? (
          <div className="glass-panel rounded-xl p-8 text-center">
            <p className="text-sm text-muted-foreground">{t("emptyForSupplier", { supplier })}</p>
          </div>
        ) : (
          <div className="glass-panel rounded-xl p-8 text-center" data-testid="journal-empty">
            <p className="text-sm font-semibold text-foreground">{t("empty")}</p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{t("emptyPreview")}</p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/capture"
                data-testid="journal-empty-capture"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm"
              >
                {t("emptyCaptureCta")}
              </Link>
              <Link
                href="/capture"
                data-testid="journal-empty-import"
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-muted"
              >
                {t("emptyImportCta")}
              </Link>
            </div>
          </div>
        )
      ) : (
        <LedgerVoucherOverview
          mode={ledgerMode}
          vouchers={voucherViewModels}
          expandedVoucherId={voucher}
          onToggle={handleToggle}
        />
      )}
      <LedgerVoucherDrawer open={drawerOpen} viewModel={selectedViewModel} onClose={handleDrawerClose} />
    </div>
  );
}
