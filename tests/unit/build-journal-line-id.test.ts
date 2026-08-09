import assert from "node:assert/strict";
import { test } from "node:test";

import { buildJournal, collectLedgerLinesFromEvents } from "@jpx-accounting/domain";

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

test("event replay supplies event-local legacy lineId without rewriting payloads", () => {
  const firstPayload = { lines: [baseLine] };
  const secondPayload = { lines: [{ ...baseLine, voucherId: "v2" }] };
  const lines = collectLedgerLinesFromEvents([
    { id: "evt_first", eventType: "PostedToLedger", payload: firstPayload },
    { id: "evt_second", eventType: "VoucherImported", payload: secondPayload },
  ]);

  assert.deepEqual(
    buildJournal(lines).map((entry) => entry.lineId),
    ["legacy_evt_first_0", "legacy_evt_second_0"],
  );
  assert.equal(Object.hasOwn(firstPayload.lines[0]!, "lineId"), false);
  assert.equal(Object.hasOwn(secondPayload.lines[0]!, "lineId"), false);
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
