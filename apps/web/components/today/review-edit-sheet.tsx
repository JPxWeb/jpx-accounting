"use client";

import type { EnrichmentProposal, ReviewDecisionEdit, ReviewTask, Voucher } from "@jpx-accounting/contracts";
import { defaultCoaTemplate, findCoaAccount, localTodayIso } from "@jpx-accounting/domain";
import { deriveBookedAt, isValidCalendarDay } from "@jpx-accounting/domain/store-shared";
import { useMutation } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { apiClient } from "../../lib/client";
import { useDialogFocusTrap } from "../../lib/focus-trap";
import { getErrorMessage } from "../../lib/request-errors";
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
  evidenceIds?: string[];
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
export function ReviewEditSheet({ review, voucher, evidenceIds = [], onClose, onSuccess }: ReviewEditSheetProps) {
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
  const [workflow, setWorkflow] = useState<"none" | "project" | "invoice" | "trip" | "quantity_inventory">("none");
  const [projectId, setProjectId] = useState("");
  const [activityCode, setActivityCode] = useState("");
  const [objectCode, setObjectCode] = useState("");
  const [invoiceDirection, setInvoiceDirection] = useState<"" | "ar" | "ap">("");
  const [invoiceCounterparty, setInvoiceCounterparty] = useState("");
  const [invoiceDueDate, setInvoiceDueDate] = useState("");
  const [tripPurpose, setTripPurpose] = useState("");
  const [tripTraveler, setTripTraveler] = useState("");
  const [tripStartDate, setTripStartDate] = useState("");
  const [tripEndDate, setTripEndDate] = useState("");
  const [tripEvidenceId, setTripEvidenceId] = useState("");
  const [inventorySkuId, setInventorySkuId] = useState("");
  const [inventoryQuantity, setInventoryQuantity] = useState("");
  const [inventoryUom, setInventoryUom] = useState("");
  const [inventoryDirection, setInventoryDirection] = useState<"" | "in" | "out">("");

  useDialogFocusTrap(dialogRef, true, handleClose, accountSelectRef);

  // No actorId (WS-C R5): the server derives attribution.
  const approveWithEdits = useMutation({
    mutationFn: async ({
      edited,
      proposal,
    }: {
      edited: ReviewDecisionEdit;
      proposal?: Extract<
        EnrichmentProposal,
        { kind: "project_assignment" | "invoice_registration" | "trip_registration" | "quantity_inventory_movement" }
      >;
    }) => {
      await apiClient.attachReviewEnrichmentIntent({
        reviewId: review.id,
        proposals: [proposal ?? { kind: "noop" }],
      });
      return apiClient.approveReview(review.id, { edited, enrichmentIntent: "consume" });
    },
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
  const projectRequired = workflow === "project" && projectId.trim() === "";
  const invoiceDirectionRequired = workflow === "invoice" && invoiceDirection === "";
  const invoiceCounterpartyRequired = workflow === "invoice" && invoiceCounterparty.trim() === "";
  const invoiceDueDateRequired = workflow === "invoice" && !isValidCalendarDay(invoiceDueDate);
  const invoiceAmountInvalid = workflow === "invoice" && (gross === undefined || !Number.isFinite(gross) || gross <= 0);
  const invoiceValid =
    !invoiceDirectionRequired && !invoiceCounterpartyRequired && !invoiceDueDateRequired && !invoiceAmountInvalid;
  const tripPurposeRequired = workflow === "trip" && tripPurpose.trim() === "";
  const tripTravelerRequired = workflow === "trip" && tripTraveler.trim() === "";
  const tripStartDateRequired = workflow === "trip" && !isValidCalendarDay(tripStartDate);
  const tripEndDateRequired = workflow === "trip" && (!isValidCalendarDay(tripEndDate) || tripEndDate < tripStartDate);
  const tripEvidenceInvalid = workflow === "trip" && tripEvidenceId !== "" && !evidenceIds.includes(tripEvidenceId);
  const tripValid =
    !tripPurposeRequired &&
    !tripTravelerRequired &&
    !tripStartDateRequired &&
    !tripEndDateRequired &&
    !tripEvidenceInvalid;
  const parsedInventoryQuantity = Number(inventoryQuantity);
  const inventorySkuRequired = workflow === "quantity_inventory" && inventorySkuId.trim() === "";
  const inventoryQuantityRequired =
    workflow === "quantity_inventory" && (!Number.isFinite(parsedInventoryQuantity) || parsedInventoryQuantity <= 0);
  const inventoryUomRequired = workflow === "quantity_inventory" && inventoryUom.trim() === "";
  const inventoryDirectionRequired = workflow === "quantity_inventory" && inventoryDirection === "";
  const inventoryValid =
    !inventorySkuRequired && !inventoryQuantityRequired && !inventoryUomRequired && !inventoryDirectionRequired;

  const accountName = findCoaAccount(defaultCoaTemplate, accountNumber)?.name ?? accountNumber;
  const submitDisabled =
    !amountsValid ||
    !bookedAtValid ||
    projectRequired ||
    !invoiceValid ||
    !tripValid ||
    !inventoryValid ||
    approveWithEdits.isPending;
  const submitError = approveWithEdits.error ? getErrorMessage(approveWithEdits.error, t("submitError")) : null;

  useEffect(() => {
    registerGlobalTourBlocker("review-edit-sheet", true);
    return () => registerGlobalTourBlocker("review-edit-sheet", false);
  }, []);

  function handleClose() {
    void apiClient
      .attachReviewEnrichmentIntent({ reviewId: review.id, proposals: [{ kind: "noop" }] })
      .finally(onClose);
  }

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
    const trimmedProjectId = projectId.trim();
    const proposal:
      | Extract<
          EnrichmentProposal,
          { kind: "project_assignment" | "invoice_registration" | "trip_registration" | "quantity_inventory_movement" }
        >
      | undefined =
      workflow === "project" && trimmedProjectId !== ""
        ? {
            kind: "project_assignment",
            projectId: trimmedProjectId,
            ...(activityCode.trim() !== "" ? { activityCode: activityCode.trim() } : {}),
            ...(objectCode.trim() !== "" ? { objectCode: objectCode.trim() } : {}),
          }
        : workflow === "invoice" && invoiceDirection !== ""
          ? {
              kind: "invoice_registration",
              direction: invoiceDirection,
              counterparty: invoiceCounterparty.trim(),
              dueDate: invoiceDueDate,
            }
          : workflow === "trip"
            ? {
                kind: "trip_registration",
                purpose: tripPurpose.trim(),
                traveler: tripTraveler.trim(),
                startDate: tripStartDate,
                endDate: tripEndDate,
                ...(tripEvidenceId !== "" ? { evidenceId: tripEvidenceId } : {}),
              }
            : workflow === "quantity_inventory" &&
                inventorySkuId.trim() !== "" &&
                parsedInventoryQuantity > 0 &&
                inventoryUom.trim() !== "" &&
                inventoryDirection !== ""
              ? {
                  kind: "quantity_inventory_movement",
                  skuId: inventorySkuId.trim(),
                  quantity: parsedInventoryQuantity,
                  uom: inventoryUom.trim(),
                  direction: inventoryDirection,
                }
              : undefined;
    approveWithEdits.mutate({ edited, ...(proposal ? { proposal } : {}) });
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/35 p-3 backdrop-blur-sm sm:items-center">
      <button
        type="button"
        aria-label={t("closeAria")}
        data-testid="review-edit-backdrop"
        className="absolute inset-0 cursor-default"
        onClick={handleClose}
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
            onClick={handleClose}
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
            <div className="sm:col-span-2">
              <label htmlFor="review-edit-workflow" className="text-eyebrow block">
                {t("workflowLabel")}
              </label>
              <select
                id="review-edit-workflow"
                data-testid="edit-workflow"
                value={workflow}
                onChange={(event) =>
                  setWorkflow(event.target.value as "none" | "project" | "invoice" | "trip" | "quantity_inventory")
                }
                className="glass-panel-inset mt-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
              >
                <option value="none">{t("workflowNone")}</option>
                <option value="project">{t("workflowProject")}</option>
                <option value="invoice">{t("workflowInvoice")}</option>
                <option value="trip">{t("workflowTrip")}</option>
                <option value="quantity_inventory">{t("workflowQuantityInventory")}</option>
              </select>
            </div>
            {workflow === "project" ? (
              <>
                <div className="sm:col-span-2">
                  <label htmlFor="review-edit-project-id" className="text-eyebrow block">
                    {t("project.idLabel")}
                  </label>
                  <input
                    id="review-edit-project-id"
                    data-testid="edit-project-id"
                    value={projectId}
                    onChange={(event) => setProjectId(event.target.value)}
                    aria-invalid={projectRequired}
                    aria-describedby={projectRequired ? "project-required-error" : undefined}
                    className="glass-panel-inset mt-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
                  />
                  {projectRequired ? (
                    <p
                      id="project-required-error"
                      data-testid="project-required-error"
                      className="mt-1 text-sm text-danger"
                    >
                      {t("project.required")}
                    </p>
                  ) : null}
                </div>
                <div>
                  <label htmlFor="review-edit-activity-code" className="text-eyebrow block">
                    {t("project.activityCodeLabel")}
                  </label>
                  <input
                    id="review-edit-activity-code"
                    value={activityCode}
                    onChange={(event) => setActivityCode(event.target.value)}
                    className="glass-panel-inset mt-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="review-edit-object-code" className="text-eyebrow block">
                    {t("project.objectCodeLabel")}
                  </label>
                  <input
                    id="review-edit-object-code"
                    value={objectCode}
                    onChange={(event) => setObjectCode(event.target.value)}
                    className="glass-panel-inset mt-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
                  />
                </div>
              </>
            ) : null}
            {workflow === "invoice" ? (
              <>
                <div>
                  <label htmlFor="review-edit-invoice-direction" className="text-eyebrow block">
                    {t("invoice.directionLabel")}
                  </label>
                  <select
                    id="review-edit-invoice-direction"
                    data-testid="invoice-direction"
                    value={invoiceDirection}
                    onChange={(event) => setInvoiceDirection(event.target.value as "" | "ar" | "ap")}
                    aria-invalid={invoiceDirectionRequired}
                    aria-describedby={invoiceDirectionRequired ? "invoice-direction-error" : undefined}
                    className="glass-panel-inset mt-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
                  >
                    <option value="">{t("invoice.directionPlaceholder")}</option>
                    <option value="ar">{t("invoice.directionAr")}</option>
                    <option value="ap">{t("invoice.directionAp")}</option>
                  </select>
                  {invoiceDirectionRequired ? (
                    <p
                      id="invoice-direction-error"
                      data-testid="invoice-direction-error"
                      className="mt-1 text-sm text-danger"
                    >
                      {t("invoice.directionRequired")}
                    </p>
                  ) : null}
                </div>
                <div>
                  <label htmlFor="review-edit-invoice-counterparty" className="text-eyebrow block">
                    {t("invoice.counterpartyLabel")}
                  </label>
                  <input
                    id="review-edit-invoice-counterparty"
                    data-testid="invoice-counterparty"
                    value={invoiceCounterparty}
                    onChange={(event) => setInvoiceCounterparty(event.target.value)}
                    aria-invalid={invoiceCounterpartyRequired}
                    aria-describedby={invoiceCounterpartyRequired ? "invoice-counterparty-error" : undefined}
                    className="glass-panel-inset mt-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
                  />
                  {invoiceCounterpartyRequired ? (
                    <p
                      id="invoice-counterparty-error"
                      data-testid="invoice-counterparty-error"
                      className="mt-1 text-sm text-danger"
                    >
                      {t("invoice.counterpartyRequired")}
                    </p>
                  ) : null}
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="review-edit-invoice-due-date" className="text-eyebrow block">
                    {t("invoice.dueDateLabel")}
                  </label>
                  <input
                    id="review-edit-invoice-due-date"
                    data-testid="invoice-due-date"
                    type="date"
                    value={invoiceDueDate}
                    onChange={(event) => setInvoiceDueDate(event.target.value)}
                    aria-invalid={invoiceDueDateRequired}
                    aria-describedby={invoiceDueDateRequired ? "invoice-due-date-error" : undefined}
                    className="glass-panel-inset mt-2 w-full rounded-lg px-3 py-2 text-sm tabular-nums outline-none"
                  />
                  {invoiceDueDateRequired ? (
                    <p
                      id="invoice-due-date-error"
                      data-testid="invoice-due-date-error"
                      className="mt-1 text-sm text-danger"
                    >
                      {t("invoice.dueDateRequired")}
                    </p>
                  ) : null}
                </div>
              </>
            ) : null}
            {workflow === "trip" ? (
              <>
                <div className="sm:col-span-2">
                  <label htmlFor="review-edit-trip-purpose" className="text-eyebrow block">
                    {t("trip.purposeLabel")}
                  </label>
                  <input
                    id="review-edit-trip-purpose"
                    data-testid="trip-purpose"
                    value={tripPurpose}
                    onChange={(event) => setTripPurpose(event.target.value)}
                    aria-invalid={tripPurposeRequired}
                    aria-describedby={tripPurposeRequired ? "trip-purpose-error" : undefined}
                    className="glass-panel-inset mt-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
                  />
                  {tripPurposeRequired ? (
                    <p id="trip-purpose-error" className="mt-1 text-sm text-danger">
                      {t("trip.purposeRequired")}
                    </p>
                  ) : null}
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="review-edit-trip-traveler" className="text-eyebrow block">
                    {t("trip.travelerLabel")}
                  </label>
                  <input
                    id="review-edit-trip-traveler"
                    data-testid="trip-traveler"
                    value={tripTraveler}
                    onChange={(event) => setTripTraveler(event.target.value)}
                    aria-invalid={tripTravelerRequired}
                    aria-describedby={tripTravelerRequired ? "trip-traveler-error" : undefined}
                    className="glass-panel-inset mt-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
                  />
                  {tripTravelerRequired ? (
                    <p id="trip-traveler-error" className="mt-1 text-sm text-danger">
                      {t("trip.travelerRequired")}
                    </p>
                  ) : null}
                </div>
                <div>
                  <label htmlFor="review-edit-trip-start-date" className="text-eyebrow block">
                    {t("trip.startDateLabel")}
                  </label>
                  <input
                    id="review-edit-trip-start-date"
                    data-testid="trip-start-date"
                    type="date"
                    value={tripStartDate}
                    onChange={(event) => setTripStartDate(event.target.value)}
                    aria-invalid={tripStartDateRequired}
                    aria-describedby={tripStartDateRequired ? "trip-start-date-error" : undefined}
                    className="glass-panel-inset mt-2 w-full rounded-lg px-3 py-2 text-sm tabular-nums outline-none"
                  />
                  {tripStartDateRequired ? (
                    <p id="trip-start-date-error" className="mt-1 text-sm text-danger">
                      {t("trip.startDateRequired")}
                    </p>
                  ) : null}
                </div>
                <div>
                  <label htmlFor="review-edit-trip-end-date" className="text-eyebrow block">
                    {t("trip.endDateLabel")}
                  </label>
                  <input
                    id="review-edit-trip-end-date"
                    data-testid="trip-end-date"
                    type="date"
                    min={tripStartDate || undefined}
                    value={tripEndDate}
                    onChange={(event) => setTripEndDate(event.target.value)}
                    aria-invalid={tripEndDateRequired}
                    aria-describedby={tripEndDateRequired ? "trip-end-date-error" : undefined}
                    className="glass-panel-inset mt-2 w-full rounded-lg px-3 py-2 text-sm tabular-nums outline-none"
                  />
                  {tripEndDateRequired ? (
                    <p id="trip-end-date-error" className="mt-1 text-sm text-danger">
                      {t("trip.endDateRequired")}
                    </p>
                  ) : null}
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="review-edit-trip-evidence" className="text-eyebrow block">
                    {t("trip.evidenceLabel")}
                  </label>
                  <select
                    id="review-edit-trip-evidence"
                    data-testid="trip-evidence"
                    value={tripEvidenceId}
                    onChange={(event) => setTripEvidenceId(event.target.value)}
                    aria-invalid={tripEvidenceInvalid}
                    aria-describedby={tripEvidenceInvalid ? "trip-evidence-error" : undefined}
                    className="glass-panel-inset mt-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
                  >
                    <option value="">{t("trip.evidenceNone")}</option>
                    {evidenceIds.map((evidenceId) => (
                      <option key={evidenceId} value={evidenceId}>
                        {evidenceId}
                      </option>
                    ))}
                  </select>
                  {tripEvidenceInvalid ? (
                    <p id="trip-evidence-error" className="mt-1 text-sm text-danger">
                      {t("trip.evidenceInvalid")}
                    </p>
                  ) : null}
                </div>
              </>
            ) : null}
            {workflow === "quantity_inventory" ? (
              <>
                <div className="sm:col-span-2">
                  <label htmlFor="review-edit-inventory-sku" className="text-eyebrow block">
                    {t("inventory.skuLabel")}
                  </label>
                  <input
                    id="review-edit-inventory-sku"
                    data-testid="inventory-sku"
                    value={inventorySkuId}
                    onChange={(event) => setInventorySkuId(event.target.value)}
                    aria-invalid={inventorySkuRequired}
                    aria-describedby={inventorySkuRequired ? "inventory-sku-error" : undefined}
                    className="glass-panel-inset mt-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
                  />
                  {inventorySkuRequired ? (
                    <p id="inventory-sku-error" data-testid="inventory-sku-error" className="mt-1 text-sm text-danger">
                      {t("inventory.skuRequired")}
                    </p>
                  ) : null}
                </div>
                <div>
                  <label htmlFor="review-edit-inventory-quantity" className="text-eyebrow block">
                    {t("inventory.quantityLabel")}
                  </label>
                  <input
                    id="review-edit-inventory-quantity"
                    data-testid="inventory-quantity"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={inventoryQuantity}
                    onChange={(event) => setInventoryQuantity(event.target.value)}
                    aria-invalid={inventoryQuantityRequired}
                    aria-describedby={inventoryQuantityRequired ? "inventory-quantity-error" : undefined}
                    className="glass-panel-inset mt-2 w-full rounded-lg px-3 py-2 text-sm tabular-nums outline-none"
                  />
                  {inventoryQuantityRequired ? (
                    <p
                      id="inventory-quantity-error"
                      data-testid="inventory-quantity-error"
                      className="mt-1 text-sm text-danger"
                    >
                      {t("inventory.quantityRequired")}
                    </p>
                  ) : null}
                </div>
                <div>
                  <label htmlFor="review-edit-inventory-uom" className="text-eyebrow block">
                    {t("inventory.uomLabel")}
                  </label>
                  <input
                    id="review-edit-inventory-uom"
                    data-testid="inventory-uom"
                    value={inventoryUom}
                    onChange={(event) => setInventoryUom(event.target.value)}
                    aria-invalid={inventoryUomRequired}
                    aria-describedby={inventoryUomRequired ? "inventory-uom-error" : undefined}
                    className="glass-panel-inset mt-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
                  />
                  {inventoryUomRequired ? (
                    <p id="inventory-uom-error" data-testid="inventory-uom-error" className="mt-1 text-sm text-danger">
                      {t("inventory.uomRequired")}
                    </p>
                  ) : null}
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="review-edit-inventory-direction" className="text-eyebrow block">
                    {t("inventory.directionLabel")}
                  </label>
                  <select
                    id="review-edit-inventory-direction"
                    data-testid="inventory-direction"
                    value={inventoryDirection}
                    onChange={(event) => setInventoryDirection(event.target.value as "" | "in" | "out")}
                    aria-invalid={inventoryDirectionRequired}
                    aria-describedby={inventoryDirectionRequired ? "inventory-direction-error" : undefined}
                    className="glass-panel-inset mt-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
                  >
                    <option value="">{t("inventory.directionPlaceholder")}</option>
                    <option value="in">{t("inventory.directionIn")}</option>
                    <option value="out">{t("inventory.directionOut")}</option>
                  </select>
                  {inventoryDirectionRequired ? (
                    <p
                      id="inventory-direction-error"
                      data-testid="inventory-direction-error"
                      className="mt-1 text-sm text-danger"
                    >
                      {t("inventory.directionRequired")}
                    </p>
                  ) : null}
                </div>
              </>
            ) : null}
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

          {!amountsValid || invoiceAmountInvalid ? (
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
            <Button type="button" variant="ghost" onClick={handleClose}>
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
