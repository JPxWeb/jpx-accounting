"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { parseAsString, useQueryState } from "nuqs";
import { useCallback, useEffect, useRef } from "react";

import { usePeriodScope } from "../../hooks/use-period-scope";
import { apiClient } from "../../lib/client";
import { useDialogFocusTrap } from "../../lib/focus-trap";
import { registerGlobalTourBlocker } from "../onboarding/onboarding-shell";
import { Money } from "../ui/money";
import { SectionLabel } from "../ui/section-label";
import { buildVoucherLookup, VoucherLink } from "./voucher-link";

/**
 * Account drill drawer (advisory-pivot Phase 4, Task 4.8). The open account
 * IS the `?drill=<accountNumber>` URL param (nuqs) — shareable and back-safe.
 * Data comes from the SAME server-filtered journal window the Books views use
 * (`getJournal({from,to})`, shared query key → shared cache), filtered to the
 * account client-side. Each line carries a `VoucherLink` (evidence link,
 * imported badge, or plain text — plan finding 4). The footer hands off to
 * the general ledger with the SAME period token, so the window follows the
 * user across surfaces.
 */
export function AccountDrillDrawer() {
  const t = useTranslations("reports.drill");
  const { raw, from, to } = usePeriodScope();
  const [drill, setDrill] = useQueryState("drill", parseAsString);
  const open = drill !== null && drill !== "";

  const panelRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => void setDrill(null), [setDrill]);
  useDialogFocusTrap(panelRef, open, close);

  useEffect(() => {
    registerGlobalTourBlocker("account-drill-drawer", open);
  }, [open]);

  const journalQuery = useQuery({
    queryKey: ["reports", "journal", from, to],
    queryFn: () => apiClient.getJournal({ from, to }),
    enabled: open,
  });
  const { data: workspace } = useQuery({
    queryKey: ["workspace"],
    queryFn: () => apiClient.getSnapshot(),
    enabled: open,
  });

  if (!open) {
    return null;
  }

  const lines = (journalQuery.data ?? []).filter((entry) => entry.accountNumber === drill);
  const accountName = lines[0]?.accountName;
  const lookup = buildVoucherLookup(workspace);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/35 backdrop-blur-sm print:hidden"
      data-testid="account-drill-backdrop"
      onClick={close}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-drill-title"
        data-testid="account-drill-drawer"
        className="glass-chrome flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto p-5 sm:rounded-l-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4">
          <div>
            <SectionLabel>{t("title", { account: drill })}</SectionLabel>
            <h2 id="account-drill-title" className="mt-2 text-xl font-semibold">
              {accountName ?? t("title", { account: drill })}
            </h2>
          </div>
          <button
            type="button"
            data-testid="account-drill-close"
            onClick={close}
            className="rounded-md bg-surface px-3 py-2 text-sm font-medium text-muted-foreground"
          >
            {t("close")}
          </button>
        </header>

        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="space-y-2">
            {lines.map((entry) => (
              <li key={entry.id} data-testid="drill-line" className="glass-panel-soft rounded-lg px-3 py-3 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs text-muted-foreground">{entry.bookedAt.slice(0, 10)}</span>
                  <Money value={entry.debit - entry.credit} />
                </div>
                <p className="mt-1">{entry.description}</p>
                <p className="mt-1">
                  <VoucherLink voucherId={entry.voucherId} lookup={lookup} />
                </p>
              </li>
            ))}
          </ul>
        )}

        <footer className="mt-auto border-t border-border pt-4">
          <Link
            data-testid="drill-open-ledger"
            href={`/books?view=general-ledger&account=${encodeURIComponent(drill)}&period=${encodeURIComponent(raw)}`}
            className="block rounded-lg bg-primary px-5 py-3 text-center text-sm font-semibold text-white shadow-md"
          >
            {t("openLedger")}
          </Link>
        </footer>
      </div>
    </div>
  );
}
