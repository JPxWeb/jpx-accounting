import assert from "node:assert/strict";
import { test } from "node:test";

import { buildJournal } from "@jpx-accounting/domain";

const baseLine = {
  voucherId: "v1",
  accountNumber: "1930",
  accountName: "Bank",
  description: "x",
  debit: 0,
  credit: 1,
  vatCode: "VAT25",
  bookedAt: "2026-03-01T00:00:00.000Z",
  deductible: true,
};

test("journal id stays journal_n while event context supplies a legacy lineId", () => {
  const journal = buildJournal([baseLine], {
    eventIdByLineIndex: new Map([[0, "evt_abc"]]),
  });

  assert.equal(journal[0]?.id, "journal_1");
  assert.equal(journal[0]?.lineId, "legacy_evt_abc_0");
});

test("payload lineId wins over projection-only legacy identity", () => {
  const journal = buildJournal([{ ...baseLine, lineId: "ln_1" }], {
    eventIdByLineIndex: new Map([[0, "evt_abc"]]),
  });

  assert.equal(journal[0]?.id, "journal_1");
  assert.equal(journal[0]?.lineId, "ln_1");
});

test("journal omits lineId without payload identity or event context", () => {
  const journal = buildJournal([baseLine]);

  assert.equal(journal[0]?.id, "journal_1");
  assert.equal(journal[0]?.lineId, undefined);
});

test("journal surfaces VAT code and deductibility from posting lines", () => {
  const journal = buildJournal([{ ...baseLine, lineId: "ln_1", deductible: false }]);

  assert.equal(journal[0]?.vatCode, "VAT25");
  assert.equal(journal[0]?.deductible, false);
});
