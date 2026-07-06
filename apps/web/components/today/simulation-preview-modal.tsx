"use client";

import type { SimulationRun } from "@jpx-accounting/contracts";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useRef } from "react";

import { useDialogFocusTrap } from "../../lib/focus-trap";
import { Money } from "../ui/money";

type SimulationPreviewModalProps = {
  run: SimulationRun | undefined;
  loading: boolean;
  errorMessage: string | null;
  selectedCount: number;
  onClose: () => void;
};

export function SimulationPreviewModal({
  run,
  loading,
  errorMessage,
  selectedCount,
  onClose,
}: SimulationPreviewModalProps) {
  const t = useTranslations("today.simulation");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useDialogFocusTrap(dialogRef, true, onClose, closeButtonRef);

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/35 p-3 backdrop-blur-sm sm:items-center">
      <button
        type="button"
        aria-label={t("closeAria")}
        data-testid="simulation-preview-backdrop"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="simulation-preview-title"
        data-testid="simulation-preview-modal"
        className="glass-chrome relative max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl p-5"
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", damping: 28, stiffness: 340 }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-eyebrow">{t("eyebrow")}</p>
            <h2 id="simulation-preview-title" className="mt-2 text-2xl font-semibold">
              {t("title")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("description", { count: selectedCount })}</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            data-testid="simulation-preview-close"
            onClick={onClose}
            className="rounded-md bg-surface px-3 py-2 text-sm font-medium text-muted-foreground"
          >
            {t("close")}
          </button>
        </div>

        {loading ? (
          <p className="mt-5 text-sm text-muted-foreground">{t("loading")}</p>
        ) : errorMessage ? (
          <p
            className="mt-5 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger"
            data-testid="simulation-preview-error"
          >
            {errorMessage}
          </p>
        ) : run ? (
          <div className="mt-5 space-y-5">
            <p className="text-sm leading-6 text-muted-foreground">{run.outcomeSummary}</p>

            <div>
              <h3 className="text-sm font-semibold text-foreground">{t("balanceTitle")}</h3>
              {run.balanceDelta.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">{t("balanceEmpty")}</p>
              ) : (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[28rem] text-sm" data-testid="simulation-balance-table">
                    <thead>
                      <tr className="text-left text-caption text-muted-foreground">
                        <th className="pb-2 pr-3 font-medium">{t("accountColumn")}</th>
                        <th className="pb-2 pr-3 font-medium">{t("debitColumn")}</th>
                        <th className="pb-2 font-medium">{t("creditColumn")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {run.balanceDelta.map((row) => (
                        <tr key={row.accountNumber} data-testid="simulation-balance-row">
                          <td className="border-t border-border py-2 pr-3">
                            <span className="font-mono">{row.accountNumber}</span> {row.accountName}
                          </td>
                          <td className="border-t border-border py-2 pr-3 tabular-nums">
                            {row.deltaDebit !== 0 ? <Money value={row.deltaDebit} /> : "—"}
                          </td>
                          <td className="border-t border-border py-2 tabular-nums">
                            {row.deltaCredit !== 0 ? <Money value={row.deltaCredit} /> : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <h3 className="text-sm font-semibold text-foreground">{t("vatTitle")}</h3>
              {run.vatDelta.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">{t("vatEmpty")}</p>
              ) : (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[20rem] text-sm" data-testid="simulation-vat-table">
                    <thead>
                      <tr className="text-left text-caption text-muted-foreground">
                        <th className="pb-2 pr-3 font-medium">{t("vatCodeColumn")}</th>
                        <th className="pb-2 pr-3 font-medium">{t("baseColumn")}</th>
                        <th className="pb-2 font-medium">{t("amountColumn")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {run.vatDelta.map((row) => (
                        <tr key={row.vatCode} data-testid="simulation-vat-row">
                          <td className="border-t border-border py-2 pr-3 font-mono">{row.vatCode}</td>
                          <td className="border-t border-border py-2 pr-3 tabular-nums">
                            <Money value={row.deltaBase} />
                          </td>
                          <td className="border-t border-border py-2 tabular-nums">
                            <Money value={row.deltaAmount} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </motion.div>
    </div>
  );
}
