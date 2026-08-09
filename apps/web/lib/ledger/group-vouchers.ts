// apps/web/lib/ledger/group-vouchers.ts
import type { JournalEntryProjection } from "@jpx-accounting/contracts";

export type VoucherJournalGroup = {
  voucherId: string;
  bookedAt: string;
  lines: JournalEntryProjection[];
  totalDebit: number;
  totalCredit: number;
};

export function groupJournalByVoucher(entries: JournalEntryProjection[]): VoucherJournalGroup[] {
  const map = new Map<string, VoucherJournalGroup>();
  for (const entry of entries) {
    const existing = map.get(entry.voucherId);
    if (existing) {
      existing.lines.push(entry);
      existing.totalDebit += entry.debit;
      existing.totalCredit += entry.credit;
    } else {
      map.set(entry.voucherId, {
        voucherId: entry.voucherId,
        bookedAt: entry.bookedAt,
        lines: [entry],
        totalDebit: entry.debit,
        totalCredit: entry.credit,
      });
    }
  }
  return [...map.values()].sort(
    (a, b) => a.bookedAt.localeCompare(b.bookedAt) || a.voucherId.localeCompare(b.voucherId),
  );
}
