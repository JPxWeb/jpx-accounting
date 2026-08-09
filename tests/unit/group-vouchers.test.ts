// tests/unit/group-vouchers.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { groupJournalByVoucher } from "../../apps/web/lib/ledger/group-vouchers.ts";

test("groupJournalByVoucher clusters lines by voucherId preserving line order", () => {
  const groups = groupJournalByVoucher([
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
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.voucherId, "v1");
  assert.equal(groups[0]?.lines.length, 2);
  assert.equal(groups[0]?.totalDebit, 100);
  assert.equal(groups[0]?.totalCredit, 100);
});
