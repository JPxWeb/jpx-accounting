import assert from "node:assert/strict";
import { test } from "node:test";
import { groupJournalByVoucher } from "../../apps/web/lib/ledger/group-vouchers.ts";

test("groupJournalByVoucher groups interleaved lines and sorts groups deterministically", () => {
  const groups = groupJournalByVoucher([
    {
      id: "journal_3",
      voucherId: "v2",
      accountNumber: "1930",
      accountName: "Bank",
      description: "B",
      debit: 0,
      credit: 50,
      bookedAt: "2026-03-02T10:00:00.000Z",
    },
    {
      id: "journal_1",
      voucherId: "v1",
      accountNumber: "1930",
      accountName: "Bank",
      description: "A",
      debit: 0,
      credit: 100,
      bookedAt: "2026-03-01T10:00:00.000Z",
    },
    {
      id: "journal_2",
      voucherId: "v1",
      accountNumber: "6110",
      accountName: "Office",
      description: "A",
      debit: 100,
      credit: 0,
      bookedAt: "2026-03-01T10:00:00.000Z",
    },
  ]);

  assert.deepEqual(
    groups.map((group) => ({
      voucherId: group.voucherId,
      lineIds: group.lines.map((line) => line.id),
      totalDebit: group.totalDebit,
      totalCredit: group.totalCredit,
    })),
    [
      {
        voucherId: "v1",
        lineIds: ["journal_1", "journal_2"],
        totalDebit: 100,
        totalCredit: 100,
      },
      {
        voucherId: "v2",
        lineIds: ["journal_3"],
        totalDebit: 0,
        totalCredit: 50,
      },
    ],
  );
});
