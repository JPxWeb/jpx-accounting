import type { JournalEntryProjection } from "@jpx-accounting/contracts";

export type VoucherJournalGroup = {
  voucherId: string;
  bookedAt: string;
  lines: JournalEntryProjection[];
  totalDebit: number;
  totalCredit: number;
};

export function groupJournalByVoucher(entries: JournalEntryProjection[]): VoucherJournalGroup[] {
  const groupsByVoucherId = new Map<string, VoucherJournalGroup>();
  for (const entry of entries) {
    const group = groupsByVoucherId.get(entry.voucherId);
    if (group) {
      group.lines.push(entry);
      group.totalDebit += entry.debit;
      group.totalCredit += entry.credit;
    } else {
      groupsByVoucherId.set(entry.voucherId, {
        voucherId: entry.voucherId,
        bookedAt: entry.bookedAt,
        lines: [entry],
        totalDebit: entry.debit,
        totalCredit: entry.credit,
      });
    }
  }
  return [...groupsByVoucherId.values()].sort(
    (a, b) => a.bookedAt.localeCompare(b.bookedAt) || a.voucherId.localeCompare(b.voucherId),
  );
}
