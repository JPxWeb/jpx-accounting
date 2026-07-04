import type { AccountBalanceProjection, JournalEntryProjection, VatProjection } from "@jpx-accounting/contracts";

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

export function buildVat(lines: LedgerLine[], regime: VatRegime = swedishVatRegime): VatProjection[] {
  const outputAccounts = new Set(Object.values(regime.accounts.outputByRate));
  const map = new Map<string, VatProjection>();

  for (const line of lines) {
    const current = map.get(line.vatCode) ?? {
      vatCode: line.vatCode,
      baseAmount: 0,
      vatAmount: 0,
      deductible: line.deductible,
    };

    current.baseAmount += line.debit || line.credit;
    if (regime.accounts.input.includes(line.accountNumber)) {
      current.vatAmount += line.debit - line.credit;
    } else if (outputAccounts.has(line.accountNumber)) {
      current.vatAmount += line.credit - line.debit;
    }
    map.set(line.vatCode, current);
  }

  return [...map.values()];
}
