import type {
  AccountBalanceProjection,
  JournalEntryProjection,
  LedgerEvent,
  VatProjection,
} from "@jpx-accounting/contracts";

import type { VatRegime } from "./vat/regime";
import { swedishVatRegime } from "./vat/regime";

export type LedgerLine = {
  voucherId: string;
  accountNumber: string;
  accountName: string;
  description: string;
  debit: number;
  credit: number;
  vatCode: string;
  bookedAt: string;
  deductible: boolean;
};

/** Event types whose payloads carry journal `lines` for report replay. */
export const LINE_CARRYING_EVENT_TYPES = ["PostedToLedger", "VoucherImported"] as const;

const LINE_CARRYING_EVENT_TYPE_SET: ReadonlySet<string> = new Set(LINE_CARRYING_EVENT_TYPES);

/**
 * Rebuild ledger lines from append-only event payloads (PostedToLedger +
 * VoucherImported). Memory prepends frozen demo seed separately; Postgres
 * does not.
 */
export function collectLedgerLinesFromEvents(events: Array<Pick<LedgerEvent, "eventType" | "payload">>): LedgerLine[] {
  const lines: LedgerLine[] = [];
  for (const event of events) {
    if (!LINE_CARRYING_EVENT_TYPE_SET.has(event.eventType)) continue;
    const payloadLines = (event.payload as { lines?: unknown }).lines;
    if (Array.isArray(payloadLines)) {
      for (const line of payloadLines as LedgerLine[]) lines.push(line);
    }
  }
  return lines;
}

/**
 * Filter ledger lines to an inclusive day window. Comparisons are string-based
 * on `bookedAt.slice(0, 10)` (booked timestamps are ISO strings), matching the
 * unified period model's local-calendar day grammar. No range (or an empty
 * one) returns the input array unchanged.
 */
export function filterLedgerLines(lines: LedgerLine[], range?: { from?: string; to?: string }): LedgerLine[] {
  if (!range || (range.from === undefined && range.to === undefined)) return lines;
  return lines.filter((line) => {
    const day = line.bookedAt.slice(0, 10);
    if (range.from !== undefined && day < range.from) return false;
    if (range.to !== undefined && day > range.to) return false;
    return true;
  });
}

export function buildJournal(lines: LedgerLine[]): JournalEntryProjection[] {
  return lines.map((line, index) => ({
    id: `journal_${index + 1}`,
    voucherId: line.voucherId,
    accountNumber: line.accountNumber,
    accountName: line.accountName,
    description: line.description,
    debit: line.debit,
    credit: line.credit,
    bookedAt: line.bookedAt,
  }));
}

export function buildBalances(lines: LedgerLine[]): AccountBalanceProjection[] {
  const map = new Map<string, AccountBalanceProjection>();

  for (const line of lines) {
    const current = map.get(line.accountNumber) ?? {
      accountNumber: line.accountNumber,
      accountName: line.accountName,
      debit: 0,
      credit: 0,
      balance: 0,
    };

    current.debit += line.debit;
    current.credit += line.credit;
    current.balance = current.debit - current.credit;
    map.set(line.accountNumber, current);
  }

  return [...map.values()].sort((left, right) => left.accountNumber.localeCompare(right.accountNumber));
}

/**
 * Öre-exact VAT movement per vatCode (the declaration-boundary rounding lives
 * only in `buildVatReturnBoxes`).
 *
 * KFR Phase C (G1): reverse-charge output VAT (2614) is a real VAT account —
 * before this it matched no list at all, so an EU-service purchase projected
 * as a plain input claim and hid the self-assessed liability that cancels it.
 * Both reverse-charge legs carry the SAME vatCode ("RC25"), which makes RC the
 * one direction pair that always lands in a single projection entry: booking
 * the liability by `debit − credit` nets a fully deducted RC purchase to 0 and
 * leaves a book-without-vat one at −250, i.e. VAT genuinely owed. Domestic
 * output VAT (2610/2620/2630) keeps its legacy credit-positive sign — pinned
 * by the regression tests in tests/unit/vat-regime.test.ts.
 */
export function buildVat(lines: LedgerLine[], regime: VatRegime = swedishVatRegime): VatProjection[] {
  const outputAccounts = new Set(Object.values(regime.accounts.outputByRate));
  const reverseChargeOutputAccounts = new Set<string>(Object.values(regime.accounts.reverseChargeOutputByRate));
  const map = new Map<string, VatProjection>();

  for (const line of lines) {
    const current = map.get(line.vatCode) ?? {
      vatCode: line.vatCode,
      baseAmount: 0,
      vatAmount: 0,
      deductible: line.deductible,
    };

    current.baseAmount += line.debit || line.credit;
    // Input VAT and the reverse-charge liability both move by debit − credit:
    // a claim adds, the self-assessed liability that offsets it subtracts.
    const isInputVat = regime.accounts.input.includes(line.accountNumber);
    const isReverseChargeOutputVat = reverseChargeOutputAccounts.has(line.accountNumber);
    if (isInputVat || isReverseChargeOutputVat) {
      current.vatAmount += line.debit - line.credit;
    } else if (outputAccounts.has(line.accountNumber)) {
      current.vatAmount += line.credit - line.debit;
    }
    map.set(line.vatCode, current);
  }

  return [...map.values()];
}
