"use client";

import { AccountingApiError } from "@jpx-accounting/api-client";
import type { ManualVoucherInput, VatCode } from "@jpx-accounting/contracts";
import { vatCodeSchema } from "@jpx-accounting/contracts";
import {
  defaultCoaTemplate,
  findCoaAccount,
  isOreExact,
  isValidCalendarDay,
  localTodayIso,
  postingImbalanceOre,
} from "@jpx-accounting/domain";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { apiClient } from "../../lib/client";
import { invalidateLedgerDerived } from "../../lib/query-invalidation";
import { Button } from "../ui/button";
import { Money } from "../ui/money";
import { SectionLabel } from "../ui/section-label";

const ACCOUNT_PATTERN = /^\d{4}$/;
/** Mirrors `manualVoucherInputSchema`: at least 2 lines, at most 100. */
const MIN_ROWS = 2;
const MAX_ROWS = 100;
const MAX_DESCRIPTION = 200;

type ManualEntryRow = {
  id: string;
  accountNumber: string;
  debit: string;
  credit: string;
  vatCode: VatCode;
};

/**
 * Row keys only — never rendered, so a module counter is both hydration-safe
 * (no server/client value ends up in the HTML) and stable across re-renders,
 * unlike `crypto.randomUUID()` in a render path.
 */
let rowSequence = 0;

function emptyRow(): ManualEntryRow {
  rowSequence += 1;
  return { id: `manual-row-${rowSequence}`, accountNumber: "", debit: "", credit: "", vatCode: "NA" };
}

/** "" → 0 (blank leg). A non-numeric string is 0 here and invalid via `isRowValid`, never a silent amount. */
function parseAmount(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed === "") return 0;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : 0;
}

/** Exactly one positive leg, on a syntactically valid 4-digit account (`manualVoucherLineSchema`). */
function isRowValid(accountNumber: string, debit: number, credit: number): boolean {
  if (!ACCOUNT_PATTERN.test(accountNumber)) return false;
  return debit > 0 !== credit > 0;
}

/**
 * Öre precision per row, via the SAME domain predicate `planManualVoucher`
 * gates on. Balance alone is not enough: `postingImbalanceOre` compares ROUNDED
 * integer öre, so 100.006 debit against 100.006 credit renders a 0,00
 * difference and would sail through to a 422 that says the entry does not
 * balance — while the user is looking at a zero difference (fix wave I-3).
 * `<input type="number" step="0.01">` does not block extra decimals: the form
 * is `noValidate` and nothing calls `checkValidity()`.
 */
function isRowOreExact(debit: number, credit: number): boolean {
  return isOreExact(debit) && isOreExact(credit);
}

/**
 * Manual N-line journal entry (KFR Phase E / Task E.4), rendered inline at
 * `/books?view=manual-entry` — not a modal, so the whole form is reachable by
 * keyboard without a focus trap and the browser's own tab order is the flow.
 *
 * "AI suggests, never mutates" applies to humans too: this posts through
 * `createManualVoucher`, which creates a `needs-review` voucher. The review
 * queue stays the ONLY path to a posted voucher — nothing reaches the ledger
 * here.
 */
export function ManualEntryView() {
  const t = useTranslations("books.manualEntry");
  const queryClient = useQueryClient();
  const router = useRouter();
  // Local calendar parts, never `toISOString().slice(0, 10)` — the UTC path
  // mis-buckets the hours either side of midnight in a UTC+N workspace.
  const localToday = localTodayIso();

  const [description, setDescription] = useState("");
  const [bookedAt, setBookedAt] = useState(localToday);
  const [rows, setRows] = useState<ManualEntryRow[]>(() => [emptyRow(), emptyRow()]);

  function updateRow(id: string, patch: Partial<ManualEntryRow>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }
  function addRow() {
    setRows((current) => (current.length >= MAX_ROWS ? current : [...current, emptyRow()]));
  }
  function removeRow(id: string) {
    setRows((current) => (current.length <= MIN_ROWS ? current : current.filter((row) => row.id !== id)));
  }

  const parsedRows = rows.map((row) => ({
    ...row,
    debitNumber: parseAmount(row.debit),
    creditNumber: parseAmount(row.credit),
  }));
  const totalDebit = parsedRows.reduce((sum, row) => sum + row.debitNumber, 0);
  const totalCredit = parsedRows.reduce((sum, row) => sum + row.creditNumber, 0);
  // Öre-exact imbalance from the ONE domain helper the stores gate on, so the
  // client's "balanced" verdict is the server's verdict — no float drift.
  const imbalanceOre = postingImbalanceOre(
    parsedRows.map((row) => ({ debit: row.debitNumber, credit: row.creditNumber })),
  );
  const balanced = imbalanceOre === 0;
  const rowsValid = parsedRows.every((row) => isRowValid(row.accountNumber, row.debitNumber, row.creditNumber));
  const rowsOreExact = parsedRows.every((row) => isRowOreExact(row.debitNumber, row.creditNumber));
  const descriptionValid = description.trim().length > 0 && description.trim().length <= MAX_DESCRIPTION;
  // A future booking date is refused by `planManualVoucher` (422), because
  // `deriveBookedAt` would otherwise discard it at approval and silently book
  // the entry on the approval day. Mirror that gate client-side so the refusal
  // is visible before submit rather than after.
  const bookedAtValid = isValidCalendarDay(bookedAt) && bookedAt <= localToday;

  /**
   * HTTP-status branching (the client drops the machine code, so the status is
   * what is left to read): 400 is the Zod wire-schema refusal, 422 the store's
   * exact-öre invariant (`invalid_manual_voucher`). 429 never reaches here —
   * `api-client` retries rate limits internally with backoff.
   */
  function describeError(error: unknown): string {
    if (!(error instanceof AccountingApiError)) return t("createError");
    // 422 covers three distinct refusals (sub-öre line, öre imbalance, bad
    // booking date) and the server's own message names WHICH — mapping them
    // all to the fixed "does not balance" string contradicted the form's own
    // 0,00 difference badge (I-3). Fall back to that string only when the
    // server sent no detail.
    if (error.status === 422) return error.detail || t("createErrorImbalance");
    if (error.status === 400) return t("createErrorValidation");
    return error.detail || t("createError");
  }

  const createManualVoucher = useMutation({
    mutationFn: (input: ManualVoucherInput) => apiClient.createManualVoucher(input),
    onSuccess: () => {
      invalidateLedgerDerived(queryClient);
      setRows([emptyRow(), emptyRow()]);
      setDescription("");
      setBookedAt(localTodayIso());
      toast.success(t("createSuccess"), {
        action: { label: t("openReviewQueue"), onClick: () => router.push("/today?view=queue") },
      });
    },
    // Toast for immediacy (the submit button can be far down a long form) plus
    // the persistent inline alert below, which survives the toast timeout.
    onError: (error) => toast.error(describeError(error)),
  });

  const submitDisabled =
    !balanced || !rowsValid || !rowsOreExact || !descriptionValid || !bookedAtValid || createManualVoucher.isPending;

  // One "why can't I submit?" line, balance first — the primary gate. The
  // imbalance case renders in the totals panel next to the numbers it is about.
  // Öre precision ranks right after the row shape: a sub-öre amount reads as
  // balanced, so without its own line the form would look submittable.
  const blockedHint = balanced
    ? !rowsValid
      ? t("rowError")
      : !rowsOreExact
        ? t("oreError")
        : !descriptionValid
          ? t("descriptionRequired")
          : !isValidCalendarDay(bookedAt)
            ? t("bookedAtInvalid")
            : !bookedAtValid
              ? t("bookedAtFuture")
              : null
    : null;

  const submitError = createManualVoucher.error ? describeError(createManualVoucher.error) : null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitDisabled) return;
    createManualVoucher.mutate({
      description: description.trim(),
      bookedAt,
      lines: rows.map((row) => ({
        accountNumber: row.accountNumber,
        debit: parseAmount(row.debit),
        credit: parseAmount(row.credit),
        // Explicit: `vatCode` is required on the parsed line type even though
        // the wire schema defaults it.
        vatCode: row.vatCode,
      })),
    });
  }

  return (
    <div className="space-y-4" data-testid="manual-entry-view" data-tour="books-manual-entry">
      <div className="glass-panel rounded-xl p-5">
        <p className="text-eyebrow">{t("eyebrow")}</p>
        <h2 className="mt-2 text-lg font-semibold text-foreground">{t("title")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("description")}</p>

        <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="manual-entry-description" className="text-eyebrow block">
                {t("descriptionLabel")}
              </label>
              <input
                id="manual-entry-description"
                data-testid="manual-entry-description"
                type="text"
                maxLength={MAX_DESCRIPTION}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t("descriptionPlaceholder")}
                className="glass-panel-inset mt-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
              />
            </div>
            <div>
              <label htmlFor="manual-entry-booked-at" className="text-eyebrow block">
                {t("bookedAtLabel")}
              </label>
              <input
                id="manual-entry-booked-at"
                data-testid="manual-entry-booked-at"
                data-visual-mask
                type="date"
                // The picker's own ceiling; the JS gate above is what actually
                // blocks submit (the form is `noValidate`, so a `max` violation
                // never silently swallows a submission).
                max={localToday}
                value={bookedAt}
                onChange={(event) => setBookedAt(event.target.value)}
                className="glass-panel-inset mt-2 w-full rounded-lg px-3 py-2 text-sm tabular-nums outline-none"
              />
            </div>
          </div>

          {/*
            Native `<input list>` + `<datalist>`: the one idiom that searches a
            long list AND still accepts a free 4-digit account (the SIE-import
            precedent — an imported chart may hold accounts this template does
            not). Option text carries "NNNN — name" because BAS display names
            are not unique (2890 and 2899 share one).
          */}
          <datalist id="manual-entry-coa-options">
            {defaultCoaTemplate.accounts.map((account) => (
              <option key={account.number} value={account.number}>
                {account.number} — {account.name}
              </option>
            ))}
          </datalist>

          <div className="space-y-3">
            {rows.map((row, index) => {
              const debitNumber = parseAmount(row.debit);
              const creditNumber = parseAmount(row.credit);
              const accountValid = ACCOUNT_PATTERN.test(row.accountNumber);
              const amountValid = debitNumber > 0 !== creditNumber > 0;
              const accountName = accountValid
                ? (findCoaAccount(defaultCoaTemplate, row.accountNumber)?.name ?? t("accountUnknown"))
                : t("accountInvalid");
              return (
                <div
                  key={row.id}
                  className="glass-panel-inset rounded-lg p-3 sm:p-4"
                  data-testid={`manual-entry-row-${index}`}
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.6fr_1fr_1fr_1fr_auto] sm:items-start">
                    <div>
                      <label htmlFor={`manual-entry-account-${index}`} className="text-eyebrow block">
                        {t("accountLabel")}
                      </label>
                      <input
                        id={`manual-entry-account-${index}`}
                        data-testid={`manual-entry-account-${index}`}
                        list="manual-entry-coa-options"
                        inputMode="numeric"
                        autoComplete="off"
                        value={row.accountNumber}
                        onChange={(event) => updateRow(row.id, { accountNumber: event.target.value.trim() })}
                        placeholder={t("accountPlaceholder")}
                        aria-describedby={`manual-entry-account-hint-${index}`}
                        className="glass-panel-inset mt-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
                      />
                      <p
                        id={`manual-entry-account-hint-${index}`}
                        className={`mt-1 text-xs ${row.accountNumber !== "" && !accountValid ? "text-danger" : "text-muted-foreground"}`}
                      >
                        {row.accountNumber === "" ? "" : accountName}
                      </p>
                    </div>
                    <div>
                      <label htmlFor={`manual-entry-debit-${index}`} className="text-eyebrow block">
                        {t("debitLabel")}
                      </label>
                      <input
                        id={`manual-entry-debit-${index}`}
                        data-testid={`manual-entry-debit-${index}`}
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        value={row.debit}
                        // Debit and credit are mutually exclusive per line: typing
                        // into one clears the other so a row can never carry two legs.
                        onChange={(event) =>
                          updateRow(row.id, {
                            debit: event.target.value,
                            credit: event.target.value ? "" : row.credit,
                          })
                        }
                        className="glass-panel-inset mt-2 w-full rounded-lg px-3 py-2 text-sm tabular-nums outline-none"
                      />
                    </div>
                    <div>
                      <label htmlFor={`manual-entry-credit-${index}`} className="text-eyebrow block">
                        {t("creditLabel")}
                      </label>
                      <input
                        id={`manual-entry-credit-${index}`}
                        data-testid={`manual-entry-credit-${index}`}
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        value={row.credit}
                        onChange={(event) =>
                          updateRow(row.id, {
                            credit: event.target.value,
                            debit: event.target.value ? "" : row.debit,
                          })
                        }
                        className="glass-panel-inset mt-2 w-full rounded-lg px-3 py-2 text-sm tabular-nums outline-none"
                      />
                    </div>
                    <div>
                      <label htmlFor={`manual-entry-vat-${index}`} className="text-eyebrow block">
                        {t("vatCodeLabel")}
                      </label>
                      <select
                        id={`manual-entry-vat-${index}`}
                        data-testid={`manual-entry-vat-${index}`}
                        value={row.vatCode}
                        onChange={(event) => updateRow(row.id, { vatCode: event.target.value as VatCode })}
                        className="glass-panel-inset mt-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
                      >
                        {vatCodeSchema.options.map((code) => (
                          <option key={code} value={code}>
                            {code}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      data-testid={`manual-entry-remove-row-${index}`}
                      aria-label={t("removeRowAria", { row: index + 1 })}
                      disabled={rows.length <= MIN_ROWS}
                      onClick={() => removeRow(row.id)}
                      className="mt-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-surface-muted disabled:opacity-40 sm:mt-7"
                    >
                      {t("removeRow")}
                    </button>
                  </div>
                  {!amountValid && (row.debit !== "" || row.credit !== "") ? (
                    <p className="mt-2 text-xs text-danger">{t("rowError")}</p>
                  ) : null}
                  {/* I-3: sub-öre precision, called out on the row that carries
                      it — the totals panel cannot show it (integer öre round it
                      away) and the server's 422 arrives only after submit. */}
                  {!isRowOreExact(debitNumber, creditNumber) ? (
                    <p
                      role="status"
                      data-testid={`manual-entry-ore-error-${index}`}
                      className="mt-2 text-xs text-danger"
                    >
                      {t("oreError")}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>

          <button
            type="button"
            data-testid="manual-entry-add-row"
            disabled={rows.length >= MAX_ROWS}
            onClick={addRow}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-muted disabled:opacity-40"
          >
            {t("addRow")}
          </button>

          <div className="glass-panel-soft rounded-lg p-4" data-testid="manual-entry-totals">
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <div>
                <SectionLabel>{t("totalDebit")}</SectionLabel>
                <Money value={totalDebit} className="mt-1 block font-semibold" />
              </div>
              <div>
                <SectionLabel>{t("totalCredit")}</SectionLabel>
                <Money value={totalCredit} className="mt-1 block font-semibold" />
              </div>
              {/* Announced politely: a screen-reader user typing amounts hears the
                  running difference reach zero without leaving the field. */}
              <div
                data-testid="manual-entry-diff"
                aria-live="polite"
                className={balanced ? "text-success" : "text-danger"}
              >
                <SectionLabel>{t("diff")}</SectionLabel>
                <Money value={imbalanceOre / 100} className="mt-1 block font-semibold" />
              </div>
            </div>
            {!balanced ? (
              <p role="status" className="mt-2 text-xs text-danger">
                {t("imbalanceHint")}
              </p>
            ) : null}
          </div>

          {submitError ? (
            <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
              {submitError}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-3">
            {blockedHint ? <p className="text-xs text-muted-foreground">{blockedHint}</p> : null}
            <Button type="submit" data-testid="manual-entry-submit" disabled={submitDisabled}>
              {createManualVoucher.isPending ? t("submitting") : t("submit")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
