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
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const returnTarget = returnFocusRef.current;
      window.requestAnimationFrame(() => {
        if (returnTarget?.isConnected) {
          returnTarget.focus();
        }
      });
    };
  }, [open]);

  useDialogFocusTrap(panelRef, open, close);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    registerGlobalTourBlocker("ledger-voucher-drawer", true);
    return () => registerGlobalTourBlocker("ledger-voucher-drawer", false);
  }, [open]);

  if (!open || !viewModel) {
    return null;
  }

  const description = viewModel.lines[0]?.description || viewModel.supplierName || viewModel.voucherNumber;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/35 backdrop-blur-sm print:hidden">
      <button
        type="button"
        aria-label={t("drawerClose")}
        data-testid="ledger-voucher-drawer-backdrop"
        className="absolute inset-0 cursor-default"
        onClick={close}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ledger-voucher-drawer-title"
        data-testid="ledger-voucher-drawer"
        className="glass-chrome relative flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto p-5 pb-[calc(env(safe-area-inset-bottom)+144px)] sm:rounded-l-2xl lg:pb-5"
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
