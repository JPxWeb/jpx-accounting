"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { parseAsString, parseAsStringEnum, useQueryState } from "nuqs";
import { useMemo } from "react";

import { usePeriodScope } from "../../hooks/use-period-scope";
import { apiClient } from "../../lib/client";
import { groupJournalByVoucher } from "../../lib/ledger/group-vouchers";
import { resolveLedgerMode, saveLedgerMode, type LedgerMode } from "../../lib/ledger/ledger-mode-storage";
import { buildLedgerVoucherViewModel, type LedgerVoucherViewModel } from "../../lib/ledger/ledger-voucher-view-model";
import { buildVoucherLookup } from "../reports/voucher-link";
import { LedgerVoucherDrawer } from "./ledger-voucher-drawer";
import { LedgerVoucherOverview } from "./ledger-voucher-overview";

const ledgerModes = ["inline", "drawer"] as const;

function matchesQuery(vm: LedgerVoucherViewModel, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (vm.voucherNumber.toLowerCase().includes(needle)) return true;
  if (vm.supplierName.toLowerCase().includes(needle)) return true;
  if (vm.voucherId.toLowerCase().includes(needle)) return true;
  return vm.lines.some((line) => line.description.toLowerCase().includes(needle));
}

export function JournalView() {
  const t = useTranslations("books.journal");
  const tLedger = useTranslations("books.ledger");
  const tBooks = useTranslations("books");
  const { from, to } = usePeriodScope();
  const [supplier, setSupplier] = useQueryState("supplier", parseAsString);
  const [ledgerModeParam, setLedgerModeParam] = useQueryState("ledgerMode", parseAsStringEnum([...ledgerModes]));
  const [voucher, setVoucher] = useQueryState("voucher", parseAsString);
  const [q, setQ] = useQueryState("q", parseAsString);

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

  const filteredVoucherViewModels = useMemo(() => {
    if (!q) return voucherViewModels;
    return voucherViewModels.filter((vm) => matchesQuery(vm, q));
  }, [q, voucherViewModels]);

  function handleToggle(voucherId: string) {
    void setVoucher(voucher === voucherId ? null : voucherId);
  }

  function handleDrawerClose() {
    void setVoucher(null);
  }

  function handleModeChange(mode: LedgerMode) {
    saveLedgerMode(mode);
    void setLedgerModeParam(mode);
    void setVoucher(null);
  }

  const selectedViewModel = filteredVoucherViewModels.find((vm) => vm.voucherId === voucher) ?? null;
  const drawerOpen = ledgerMode === "drawer" && selectedViewModel !== null;
  const hasJournalEntries = voucherViewModels.length > 0;

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
      {hasJournalEntries ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="block flex-1">
            <span className="sr-only">{tLedger("searchPlaceholder")}</span>
            <input
              type="search"
              data-testid="journal-search"
              value={q ?? ""}
              placeholder={tLedger("searchPlaceholder")}
              onChange={(event) => void setQ(event.target.value || null)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </label>
          <div
            role="group"
            aria-label={tLedger("modeSwitchAria")}
            data-testid="ledger-mode-switch"
            className="inline-flex rounded-lg border border-border bg-surface p-1"
          >
            <button
              type="button"
              data-testid="ledger-mode-inline"
              aria-pressed={ledgerMode === "inline"}
              onClick={() => handleModeChange("inline")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                ledgerMode === "inline" ? "bg-primary text-white shadow-sm" : "text-muted-foreground"
              }`}
            >
              {tLedger("modeInline")}
            </button>
            <button
              type="button"
              data-testid="ledger-mode-drawer"
              aria-pressed={ledgerMode === "drawer"}
              onClick={() => handleModeChange("drawer")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                ledgerMode === "drawer" ? "bg-primary text-white shadow-sm" : "text-muted-foreground"
              }`}
            >
              {tLedger("modeDrawer")}
            </button>
          </div>
        </div>
      ) : null}
      {!hasJournalEntries ? (
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
      ) : filteredVoucherViewModels.length === 0 ? (
        <div className="glass-panel rounded-xl p-8 text-center" data-testid="journal-search-empty">
          <p className="text-sm text-muted-foreground">{tLedger("emptySearch")}</p>
        </div>
      ) : (
        <LedgerVoucherOverview
          mode={ledgerMode}
          vouchers={filteredVoucherViewModels}
          expandedVoucherId={voucher}
          onToggle={handleToggle}
        />
      )}
      <LedgerVoucherDrawer open={drawerOpen} viewModel={selectedViewModel} onClose={handleDrawerClose} />
    </div>
  );
}
