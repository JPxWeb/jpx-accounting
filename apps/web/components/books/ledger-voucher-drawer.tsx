"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef } from "react";

import { useDialogFocusTrap } from "../../lib/focus-trap";
import type { LedgerVoucherViewModel } from "../../lib/ledger/ledger-voucher-view-model";
import { registerGlobalTourBlocker } from "../onboarding/onboarding-shell";
import { SectionLabel } from "../ui/section-label";
import { LedgerVoucherDetail } from "./ledger-voucher-detail";

type LedgerVoucherDrawerProps = {
  open: boolean;
  viewModel: LedgerVoucherViewModel | null;
  onClose: () => void;
};

export function LedgerVoucherDrawer({ open, viewModel, onClose }: LedgerVoucherDrawerProps) {
  const t = useTranslations("books.ledger");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => onClose(), [onClose]);
  useDialogFocusTrap(panelRef, open, close);

  useEffect(() => {
    registerGlobalTourBlocker("ledger-voucher-drawer", open);
  }, [open]);

  if (!open || !viewModel) {
    return null;
  }

  const description = viewModel.lines[0]?.description ?? viewModel.supplierName;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/35 backdrop-blur-sm print:hidden"
      data-testid="ledger-voucher-drawer-backdrop"
      onClick={close}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ledger-voucher-drawer-title"
        data-testid="ledger-voucher-drawer"
        className="glass-chrome flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto p-5 pb-[calc(env(safe-area-inset-bottom)+144px)] sm:rounded-l-2xl lg:pb-5"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4">
          <div>
            <SectionLabel>{viewModel.voucherNumber}</SectionLabel>
            <h2 id="ledger-voucher-drawer-title" className="mt-2 text-xl font-semibold">
              {description}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground" data-visual-mask>
              {viewModel.bookedAt.slice(0, 10)}
            </p>
          </div>
          <button
            type="button"
            data-testid="ledger-voucher-drawer-close"
            onClick={close}
            className="rounded-md bg-surface px-3 py-2 text-sm font-medium text-muted-foreground"
          >
            {t("drawerClose")}
          </button>
        </header>

        <LedgerVoucherDetail vm={viewModel} />
      </div>
    </div>
  );
}
