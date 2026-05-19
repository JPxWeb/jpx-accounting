import type { AccountBalanceProjection, JournalEntryProjection, VatProjection } from "@jpx-accounting/contracts";

import { ACCOUNT_INPUT_VAT } from "./bas";
import type { LedgerLine } from "./ledger-line";

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

export function buildVat(lines: LedgerLine[]): VatProjection[] {
  const map = new Map<string, VatProjection>();

  for (const line of lines) {
    const current = map.get(line.vatCode) ?? {
      vatCode: line.vatCode,
      baseAmount: 0,
      vatAmount: 0,
      deductible: line.deductible,
    };

    current.baseAmount += line.debit || line.credit;
    if (line.accountNumber === ACCOUNT_INPUT_VAT) {
      current.vatAmount += line.debit - line.credit;
    }
    map.set(line.vatCode, current);
  }

  return [...map.values()];
}
