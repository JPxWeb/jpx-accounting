"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { parseAsString, useQueryState } from "nuqs";
import { usePeriodScope } from "../../hooks/use-period-scope";
import { apiClient } from "../../lib/client";
import { buildVoucherLookup, VoucherLink } from "../reports/voucher-link";
import { Money } from "../ui/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

export function JournalView() {
  const t = useTranslations("books.journal");
  const tBooks = useTranslations("books");
  const { from, to } = usePeriodScope();
  const [supplier, setSupplier] = useQueryState("supplier", parseAsString);

  // Server-filtered (Phase 4): the journal is fetched for the resolved period
  // window instead of slicing the snapshot client-side.
  const journalQuery = useQuery({
    queryKey: ["reports", "journal", from, to],
    queryFn: () => apiClient.getJournal({ from, to }),
  });
  // The snapshot still supplies voucher numbers and supplier names; the
  // supplier filter stays client-side against snapshot vouchers (plan 4.5).
  const { data: workspace } = useQuery({
    queryKey: ["workspace"],
    queryFn: () => apiClient.getSnapshot(),
  });

  // One lookup for both the supplier filter and the VoucherLink cells (Task
  // 4.8): voucher→packet→evidence resolves from the snapshot alone.
  const lookup = buildVoucherLookup(workspace);
  const vouchersById = lookup.vouchersById;

  const entries = (journalQuery.data ?? []).filter((entry) => {
    if (!supplier) return true;
    const voucher = vouchersById.get(entry.voucherId);
    const supplierName = voucher ? (voucher.voucherFields.supplierName ?? tBooks("unknownSupplier")) : "";
    return supplierName.toLowerCase() === supplier.toLowerCase();
  });

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
      {entries.length === 0 ? (
        supplier ? (
          <div className="glass-panel rounded-xl p-8 text-center">
            <p className="text-sm text-muted-foreground">{t("emptyForSupplier", { supplier })}</p>
          </div>
        ) : (
          // Empty preview (Task 6.1): say what WILL appear here and link the two
          // ways to get there — both live on /capture (quick-add + SIE import).
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
        <div className="glass-panel rounded-xl p-5">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("headerDate")}</TableHead>
                <TableHead>{t("headerVoucher")}</TableHead>
                <TableHead>{t("headerAccount")}</TableHead>
                <TableHead>{t("headerDescription")}</TableHead>
                <TableHead className="text-right">{t("headerDebit")}</TableHead>
                <TableHead className="text-right">{t("headerCredit")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={`${entry.voucherId}-${entry.accountNumber}`}>
                  {/* Demo-seed bookings are dated "now"; masked so visual baselines stay date-stable. */}
                  <TableCell data-visual-mask>{entry.bookedAt.slice(0, 10)}</TableCell>
                  {/* Same TEXT as before (voucherNumber ?? voucherId) — VoucherLink only
                      adds the evidence link / imported badge around it (Task 4.8). */}
                  <TableCell className="text-mono">
                    <VoucherLink voucherId={entry.voucherId} lookup={lookup} />
                  </TableCell>
                  <TableCell>
                    {entry.accountNumber} {entry.accountName}
                  </TableCell>
                  <TableCell>{entry.description}</TableCell>
                  <TableCell className="text-right">
                    <Money value={entry.debit} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={entry.credit} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
