import type { CompanySettings, JournalEntryProjection } from "@jpx-accounting/contracts";

import { defaultCoaTemplate, findCoaAccount } from "../coa/registry";
import type { CoaTemplate } from "../coa/types";
import { ALL_PERIOD_FROM, ALL_PERIOD_TO } from "../reports/period";
import { round2 } from "../store-shared";

/**
 * SIE 4 export serializer (advisory pivot Phase 3, Task 3.4). Emission order
 * is pinned by the plan and by tests/e2e/api.spec.ts (the `#PROGRAM` line is
 * asserted byte-identical): `#FLAGGA` · `#PROGRAM` · `#FORMAT PC8` · `#GEN` ·
 * `#SIETYP 4` · `#ORGNR`/`#FNAMN` (when settings exist) · `#RAR 0` ·
 * `#KONTO` per distinct account · `#IB`/`#UB` (balance accounts 1–2) ·
 * `#RES` (result accounts 3–8) — all three period-scoped exports only ·
 * `#VER` blocks grouped by voucher.
 *
 * Output is a JS string; callers encode with `encodePc8` before writing bytes.
 */

export type SieExportInput = {
  journal: JournalEntryProjection[];
  settings?: CompanySettings | null | undefined;
  /** ISO timestamp the export was generated at — drives `#GEN` and the `#RAR 0` window. */
  generatedAt: string;
  coa?: CoaTemplate;
  /**
   * Period-scoped export (Phase D, Task 7): #VER blocks are limited to
   * entries whose bookedAt falls in [range.from, range.to]. #RAR 0 declares
   * the FISCAL YEAR containing this window, not the window itself (I-2b).
   * Omitted = full-history export (unchanged).
   */
  range?: { from: string; to: string };
  /** Per-account signed (debit positive) balance as of range.from, exclusive. Emits `#IB 0`. */
  openingBalances?: Record<string, number>;
  /** Per-account balance at range.to, inclusive. Emits `#UB 0`. */
  closingBalances?: Record<string, number>;
  /** Per-account in-range movement for BAS result accounts (3xxx-8xxx). Emits `#RES 0`. */
  results?: Record<string, number>;
};

/**
 * SIE 4 account classes. `#IB`/`#UB` are opening/closing balances of BALANCE
 * accounts (BAS classes 1–2); `#RES` is the period saldo of RESULT accounts
 * (classes 3–8). Emitting one account under both labels is redundant at best
 * and double-counted (or rejected) by a receiving tool at worst — the two
 * predicates below are what keeps the emission disjoint (fix wave I-2a).
 */
function isBalanceAccount(accountNumber: string): boolean {
  const firstDigit = accountNumber.charAt(0);
  return firstDigit >= "1" && firstDigit <= "2";
}

function isResultAccount(accountNumber: string): boolean {
  const firstDigit = accountNumber.charAt(0);
  return firstDigit >= "3" && firstDigit <= "8";
}

/**
 * Compute opening/closing/result balances for a period-scoped export (Phase
 * D, Task 7) from the FULL (unfiltered) journal — `journal` here must NOT be
 * pre-filtered by range, since opening balances need everything before it.
 */
export function computeSieBalances(
  journal: JournalEntryProjection[],
  range: { from: string; to: string },
): {
  openingBalances: Record<string, number>;
  closingBalances: Record<string, number>;
  results: Record<string, number>;
} {
  const opening: Record<string, number> = {};
  const movement: Record<string, number> = {};
  const results: Record<string, number> = {};

  for (const entry of journal) {
    const day = entry.bookedAt.slice(0, 10);
    const signed = entry.debit - entry.credit;
    if (day < range.from) {
      opening[entry.accountNumber] = round2((opening[entry.accountNumber] ?? 0) + signed);
    } else if (day <= range.to) {
      movement[entry.accountNumber] = round2((movement[entry.accountNumber] ?? 0) + signed);
      if (isResultAccount(entry.accountNumber)) {
        results[entry.accountNumber] = round2((results[entry.accountNumber] ?? 0) + signed);
      }
    }
  }

  const closing: Record<string, number> = { ...opening };
  for (const [account, delta] of Object.entries(movement)) {
    closing[account] = round2((closing[account] ?? 0) + delta);
  }

  return { openingBalances: opening, closingBalances: closing, results };
}

/** Quote + escape a SIE text field (`\` and `"` escaped, per the SIE quoting rules). */
function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** `YYYY-MM-DD…` → `YYYYMMDD`. */
function compactDay(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, "");
}

/**
 * Current fiscal-year window (`#RAR 0`) containing `generatedAt`, derived
 * from the workspace profile's `MM-DD` fiscal year start.
 */
function fiscalYearWindow(
  generatedAt: string,
  fiscalYearStart: string,
  firstFiscalYearStart?: string,
): { start: string; end: string } {
  const day = generatedAt.slice(0, 10);
  const year = Number(day.slice(0, 4));
  const startThisYear = `${year}-${fiscalYearStart}`;
  const start = day >= startThisYear ? startThisYear : `${year - 1}-${fiscalYearStart}`;
  const [startYear, startMonth, startDay] = start.split("-").map(Number) as [number, number, number];
  const endDate = new Date(Date.UTC(startYear + 1, startMonth - 1, startDay));
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  const end = endDate.toISOString().slice(0, 10);
  // Phase D, Task 6: the earliest fiscal year floors to firstFiscalYearStart
  // when set — same clamp as resolvePeriodToken's fy-/ytd windows, including
  // its `floor <= to` guard so a floor past the window never inverts #RAR 0.
  const clampedStart =
    firstFiscalYearStart !== undefined && start < firstFiscalYearStart && firstFiscalYearStart <= end
      ? firstFiscalYearStart
      : start;
  return { start: clampedStart, end };
}

/**
 * True for the `all` token's sentinel window (`resolvePeriodToken`). It spans
 * a century, so no fiscal year contains it — such an export declares the
 * fiscal year containing `generatedAt`, exactly like a full-history export.
 */
function isAllPeriodRange(range: { from: string; to: string }): boolean {
  return range.from <= ALL_PERIOD_FROM && range.to >= ALL_PERIOD_TO;
}

export function buildSieExport({
  journal,
  settings,
  generatedAt,
  coa = defaultCoaTemplate,
  range,
  openingBalances,
  closingBalances,
  results,
}: SieExportInput): string {
  const lines: string[] = [];

  lines.push("#FLAGGA 0");
  // Byte-identical — pinned by tests/e2e/api.spec.ts. Do not reformat.
  lines.push('#PROGRAM "JPX Accounting" "0.1.0"');
  lines.push("#FORMAT PC8");
  lines.push(`#GEN ${compactDay(generatedAt)}`);
  lines.push("#SIETYP 4");
  if (settings?.organizationNumber) lines.push(`#ORGNR ${settings.organizationNumber}`);
  if (settings?.organizationName) lines.push(`#FNAMN ${quote(settings.organizationName)}`);

  // #RAR 0 always declares a FISCAL YEAR (SIE 4), never the requested window:
  // a `?period=2026-03` export is one month OF a fiscal year, not a one-month
  // fiscal year, and `?period=all` is certainly not a 1900–2999 one (I-2b).
  // Anchor the window on the range START — the fiscal year containing it —
  // and fall back to `generatedAt` for full-history exports and for the `all`
  // sentinel range, which spans no single year. An `fy-` token needs no
  // special case: `resolvePeriodToken`'s fiscal-year window and the anchored
  // window here are the same window, including the firstFiscalYearStart clamp.
  const fiscalAnchor = range && !isAllPeriodRange(range) ? range.from : generatedAt;
  const { start, end } = fiscalYearWindow(
    fiscalAnchor,
    settings?.profile.fiscalYearStart ?? "01-01",
    settings?.profile.firstFiscalYearStart,
  );
  lines.push(`#RAR 0 ${compactDay(start)} ${compactDay(end)}`);

  // #KONTO per distinct account, sorted by number for a deterministic export.
  const accountNames = new Map<string, string>();
  for (const entry of journal) {
    if (!accountNames.has(entry.accountNumber)) {
      accountNames.set(
        entry.accountNumber,
        entry.accountName || (findCoaAccount(coa, entry.accountNumber)?.name ?? `Konto ${entry.accountNumber}`),
      );
    }
  }
  for (const number of [...accountNames.keys()].sort()) {
    lines.push(`#KONTO ${number} ${quote(accountNames.get(number)!)}`);
  }

  // Balance blocks (period-scoped exports only — absent maps emit nothing, so
  // the full-history export stays byte-identical). Sorted by account for a
  // deterministic file; a zero balance carries no information and is dropped.
  const emitBalances = (
    label: "IB" | "UB" | "RES",
    balances: Record<string, number> | undefined,
    belongsToLabel: (accountNumber: string) => boolean,
  ) => {
    if (!balances) return;
    for (const account of Object.keys(balances).sort()) {
      // I-2a: an account only ever appears under the label its CLASS owns.
      if (!belongsToLabel(account)) continue;
      const amount = balances[account]!;
      if (Math.abs(amount) < 0.005) continue;
      lines.push(`#${label} 0 ${account} ${amount.toFixed(2)}`);
    }
  };
  emitBalances("IB", openingBalances, isBalanceAccount);
  emitBalances("UB", closingBalances, isBalanceAccount);
  emitBalances("RES", results, isResultAccount);

  // #VER emission is range-scoped; #KONTO above deliberately is not, so an
  // account that only carries an opening balance still gets a name.
  const scopedJournal = range
    ? journal.filter((entry) => {
        const day = entry.bookedAt.slice(0, 10);
        return day >= range.from && day <= range.to;
      })
    : journal;

  // Vouchers grouped by voucherId in first-seen order; sequential #VER numbers.
  const groups = new Map<string, JournalEntryProjection[]>();
  for (const entry of scopedJournal) {
    const group = groups.get(entry.voucherId);
    if (group) {
      group.push(entry);
    } else {
      groups.set(entry.voucherId, [entry]);
    }
  }

  let verNumber = 0;
  for (const entries of groups.values()) {
    verNumber += 1;
    const first = entries[0]!;
    lines.push(`#VER A ${verNumber} ${compactDay(first.bookedAt)} ${quote(first.description)}`);
    lines.push("{");
    for (const entry of entries) {
      // SIE amount convention: debit positive, credit negative; dot-decimal 2dp.
      lines.push(`#TRANS ${entry.accountNumber} {} ${(entry.debit - entry.credit).toFixed(2)}`);
    }
    lines.push("}");
  }

  return `${lines.join("\n")}\n`;
}
