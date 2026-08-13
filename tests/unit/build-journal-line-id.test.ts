import assert from "node:assert/strict";
import { test } from "node:test";

import { buildJournal, collectLedgerLinesFromEvents, collectPostedEnrichmentTargets } from "@jpx-accounting/domain";

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

test("journal id stays journal_n while replay supplies a legacy lineId", () => {
  const lines = collectLedgerLinesFromEvents([
    { id: "evt_abc", eventType: "PostedToLedger", payload: { lines: [baseLine] } },
  ]);
  const journal = buildJournal(lines);

  assert.equal(journal[0]?.id, "journal_1");
  assert.equal(journal[0]?.lineId, "legacy_evt_abc_0");
});

test("payload lineId wins over projection-only legacy identity", () => {
  const lines = collectLedgerLinesFromEvents([
    { id: "evt_abc", eventType: "PostedToLedger", payload: { lines: [{ ...baseLine, lineId: "ln_1" }] } },
  ]);
  const journal = buildJournal(lines);

  assert.equal(journal[0]?.id, "journal_1");
  assert.equal(journal[0]?.lineId, "ln_1");
});

test("legacy lineId keeps the event-local index when earlier lines precede it", () => {
  const eventLines = [baseLine, { ...baseLine, voucherId: "v2" }, { ...baseLine, voucherId: "v3" }];
  const replayed = collectLedgerLinesFromEvents([
    { id: "evt_multi", eventType: "VoucherImported", payload: { lines: eventLines } },
  ]);
  // Demo seed lines are prepended ahead of replay in MemoryLedgerStore, so the
  // journal-wide index is offset from the event-local one. The identity must
  // follow the event, or a row would claim another line's target id.
  const journal = buildJournal([baseLine, baseLine, ...replayed]);

  assert.deepEqual(
    journal.map((entry) => entry.lineId),
    [undefined, undefined, "legacy_evt_multi_0", "legacy_evt_multi_1", "legacy_evt_multi_2"],
  );
  assert.deepEqual(
    journal.map((entry) => entry.id),
    ["journal_1", "journal_2", "journal_3", "journal_4", "journal_5"],
  );
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

test("journal omits lineId without payload identity or replay context", () => {
  const journal = buildJournal([baseLine]);

  assert.equal(journal[0]?.id, "journal_1");
  assert.equal(journal[0]?.lineId, undefined);
});

test("every projected lineId is a valid posted enrichment target", () => {
  const events = [
    {
      id: "evt_posted",
      aggregateId: "voucher_1",
      eventType: "PostedToLedger" as const,
      payload: { lines: [{ ...baseLine, lineId: "ln_1" }, baseLine] },
    },
    {
      id: "evt_imported",
      aggregateId: "voucher_2",
      eventType: "VoucherImported" as const,
      payload: { lines: [baseLine, { ...baseLine, voucherId: "v2" }, { ...baseLine, voucherId: "v3" }] },
    },
  ];
  const journal = buildJournal([baseLine, ...collectLedgerLinesFromEvents(events)]);
  const { postedLineIds } = collectPostedEnrichmentTargets(events);

  const projected = journal.map((entry) => entry.lineId).filter((lineId) => lineId !== undefined);
  assert.equal(projected.length, 5);
  assert.equal(new Set(projected).size, projected.length, "projected line ids are unique");
  for (const lineId of projected) {
    assert.ok(postedLineIds.has(lineId), `projected lineId ${lineId} must be a posted target`);
  }
});

test("journal surfaces VAT code and deductibility from posting lines", () => {
  const journal = buildJournal([{ ...baseLine, lineId: "ln_1", deductible: false }]);

  assert.equal(journal[0]?.vatCode, "VAT25");
  assert.equal(journal[0]?.deductible, false);
});
