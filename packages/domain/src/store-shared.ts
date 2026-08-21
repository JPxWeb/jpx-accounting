import type {
  AccountingSuggestion,
  ExtractedField,
  ManualVoucherLine,
  ReviewDecisionEdit,
  Voucher,
  VoucherField,
} from "@jpx-accounting/contracts";

import { classifyAccountNumber, defaultCoaTemplate, findCoaAccount } from "./coa/registry";
import type { CoaTemplate } from "./coa/types";
import { deriveVoucherFields } from "./evidence-defaults";
import { assertBalancedPosting, assertOreExactLines, isOreExact } from "./posting-invariants";
import type { LedgerLine } from "./projections";
import { getVatRegime, type VatRegime } from "./vat/regime";

/**
 * Shared store helpers used by both `store.ts` (MemoryLedgerStore) and
 * `store-planning.ts` (pure planners). Lives outside `store.ts` so planners
 * do not create a store ↔ store-planning import cycle.
 */

export type ReviewAction = "approve" | "reject" | "book-without-vat";
/**
 * Thrown when a review decision carries an `edited` payload that fails the
 * amount-consistency validation. Mapped to HTTP 422 in `app.onError`
 * (CONVENTIONS Rule 16). Thrown before any mutation, so a rejected edit
 * leaves the store untouched.
 */
export class InvalidReviewEditError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid review edit: ${issues.join(" ")}`);
    this.name = "InvalidReviewEditError";
    this.issues = issues;
  }
}
/**
 * Thrown when a manual voucher's lines fail the exact-öre balance check
 * inside `planManualVoucher` (the wire schema only enforces ±0.005 —
 * legitimate float noise, not a real imbalance). Client-correctable, so
 * this is a 422 like `InvalidReviewEditError`, never the catch-all 500
 * `UnbalancedPostingError` uses for internal invariant violations.
 */
export class InvalidManualVoucherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidManualVoucherError";
  }
}
/**
 * VAT codes a reviewer may select on an edited decision (WS-B B5): the
 * regime's rate vocabulary (VAT25/VAT12/VAT6/VAT0 for Sweden), the
 * VAT-neutral "NA", and "RC25" (KFR D3 EU reverse charge — the code that
 * selects `buildPostingLines`' 4-line rc25 shape). "VAT-REVIEW" is
 * deliberately NOT selectable — it is the system's blocked-marker, never a
 * posting choice.
 */
export function validEditVatCodes(regime: VatRegime): ReadonlySet<string> {
  return new Set([...Object.keys(regime.rates), "NA", "RC25"]);
}

/**
 * Validate a decision-time edit and derive the effective posting inputs.
 * Append-only by construction: the returned `effectiveVoucher` /
 * `effectiveSuggestion` are decision-time derivations for `buildPostingLines`
 * and the review read model — the stored voucher row is never rewritten.
 * Shared by MemoryLedgerStore and PostgresLedgerStore (CONVENTIONS Rule 11).
 *
 * WS-B B5 validation: `edited.accountNumber` must exist in the CoA registry,
 * `edited.vatCode` must be in the VAT regime vocabulary, and the effective
 * accountName is SERVER-RESOLVED from the registry — any client-supplied
 * `edited.accountName` is ignored so display names cannot be forged into the
 * ledger. Invalid values throw `InvalidReviewEditError` (→ HTTP 422) BEFORE
 * any mutation, in both stores.
 *
 * KFR D3: an optional `edited.settlementAccountNumber` is validated against the
 * same registry and returned as `effectiveSettlementAccountNumber` for callers
 * to thread into `buildPostingLines` (absent = `coa.roles.bank`).
 */
export function resolveReviewDecisionEdit(
  voucher: Voucher,
  suggestion: AccountingSuggestion | undefined,
  edited: ReviewDecisionEdit,
  coa: CoaTemplate = defaultCoaTemplate,
): {
  effectiveSuggestion: AccountingSuggestion | undefined;
  effectiveVoucher: Voucher;
  effectiveSettlementAccountNumber: string | undefined;
} {
  const issues: string[] = [];
  const registryAccount = findCoaAccount(coa, edited.accountNumber);
  if (!registryAccount) {
    issues.push(`Edited accountNumber (${edited.accountNumber}) does not exist in the ${coa.id} chart of accounts.`);
  }
  const vatVocabulary = validEditVatCodes(getVatRegime(coa.country));
  if (!vatVocabulary.has(edited.vatCode)) {
    issues.push(
      `Edited vatCode (${edited.vatCode}) is not in the VAT regime vocabulary (${[...vatVocabulary].join(", ")}).`,
    );
  }
  // KFR D3: an edited settlement account (2899 utlägg, 1630 skattekonto, …
  // instead of the default 1930 bank) must be a real CoA entry — same
  // rigor as accountNumber above.
  if (edited.settlementAccountNumber !== undefined && !findCoaAccount(coa, edited.settlementAccountNumber)) {
    issues.push(
      `Edited settlementAccountNumber (${edited.settlementAccountNumber}) does not exist in the ${coa.id} chart of accounts.`,
    );
  }
  const anyAmountGiven =
    edited.grossAmount !== undefined || edited.netAmount !== undefined || edited.vatAmount !== undefined;
  if (anyAmountGiven) {
    if (edited.grossAmount === undefined || edited.netAmount === undefined || edited.vatAmount === undefined) {
      issues.push("Amount edits must provide grossAmount, netAmount, and vatAmount together.");
    } else {
      // Sub-öre amounts would sail through the sum check and then blow the
      // öre-exact assertBalanced invariant MID-mutation (500, and a
      // half-applied decision in the memory store) — reject them here, 422,
      // before anything mutates.
      for (const [name, value] of [
        ["grossAmount", edited.grossAmount],
        ["netAmount", edited.netAmount],
        ["vatAmount", edited.vatAmount],
      ] as const) {
        if (!isOreExact(value)) {
          issues.push(`Edited ${name} (${value}) must be öre-exact (at most two decimals).`);
        }
      }
      if (Math.abs(edited.netAmount + edited.vatAmount - edited.grossAmount) > 0.01) {
        issues.push(
          `Edited amounts do not add up: net (${edited.netAmount}) + VAT (${edited.vatAmount}) must equal gross (${edited.grossAmount}) within 0.01.`,
        );
      }
    }
  }
  if (edited.bookedAt !== undefined) {
    // R13: an explicit accounting-date override must be a real calendar day
    // and must not book into the future. One day of slack absorbs client/server
    // timezone skew (a Stockholm browser is a calendar day ahead of a UTC-hosted
    // API between 00:00 and 02:00 local — its "today" must not 422). Locked/
    // closed-period enforcement is a Later feature — any past day is accepted.
    if (!isValidCalendarDay(edited.bookedAt)) {
      issues.push(`Edited bookedAt (${edited.bookedAt}) must be a valid YYYY-MM-DD calendar day.`);
    } else if (edited.bookedAt > localDayOfTimestamp(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())) {
      issues.push(`Edited bookedAt (${edited.bookedAt}) must not be in the future.`);
    }
  }
  if (issues.length > 0 || !registryAccount) {
    // `!registryAccount` is redundant with the pushed issue but narrows the
    // type: past this point the edited account is a real registry entry.
    throw new InvalidReviewEditError(issues);
  }

  const effectiveSuggestion = suggestion
    ? {
        ...suggestion,
        accountNumber: edited.accountNumber,
        // B5: server-resolved from the registry; edited.accountName is ignored.
        accountName: registryAccount.name,
        vatCode: edited.vatCode,
      }
    : undefined;

  const amountOverrides: Partial<VoucherField> =
    edited.grossAmount !== undefined
      ? { grossAmount: edited.grossAmount, netAmount: edited.netAmount, vatAmount: edited.vatAmount }
      : {};
  // R13: thread an edited accounting date into the effective voucher's
  // transactionDate — the first candidate `deriveBookedAt` consults inside
  // `buildPostingLines` — so the override reaches the posted lines through the
  // ONE shared derivation path in both stores. Decision-time only: the stored
  // voucher row is never rewritten, and the ReviewApproved event payload
  // records `edited.bookedAt` for the audit trail.
  const bookedAtOverride: Partial<VoucherField> =
    edited.bookedAt !== undefined ? { transactionDate: edited.bookedAt } : {};
  const effectiveVoucher: Voucher = {
    ...voucher,
    voucherFields: { ...voucher.voucherFields, ...amountOverrides, ...bookedAtOverride },
  };

  return { effectiveSuggestion, effectiveVoucher, effectiveSettlementAccountNumber: edited.settlementAccountNumber };
}
/**
 * Deferred-auth demo sentinel (WS-C R5, CONVENTIONS Rule 20 adjacency): when a
 * mutating store call arrives without a server-derived `actorId` (auth off —
 * demo mode and the browser-side fallback store), events attribute to this
 * fixed founder identity. With auth on, the API threads the verified JWT
 * subject as `user:<sub>` instead. Client-supplied actor ids were deleted from
 * the wire contracts and can never reach a store.
 */
export const DEMO_ACTOR_ID = "user_founder";

/**
 * Draft-voucher display sentinel (KFR Phase E / readiness doc G8): every planner
 * that creates a NEW Voucher row (capture intake, manual entry) assigns this
 * literal instead of computing a `V-<n>` — the real number is assigned only
 * once the voucher actually POSTS (approve or book-without-vat), inside
 * `planReviewDecision`. A rejected review never posts, so its voucher keeps
 * this sentinel forever: rejected drafts no longer burn V- numbers.
 * SIE-imported vouchers never pass through this path at all (`importSie`
 * assigns its own "<series> <number>" display directly) so there is no
 * interaction with that numbering scheme.
 */
export const DRAFT_VOUCHER_NUMBER = "Utkast";

/**
 * True for voucher/review statuses that correspond to an actual PostedToLedger
 * event, i.e. the ones that consumed a `V-<n>` from the workspace sequence.
 *
 * Deliberately NOT `"posted"`: an SIE-imported voucher arrives already booked
 * with `origin: "import"`, `status: "posted"` and its own "<series> <number>"
 * display, never a `V-<n>`. Excluding it here is what keeps the native V-
 * sequence dense and stable — importing a fiscal year of history must not
 * shift the next captured voucher's number.
 */
export function isPostedVoucherStatus(status: Voucher["status"]): boolean {
  return status === "approved" || status === "booked-without-vat";
}

/**
 * Server-derived actor threading for mutating store methods. Optional: absent
 * means "no authenticated subject" and stores default to `DEMO_ACTOR_ID`.
 * Never populated from a client payload.
 */
export type ActorAttribution = { actorId?: string | undefined };

/**
 * Server-derived approval policy for review decisions (Wave D′ / P1-1).
 * Optional: absent / false keeps demo's legacy byte-identical behavior
 * (blockedReason is advisory only). Normal mode threads
 * `enforceBlockedReason: true` from the API — never from a client payload.
 */
export type ApprovalGate = { enforceBlockedReason?: boolean | undefined };

/**
 * Thrown when normal mode refuses to approve a review that still carries
 * `blockedReason`. Mapped to HTTP 409 `{ code: "review_blocked" }` in
 * `app.onError`. Reject and book-without-vat remain available.
 */
export class ReviewBlockedError extends Error {
  readonly code = "review_blocked" as const;

  constructor(readonly blockedReason: string) {
    super(`Review is blocked: ${blockedReason}`);
    this.name = "ReviewBlockedError";
  }
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
/** Strict calendar-day string (`YYYY-MM-DD`) — the only shape `deriveBookedAt` accepts. */
const DAY_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True iff `value` is a strict `YYYY-MM-DD` string naming a REAL calendar day.
 * `Date.parse` is not enough: engines roll impossible days over (2026-02-31 →
 * March 3), so components are round-tripped through `Date.UTC` and compared.
 */
export function isValidCalendarDay(value: string): boolean {
  if (!DAY_ONLY_PATTERN.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  return roundTrip.getUTCFullYear() === year && roundTrip.getUTCMonth() === month - 1 && roundTrip.getUTCDate() === day;
}

/**
 * LOCAL calendar day (`YYYY-MM-DD`) of an ISO timestamp. Never
 * `toISOString().slice(0, 10)` — that serialises in UTC and crosses the day
 * boundary in any non-UTC timezone (period-model rule; CONVENTIONS Rule 22).
 * Throws on unparseable input (Rule 12 NaN guard).
 */
export function localDayOfTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`unparseable timestamp ${JSON.stringify(iso)}`);
  }
  const pad2 = (value: number) => String(value).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
}

/**
 * Accounting-date derivation for posted ledger lines (WS-B R13). Postings are
 * dated by the voucher's business-event date — `transactionDate`, falling back
 * to `receiptDate` — NOT by when the reviewer clicked approve, so entries land
 * in the correct fiscal/VAT period. The decision-time `occurredAt` timestamp is
 * only the fallback (as its LOCAL calendar day) when the voucher carries no
 * usable date. Candidates are ignored unless they are strict `YYYY-MM-DD`,
 * parseable, and not after the decision day (future-dated extraction noise
 * must not book into an open future period).
 *
 * Owned by domain and consumed inside `buildPostingLines` so MemoryLedgerStore
 * and PostgresLedgerStore inherit identical derivation (CONVENTIONS Rule 11 —
 * store parity by construction). The `PostedToLedger` event keeps its own
 * `occurredAt` (decision time); only the LINES carry the accounting date.
 */
export function deriveBookedAt(
  fields: Pick<VoucherField, "transactionDate" | "receiptDate"> | undefined,
  occurredAt: string,
): string {
  const decisionDay = localDayOfTimestamp(occurredAt);
  for (const candidate of [fields?.transactionDate, fields?.receiptDate]) {
    if (candidate === undefined) continue;
    if (!isValidCalendarDay(candidate)) continue;
    if (candidate > decisionDay) continue;
    return candidate;
  }
  return decisionDay;
}

/** KFR D3 shape selection: RC25 wins outright; otherwise direction (explicit or inferred from account class) picks expense vs. revenue. */
function resolvePostingShape(suggestion: AccountingSuggestion, coa: CoaTemplate): "expense" | "rc25" | "revenue" {
  if (suggestion.vatCode === "RC25") return "rc25";
  const direction =
    suggestion.direction ??
    (classifyAccountNumber(suggestion.accountNumber, coa) === "revenue" ? "revenue" : "expense");
  return direction === "revenue" ? "revenue" : "expense";
}

/**
 * Build the journal lines for a reviewed voucher (KFR D3). Three shapes:
 *
 * - `expense` (default): cost debit + input-VAT debit + settlement credit.
 * - `rc25`: EU reverse charge — cost debit, 2645 input-VAT debit, 2614
 *   output-VAT credit, settlement credit of the NET price only.
 * - `revenue`: settlement debit + revenue credit, no VAT line.
 *
 * `options.settlementAccountNumber` replaces the default `coa.roles.bank` credit
 * (2899 utlägg, 1630 skattekonto, …); it is validated in
 * `resolveReviewDecisionEdit` before it ever reaches here. Every shape returns
 * through `assertBalancedPosting`, so an öre-unbalanced entry can never be
 * appended.
 */
export function buildPostingLines(
  voucher: Voucher,
  suggestion: AccountingSuggestion,
  action: "approve" | "book-without-vat",
  occurredAt: string,
  coa: CoaTemplate = defaultCoaTemplate,
  options?: { settlementAccountNumber?: string },
): LedgerLine[] {
  const fields = voucher.voucherFields;
  // R13: lines carry the ACCOUNTING date (voucher transaction/receipt date,
  // decision-day fallback), not the approval-click timestamp. An edited
  // bookedAt arrives here via resolveReviewDecisionEdit, which threads it into
  // the effective voucher's transactionDate.
  const bookedAt = deriveBookedAt(fields, occurredAt);
  const description = fields.description ?? "Reviewed voucher";
  const settlementAccountNumber = options?.settlementAccountNumber ?? coa.roles.bank;
  const settlementAccountName = findCoaAccount(coa, settlementAccountNumber)?.name ?? settlementAccountNumber;
  const shape = resolvePostingShape(suggestion, coa);

  if (shape === "revenue") {
    // D3(c): VAT0/export revenue — debit settlement, credit revenue, no VAT
    // line. Output VAT on domestic sales is not modelled here (KFR Phase B
    // scope: the revenue shape exists for the VAT-free export case).
    const amount = fields.grossAmount ?? fields.netAmount ?? 0;
    const lines: LedgerLine[] = [
      {
        voucherId: voucher.id,
        accountNumber: settlementAccountNumber,
        accountName: settlementAccountName,
        description,
        debit: amount,
        credit: 0,
        vatCode: "NA",
        bookedAt,
        deductible: false,
      },
      {
        voucherId: voucher.id,
        accountNumber: suggestion.accountNumber,
        accountName: suggestion.accountName,
        description,
        debit: 0,
        credit: amount,
        vatCode: suggestion.vatCode,
        bookedAt,
        deductible: false,
      },
    ];
    return assertBalancedPosting(lines, `voucher ${voucher.id}`);
  }

  if (shape === "rc25") {
    // D3(b): EU reverse-charge service purchase. The foreign supplier never
    // charges Swedish VAT, so the settlement leg only ever carries the NET
    // price and the VAT nets to zero cash impact. Unlike the expense shape,
    // the self-assessed OUTPUT liability is not a deduction the reviewer may
    // decline: book-without-vat drops only the 2645 input claim (folding the
    // undeducted VAT into the cost, Swedish practice) while 2614 still carries
    // the full liability. The VAT is round2'd once here so every leg is
    // öre-exact and Σdebit = Σcredit holds for any extracted triple.
    const declaredVat = round2(fields.vatAmount ?? 0);
    const invoiceTotal = fields.grossAmount ?? round2((fields.netAmount ?? 0) + declaredVat);
    const netAmount = round2(invoiceTotal - declaredVat);
    const inputAccount = coa.roles.reverseChargeInput;
    const outputAccount = coa.roles.reverseChargeOutput;
    const costDebit = action === "book-without-vat" ? round2(netAmount + declaredVat) : netAmount;
    const inputVatDebit = action === "book-without-vat" ? 0 : declaredVat;
    const lines: LedgerLine[] = [
      {
        voucherId: voucher.id,
        accountNumber: suggestion.accountNumber,
        accountName: suggestion.accountName,
        description,
        debit: costDebit,
        credit: 0,
        vatCode: "RC25",
        bookedAt,
        deductible: action !== "book-without-vat",
      },
      {
        voucherId: voucher.id,
        accountNumber: inputAccount,
        accountName: findCoaAccount(coa, inputAccount)?.name ?? inputAccount,
        description: `${description} VAT (omvänd skattskyldighet)`,
        debit: inputVatDebit,
        credit: 0,
        vatCode: "RC25",
        bookedAt,
        deductible: action !== "book-without-vat",
      },
      {
        voucherId: voucher.id,
        accountNumber: outputAccount,
        accountName: findCoaAccount(coa, outputAccount)?.name ?? outputAccount,
        description: `${description} VAT (omvänd skattskyldighet)`,
        debit: 0,
        credit: declaredVat,
        vatCode: "RC25",
        bookedAt,
        deductible: false,
      },
      {
        voucherId: voucher.id,
        accountNumber: settlementAccountNumber,
        accountName: settlementAccountName,
        description,
        debit: 0,
        credit: netAmount,
        vatCode: "NA",
        bookedAt,
        deductible: false,
      },
    ];
    return assertBalancedPosting(lines, `voucher ${voucher.id}`);
  }

  // shape === "expense": the original 3-line shape, generalized to a
  // configurable settlement account. Byte-identical when `options` is omitted.
  // Non-deductible input VAT (book-without-vat) is part of the cost under
  // Swedish rules: claim 0 VAT and debit the full gross to the cost account.
  const vatAmount = action === "book-without-vat" ? 0 : (fields.vatAmount ?? 0);
  const grossAmount = fields.grossAmount ?? round2((fields.netAmount ?? 0) + vatAmount);
  // Derive net from gross − VAT instead of trusting fields.netAmount: extracted
  // triples can be öre-inconsistent, and resolveReviewDecisionEdit admits a
  // ±0.01 tolerance — deriving is what keeps Σdebit = Σcredit unconditionally.
  const netAmount = round2(grossAmount - vatAmount);
  const inputVatAccount = coa.roles.inputVat;

  const lines: LedgerLine[] = [
    {
      voucherId: voucher.id,
      accountNumber: suggestion.accountNumber,
      accountName: suggestion.accountName,
      description,
      debit: netAmount,
      credit: 0,
      vatCode: suggestion.vatCode,
      bookedAt,
      deductible: action !== "book-without-vat",
    },
    // Zero-amount for book-without-vat, kept for shape stability and so the
    // journal shows the explicit "no VAT claimed" decision. buildVat and box 48
    // read input VAT off this account's amounts, so 0 claims nothing.
    {
      voucherId: voucher.id,
      accountNumber: inputVatAccount,
      accountName: findCoaAccount(coa, inputVatAccount)?.name ?? inputVatAccount,
      description: `${description} VAT`,
      debit: vatAmount,
      credit: 0,
      vatCode: suggestion.vatCode,
      bookedAt,
      deductible: action !== "book-without-vat",
    },
    {
      voucherId: voucher.id,
      accountNumber: settlementAccountNumber,
      accountName: settlementAccountName,
      description,
      debit: 0,
      credit: grossAmount,
      vatCode: "NA",
      bookedAt,
      deductible: false,
    },
  ];
  return assertBalancedPosting(lines, `voucher ${voucher.id}`);
}

/**
 * Post a manual voucher's lines VERBATIM (KFR D2) — no shape inference, no
 * amount derivation. `deductible` is uniformly `false`: Phase B does not
 * infer per-line VAT deductibility for hand-entered lines (same documented
 * limitation `planSieImport` already carries for imported lines).
 *
 * Because the amounts are copied rather than derived, BOTH posting invariants
 * are asserted here: öre-exactness per line and Σdebit === Σcredit. Balance
 * alone is not enough — `postingImbalanceOre` compares integer öre, so a
 * sub-öre amount reads as balanced and would then be stored verbatim.
 * `planManualVoucher` already rejects such input at creation time (as a 422),
 * but this is the posting boundary: any other writer that ever reaches
 * `suggestion.lines` is caught here too.
 */
export function buildManualPostingLines(
  voucher: Voucher,
  lines: ManualVoucherLine[],
  occurredAt: string,
  coa: CoaTemplate = defaultCoaTemplate,
): LedgerLine[] {
  const bookedAt = deriveBookedAt(voucher.voucherFields, occurredAt);
  const description = voucher.voucherFields.description ?? "Manual entry";
  const context = `manual voucher ${voucher.id}`;
  const posted: LedgerLine[] = lines.map((line) => ({
    voucherId: voucher.id,
    accountNumber: line.accountNumber,
    accountName: findCoaAccount(coa, line.accountNumber)?.name ?? `Konto ${line.accountNumber}`,
    description,
    debit: line.debit,
    credit: line.credit,
    vatCode: line.vatCode,
    bookedAt,
    deductible: false,
  }));
  return assertBalancedPosting(assertOreExactLines(posted, context), context);
}

/**
 * Merge extraction fields by key: refreshed values win, existing keys absent
 * from the refresh are retained (order-stable: existing order first, new keys
 * appended). Shared by MemoryLedgerStore and PostgresLedgerStore so the two
 * stay in lockstep (CONVENTIONS Rule 11).
 */
export function mergeExtractedFields(existing: ExtractedField[], refreshed: ExtractedField[]): ExtractedField[] {
  const refreshedByKey = new Map(refreshed.map((field) => [field.key, field]));
  const merged = existing.map((field) => refreshedByKey.get(field.key) ?? field);
  const existingKeys = new Set(existing.map((field) => field.key));
  for (const field of refreshed) {
    if (!existingKeys.has(field.key)) merged.push(field);
  }
  return merged;
}

/**
 * Recompute voucher-level fields from a merged extraction while preserving the
 * human-facing `description` and `currency` of the current voucher (extraction
 * refreshes must not rename what the user already sees). Shared across stores.
 */
export function recomputeVoucherFields(mergedFields: ExtractedField[], current: VoucherField): VoucherField {
  const derived = deriveVoucherFields(mergedFields, { title: current.description ?? "" });
  return {
    ...derived,
    description: current.description,
    currency: current.currency,
  };
}
