"use client";

import type { ReviewDecisionEdit, ReviewTask, Voucher } from "@jpx-accounting/contracts";
import {
  defaultCoaTemplate,
  deriveBookedAt,
  findCoaAccount,
  isValidCalendarDay,
  localTodayIso,
} from "@jpx-accounting/domain";
import { useMutation } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { apiClient } from "../../lib/client";
import { useDialogFocusTrap } from "../../lib/focus-trap";
import { getErrorMessage } from "../../lib/request-errors";
import { WORKSPACE_IDENTITY } from "../../lib/workspace-identity";
import { registerGlobalTourBlocker } from "../onboarding/onboarding-shell";
import { Button } from "../ui/button";

const VAT_CODES = ["VAT25", "VAT12", "VAT6", "VAT0", "NA"] as const;

/** Mirrors the domain tolerance in `resolveReviewDecisionEdit` (net + VAT = gross ± 0.01). */
const AMOUNT_TOLERANCE = 0.01;

function toInputValue(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

/** "" → undefined (field cleared); non-numeric → NaN (invalid); otherwise the number. */
function parseAmount(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  return Number(trimmed);
}

/** NaN never equals itself, so an unparsable input always counts as changed (and later invalid). */
function amountsDiffer(parsed: number | undefined, original: number | undefined): boolean {
  return parsed !== original;
}

type ReviewEditSheetProps = {
  review: ReviewTask;
  voucher: Voucher | undefined;
  onClose: () => void;
  /** Wired to TodayScreen's onMutationSuccess so the optimistic snapshot update is reused. */
  onSuccess: (review: ReviewTask | undefined) => void;
};

/**
 * Decision-time editor for a review: correct the account, VAT code, or amounts
 * before approving. Append-only by design — submitting calls the regular
 * approve endpoint with `edited`, which posts NEW ledger lines derived from
 * the corrections; the stored voucher, suggestion, and event history are
 * never rewritten.
 */
export function ReviewEditSheet({ review, voucher, onClose, onSuccess }: ReviewEditSheetProps) {
  const t = useTranslations("today.editSheet");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const accountSelectRef = useRef<HTMLSelectElement | null>(null);

  const [accountNumber, setAccountNumber] = useState(
    () => review.suggestion?.accountNumber ?? defaultCoaTemplate.roles.fallbackExpense,
  );
  const [vatCode, setVatCode] = useState(() => {
    const suggested = review.suggestion?.vatCode;
    return suggested && (VAT_CODES as readonly string[]).includes(suggested) ? suggested : "VAT25";
  });
  const [grossInput, setGrossInput] = useState(() => toInputValue(voucher?.voucherFields.grossAmount));
  const [netInput, setNetInput] = useState(() => toInputValue(voucher?.voucherFields.netAmount));
  const [vatInput, setVatInput] = useState(() => toInputValue(voucher?.voucherFields.vatAmount));
  // R13: accounting date the approval will book at. Default = the SAME shared
  // derivation the stores run (voucher transaction/receipt date, today
  // fallback), so an untouched field posts identically whether or not it is
  // sent. Locked/closed-period validation is a Later feature — any past day is
  // accepted today.
  const localToday = localTodayIso();
  const derivedBookedAt = deriveBookedAt(voucher?.voucherFields, new Date().toISOString());
  const [bookedAtInput, setBookedAtInput] = useState(derivedBookedAt);

  useDialogFocusTrap(dialogRef, true, onClose, accountSelectRef);

  const approveWithEdits = useMutation({
    mutationFn: (edited: ReviewDecisionEdit) =>
      apiClient.approveReview(review.id, { actorId: WORKSPACE_IDENTITY.actorId, edited }),
    onSuccess,
  });

  const gross = parseAmount(grossInput);
  const net = parseAmount(netInput);
  const vat = parseAmount(vatInput);

  const amountsChanged =
    amountsDiffer(gross, voucher?.voucherFields.grossAmount) ||
    amountsDiffer(net, voucher?.voucherFields.netAmount) ||
    amountsDiffer(vat, voucher?.voucherFields.vatAmount);

  // Mirrors the domain rule enforced by `InvalidReviewEditError`: amount edits are
  // all-or-nothing and must satisfy net + VAT = gross within the tolerance.
  const amountsValid =
    !amountsChanged ||
    (gross !== undefined &&
      net !== undefined &&
      vat !== undefined &&
      Number.isFinite(gross) &&
      Number.isFinite(net) &&
      Number.isFinite(vat) &&
      gross > 0 &&
      net >= 0 &&
      vat >= 0 &&
      Math.abs(net + vat - gross) <= AMOUNT_TOLERANCE);

  // Mirrors the domain rule in `resolveReviewDecisionEdit`: a valid calendar
  // day, not in the future. Empty = "use the derived default" (field omitted).
  const bookedAtChanged = bookedAtInput !== "" && bookedAtInput !== derivedBookedAt;
  const bookedAtValid = bookedAtInput === "" || (isValidCalendarDay(bookedAtInput) && bookedAtInput <= localToday);

  const accountName = findCoaAccount(defaultCoaTemplate, accountNumber)?.name ?? accountNumber;
  const submitDisabled = !amountsValid || !bookedAtValid || approveWithEdits.isPending;
  const submitError = approveWithEdits.error ? getErrorMessage(approveWithEdits.error, t("submitError")) : null;

  useEffect(() => {
    registerGlobalTourBlocker("review-edit-sheet", true);
    return () => registerGlobalTourBlocker("review-edit-sheet", false);
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitDisabled) return;
    const edited: ReviewDecisionEdit = {
      accountNumber,
      accountName,
      vatCode,
      // Amounts ride along only when the reviewer changed them; the contract
      // requires all three together (validated above).
      ...(amountsChanged && gross !== undefined && net !== undefined && vat !== undefined
        ? { grossAmount: gross, netAmount: net, vatAmount: vat }
        : {}),
      // Accounting date rides along only when it differs from the shared
      // derivation default — the stores derive the same day when omitted.
      ...(bookedAtChanged ? { bookedAt: bookedAtInput } : {}),
    };
    approveWithEdits.mutate(edited);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/35 p-3 backdrop-blur-sm sm:items-center">
      <button
        type="button"
        aria-label={t("closeAria")}
        data-testid="review-edit-backdrop"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-edit-title"
        aria-describedby="review-edit-description"
        data-testid="review-edit-sheet"
        className="glass-chrome relative max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl p-5"
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", damping: 28, stiffness: 340 }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-eyebrow">{t("eyebrow")}</p>
            <h2 id="review-edit-title" className="mt-2 text-2xl font-semibold">
              {t("title")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-testid="review-edit-close"
            className="rounded-md bg-surface px-3 py-2 text-sm font-medium text-muted-foreground"
          >
            {t("cancel")}
          </button>
        </div>
        <p id="review-edit-description" className="mt-2 text-sm text-muted-foreground">
          {t("description")}
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="review-edit-account" className="text-eyebrow block">
                {t("accountLabel")}
              </label>
              <select
                ref={accountSelectRef}
                id="review-edit-account"
                data-testid="edit-account"
                value={accountNumber}
                onChange={(event) => setAccountNumber(event.target.value)}
                className="glass-panel-inset mt-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
              >
                {defaultCoaTemplate.accounts.map((account) => (
                  <option key={account.number} value={account.number}>
                    {account.number} — {account.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="review-edit-booked-at" className="text-eyebrow block">
                {t("bookedAtLabel")}
              </label>
              <input
                id="review-edit-booked-at"
                data-testid="edit-booked-at"
                data-visual-mask
                type="date"
                max={localToday}
                value={bookedAtInput}
                onChange={(event) => setBookedAtInput(event.target.value)}
                className="glass-panel-inset mt-2 w-full rounded-lg px-3 py-2 text-sm tabular-nums outline-none"
              />
              <p className="mt-1 text-xs leading-4 text-muted-foreground">{t("bookedAtHint")}</p>
            </div>
            <div>
              <label htmlFor="review-edit-vat-code" className="text-eyebrow block">
                {t("vatCodeLabel")}
              </label>
              <select
                id="review-edit-vat-code"
                data-testid="edit-vat-code"
                value={vatCode}
                onChange={(event) => setVatCode(event.target.value)}
                className="glass-panel-inset mt-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
              >
                {VAT_CODES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="review-edit-gross" className="text-eyebrow block">
                {t("grossLabel")}
              </label>
              <input
                id="review-edit-gross"
                data-testid="edit-gross"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={grossInput}
                onChange={(event) => setGrossInput(event.target.value)}
                className="glass-panel-inset mt-2 w-full rounded-lg px-3 py-2 text-sm tabular-nums outline-none"
              />
            </div>
            <div>
              <label htmlFor="review-edit-net" className="text-eyebrow block">
                {t("netLabel")}
              </label>
              <input
                id="review-edit-net"
                data-testid="edit-net"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={netInput}
                onChange={(event) => setNetInput(event.target.value)}
                className="glass-panel-inset mt-2 w-full rounded-lg px-3 py-2 text-sm tabular-nums outline-none"
              />
            </div>
            <div>
              <label htmlFor="review-edit-vat" className="text-eyebrow block">
                {t("vatAmountLabel")}
              </label>
              <input
                id="review-edit-vat"
                data-testid="edit-vat"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={vatInput}
                onChange={(event) => setVatInput(event.target.value)}
                className="glass-panel-inset mt-2 w-full rounded-lg px-3 py-2 text-sm tabular-nums outline-none"
              />
            </div>
          </div>

          {!amountsValid ? (
            <p data-testid="edit-amount-error" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
              {t("amountError")}
            </p>
          ) : null}
          {!bookedAtValid ? (
            <p data-testid="edit-booked-at-error" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
              {t("bookedAtError")}
            </p>
          ) : null}
          {submitError ? (
            <p className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">{submitError}</p>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" data-testid="edit-submit" disabled={submitDisabled}>
              {approveWithEdits.isPending ? t("submitting") : t("submit")}
            </Button>
          </div>

          <p className="border-t border-border pt-3 text-xs leading-5 text-muted-foreground">{t("appendOnlyNote")}</p>
        </form>
      </motion.div>
    </div>
  );
}
