import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { CompanySettings, JournalEntryProjection } from "@jpx-accounting/contracts";
import { sieImportResultSchema } from "@jpx-accounting/contracts";
import {
  buildSieExport,
  decodePc8,
  decodeSieBuffer,
  encodePc8,
  parseSie,
  sieDecodeWarnings,
} from "@jpx-accounting/domain";
import {
  MemoryLedgerStore,
  planSieImport,
  SieImportError,
  SIE_IMPORT_MAX_RESULT_WARNINGS,
  summarizeSieWarnings,
} from "@jpx-accounting/domain/store";

const fixtureBytes = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../fixtures/sie/${name}`, import.meta.url)));

// Fixed golden inputs — MUST stay in sync with the mint script that produced
// tests/fixtures/sie/golden-export.se (byte equality is asserted below).
const goldenJournal: JournalEntryProjection[] = [
  {
    id: "journal_1",
    voucherId: "voucher_a",
    accountNumber: "6540",
    accountName: "IT-tjänster",
    description: "Programvara mars",
    debit: 1000,
    credit: 0,
    bookedAt: "2026-03-05T10:00:00.000Z",
  },
  {
    id: "journal_2",
    voucherId: "voucher_a",
    accountNumber: "2641",
    accountName: "Debiterad ingående moms",
    description: "Programvara mars",
    debit: 250,
    credit: 0,
    bookedAt: "2026-03-05T10:00:00.000Z",
  },
  {
    id: "journal_3",
    voucherId: "voucher_a",
    accountNumber: "1930",
    accountName: "Företagskonto",
    description: "Programvara mars",
    debit: 0,
    credit: 1250,
    bookedAt: "2026-03-05T10:00:00.000Z",
  },
  {
    id: "journal_4",
    voucherId: "voucher_b",
    accountNumber: "6110",
    accountName: "Kontorsmateriel",
    description: 'Pärmar och "kvitton"',
    debit: 200,
    credit: 0,
    bookedAt: "2026-03-12T10:00:00.000Z",
  },
  {
    id: "journal_5",
    voucherId: "voucher_b",
    accountNumber: "1930",
    accountName: "Företagskonto",
    description: 'Pärmar och "kvitton"',
    debit: 0,
    credit: 200,
    bookedAt: "2026-03-12T10:00:00.000Z",
  },
];

const goldenSettings: CompanySettings = {
  organizationName: "Guldexport AB",
  organizationNumber: "556677-8899",
  addressLine1: "Kungsgatan 1",
  postalCode: "111 22",
  city: "Stockholm",
  contactEmail: "golden@example.com",
  profile: { country: "SE", locale: "sv-SE", currency: "SEK", fiscalYearStart: "01-01", vatPeriod: "quarterly" },
  aiPosture: { advisorEnabled: true, suggestionsEnabled: true },
};

const goldenGeneratedAt = "2026-07-04T12:00:00.000Z";

test("PC8 encode/decode are inverse over the Swedish subset; unmappable chars degrade honestly", () => {
  const text = 'Räksmörgås ÅÄÖ éÉ üÜ #VER "quoted"';
  assert.equal(decodePc8(encodePc8(text)), text);

  // The CP437 map itself, pinned byte-for-byte (independent of the fixtures).
  assert.deepEqual([...encodePc8("åäöÅÄÖéÉüÜ")], [0x86, 0x84, 0x94, 0x8f, 0x8e, 0x99, 0x82, 0x90, 0x81, 0x9a]);

  assert.deepEqual([...encodePc8("€")], [0x3f], "unmappable encodes as '?'");
  assert.equal(decodePc8(new Uint8Array([0x41, 0xff])), "A�", "unmapped high byte decodes as U+FFFD");
});

test("CP437 map covers æ/Æ; an unmapped high byte (e.g. ø/Ø, no CP437 slot here) triggers a decode warning", () => {
  assert.deepEqual([...encodePc8("æÆ")], [0x91, 0x92]);
  assert.equal(decodePc8(encodePc8("æÆ")), "æÆ");

  // Export side of the same gap: ø/Ø have no CP437 slot, so they degrade to
  // '?' on the way out (the documented unmappable convention).
  assert.deepEqual([...encodePc8("øØ")], [0x3f, 0x3f], "ø/Ø have no CP437 slot — exported as '?'");

  assert.deepEqual(sieDecodeWarnings("clean text, no replacement chars"), []);

  // 0xd8 is outside this subset's map — a stand-in for ø/Ø, which have no
  // CP437 slot here (readiness G11).
  const decoded = decodePc8(new Uint8Array([0x42, 0xd8, 0x6a, 0x6f, 0x72, 0x6e]));
  assert.equal(decoded, "B�jorn");
  const warnings = sieDecodeWarnings(decoded);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /1 character/);
  // The warning must name the affected text — "review manually" is useless
  // without pointing at the line to review.
  assert.match(warnings[0]!, /B�jorn/);
});

test("decodeSieBuffer: strict UTF-8 first, CP437 subset on failure", () => {
  const sample = '#FNAMN "Fikabröd & Kaffe AB"';
  assert.equal(decodeSieBuffer(new TextEncoder().encode(sample)), sample, "valid UTF-8 wins");
  assert.equal(decodeSieBuffer(encodePc8(sample)), sample, "CP437 bytes fall through to the PC8 map");
});

test("minimal-4i fixture: CP437 bytes decode and parse with åäö intact", () => {
  const parsed = parseSie(decodeSieBuffer(fixtureBytes("minimal-4i.se")));

  assert.equal(parsed.sieType, "4");
  assert.equal(parsed.orgNumber, "556011-2233");
  assert.equal(parsed.companyName, "Fikabröd & Kaffe AB");
  assert.equal(parsed.accounts["1930"], "Företagskonto");
  assert.equal(parsed.accounts["6110"], "Kontorsmateriel åäö ÅÄÖ");

  assert.equal(parsed.vouchers.length, 2);
  const [first, second] = parsed.vouchers;
  assert.equal(first?.series, "A");
  assert.equal(first?.number, "1");
  assert.equal(first?.date, "2026-03-15");
  assert.equal(first?.text, "Inköp kontorsmaterial");
  assert.deepEqual(
    first?.transactions.map((transaction) => [transaction.account, transaction.amount]),
    [
      ["6110", 100],
      ["2641", 25],
      ["1930", -125],
    ],
  );
  assert.deepEqual(
    second?.transactions.map((transaction) => [transaction.account, transaction.amount]),
    [
      ["6110", 50],
      ["1930", -49],
    ],
  );
});

test("golden export: serializer output is byte-identical to the fixture and parses back", () => {
  const text = buildSieExport({ journal: goldenJournal, settings: goldenSettings, generatedAt: goldenGeneratedAt });

  // Pinned header lines (api.spec asserts the #PROGRAM line verbatim too).
  assert.ok(text.includes('#PROGRAM "JPX Accounting" "0.1.0"'));
  assert.ok(text.includes("#FORMAT PC8"));
  assert.ok(text.includes("#SIETYP 4"));
  assert.ok(text.includes("#RAR 0 20260101 20261231"));

  assert.deepEqual([...encodePc8(text)], [...fixtureBytes("golden-export.se")], "byte-identical golden export");

  // Other direction: the golden bytes parse back into the same economics.
  const parsed = parseSie(decodeSieBuffer(fixtureBytes("golden-export.se")));
  assert.equal(parsed.orgNumber, "556677-8899");
  assert.equal(parsed.companyName, "Guldexport AB");
  assert.equal(parsed.vouchers.length, 2);
  assert.deepEqual(
    parsed.vouchers[0]?.transactions.map((transaction) => [transaction.account, transaction.amount]),
    [
      ["6540", 1000],
      ["2641", 250],
      ["1930", -1250],
    ],
  );
  assert.equal(parsed.vouchers[1]?.text, 'Pärmar och "kvitton"', "escaped quotes survive the round trip");
});

test("escaping: quotes and backslashes survive serialize → parse", () => {
  const description = 'Text med "citat" och \\bakstreck\\';
  const journal: JournalEntryProjection[] = [
    {
      id: "j1",
      voucherId: "v1",
      accountNumber: "9999",
      accountName: 'Konto "citat" \\ namn',
      description,
      debit: 10,
      credit: 0,
      bookedAt: "2026-05-01T00:00:00.000Z",
    },
    {
      id: "j2",
      voucherId: "v1",
      accountNumber: "1930",
      accountName: "Företagskonto",
      description,
      debit: 0,
      credit: 10,
      bookedAt: "2026-05-01T00:00:00.000Z",
    },
  ];
  const parsed = parseSie(buildSieExport({ journal, settings: null, generatedAt: goldenGeneratedAt }));
  assert.equal(parsed.vouchers[0]?.text, description);
  assert.equal(parsed.accounts["9999"], 'Konto "citat" \\ namn');
});

test("full round-trip: export → parse → importSie reproduces the journal economics", async () => {
  const store = new MemoryLedgerStore();
  const journalBefore = (await store.getReports()).journal.length;

  const text = buildSieExport({ journal: goldenJournal, settings: null, generatedAt: goldenGeneratedAt });
  const result = await store.importSie({ actorId: "user_test", file: parseSie(text) });
  // `warnings: []` is load-bearing: our own export must parse back without a
  // single non-fatal note (D3).
  assert.deepEqual(result, {
    accepted: true,
    importedVouchers: 2,
    importedTransactions: 5,
    skipped: [],
    warnings: [],
  });

  const journalAfter = (await store.getReports()).journal;
  assert.equal(journalAfter.length, journalBefore + 5);
  assert.deepEqual(
    journalAfter.slice(-5).map((entry) => [entry.accountNumber, entry.debit, entry.credit]),
    goldenJournal.map((entry) => [entry.accountNumber, entry.debit, entry.credit]),
  );

  // KFR Phase D / Task 1 (readiness G3): every accepted voucher materializes an
  // already-posted Voucher row keyed by its `sie_<series>_<number>` aggregate id,
  // so imported history is attachable and shows its real series+number.
  const snapshot = await store.getSnapshot();
  const firstImportedVoucher = snapshot.vouchers.find((voucher) => voucher.id === "sie_A_1");
  assert.equal(firstImportedVoucher?.voucherNumber, "A 1");
  assert.equal(firstImportedVoucher?.origin, "import");
  assert.equal(firstImportedVoucher?.status, "posted");
  assert.equal(firstImportedVoucher?.evidencePacketId, null);
  assert.equal(snapshot.vouchers.filter((voucher) => voucher.origin === "import").length, 2);

  // Re-import is idempotent on the ROW too: no duplicate/updated voucher rows.
  const replay = await store.importSie({ actorId: "user_test", file: parseSie(text) });
  assert.equal(replay.importedVouchers, 0);
  const replaySnapshot = await store.getSnapshot();
  assert.deepEqual(replaySnapshot.vouchers, snapshot.vouchers);
});

test("per-voucher isolation: unbalanced voucher skipped, balanced one imported (minimal fixture)", async () => {
  const store = new MemoryLedgerStore();
  const parsed = parseSie(decodeSieBuffer(fixtureBytes("minimal-4i.se")));
  const result = await store.importSie({ actorId: "user_test", file: parsed });

  assert.equal(result.accepted, true);
  assert.equal(result.importedVouchers, 1);
  assert.equal(result.importedTransactions, 3);
  assert.deepEqual(result.skipped, [{ reference: "A 2", reason: "unbalanced" }]);

  // Account names resolve #KONTO → CoA registry → `Konto <nr>` in that order.
  const journal = (await store.getReports()).journal;
  const imported = journal.slice(-3);
  assert.equal(imported[0]?.accountName, "Kontorsmateriel åäö ÅÄÖ", "name from the file's #KONTO");
  assert.equal(imported[1]?.accountName, "Debiterad ingående moms", "name from the CoA registry");
  assert.equal(imported[0]?.description, "Inköp kontorsmaterial");
  assert.equal(imported[0]?.bookedAt, "2026-03-15");
});

test("parseSie: bare #TRANS outside #VER is ignored with a warning (old placeholder shape)", () => {
  const parsed = parseSie("#FLAGGA 0\n#TRANS 1930 {} -100\n#TRANS 6540 {} 100");
  assert.equal(parsed.vouchers.length, 0);
  assert.ok(parsed.warnings.some((warning) => warning.includes("#TRANS")));
});

test("parseSie: non-zero #IB warns (opening balances aren't imported this version); zero #IB is silent", () => {
  const withBalance = parseSie('#IB 0 1930 15000.50\n#VER A 1 20260101 "x"\n{\n#TRANS 1930 {} 0\n}');
  assert.ok(
    withBalance.warnings.some((warning) => warning.includes("#IB") && warning.includes("1930")),
    "non-zero #IB must warn",
  );

  const zeroBalance = parseSie("#IB 0 1930 0.00");
  assert.ok(!zeroBalance.warnings.some((warning) => warning.includes("#IB")), "a zero #IB is not worth warning about");

  // The shape a first-fiscal-year export from the incumbent actually has: an
  // #IB row per account in the chart, all zero. It must import in total silence
  // — one warning per chart account would bury every real signal.
  const kapitasLike = parseSie(
    [
      "#FLAGGA 0",
      "#SIETYP 4",
      '#FNAMN "JPx Demo AB"',
      "#RAR 0 20260101 20261231",
      '#KONTO 1930 "Företagskonto"',
      '#KONTO 2440 "Leverantörsskulder"',
      "#IB 0 1930 0.00",
      "#IB 0 2440 0",
      "#IB 0 3011 -0.00",
      '#VER A 1 20260115 "Första verifikatet"',
      "{",
      "#TRANS 6110 {} 250.00",
      "#TRANS 1930 {} -250.00",
      "}",
      "#UB 0 1930 -250.00",
    ].join("\n"),
  );
  assert.deepEqual(kapitasLike.warnings, [], "a zero-opening-balance FY1 export must import silently");
  assert.equal(kapitasLike.vouchers.length, 1);
});

test("importSie threads parse warnings into the result and they survive the wire round-trip", async () => {
  const store = new MemoryLedgerStore();
  const file = parseSie(
    [
      "#IB 0 1930 15000.50",
      '#VER A 9 20260401 "Kaffe"',
      "{",
      "#TRANS 5810 {} 100.00",
      "#TRANS 1930 {} -100.00",
      "}",
    ].join("\n"),
  );

  const result = await store.importSie({ file });
  assert.equal(result.importedVouchers, 1, "the voucher still imports — an #IB warning is never fatal");
  assert.ok(
    result.warnings.some((warning) => warning.includes("#IB") && warning.includes("1930")),
    "the parse warning must reach the import result",
  );

  // What the browser actually receives: JSON over the wire, re-parsed by the
  // api-client through this very schema (demo fallback returns the same object).
  const overTheWire = sieImportResultSchema.parse(JSON.parse(JSON.stringify(result)));
  assert.deepEqual(overTheWire.warnings, result.warnings);

  // #IB is recognized to WARN only — no opening balance is ever booked.
  const journal = (await store.getReports()).journal;
  assert.equal(
    journal.filter((entry) => entry.debit === 15000.5 || entry.credit === 15000.5).length,
    0,
    "opening balances are not imported",
  );
});

test("decode-confidence warning reaches ParsedSieFile.warnings for a real garbled buffer", () => {
  const garbled = new Uint8Array([0x23, 0x46, 0x4e, 0x41, 0x4d, 0x4e, 0x20, 0xd8]); // "#FNAMN " + an unmapped byte
  const text = decodeSieBuffer(garbled);
  const parsed = parseSie(text);
  const merged = [...sieDecodeWarnings(text), ...parsed.warnings];
  assert.ok(merged.some((warning) => warning.includes("could not be decoded")));
});

test("summarizeSieWarnings caps the threaded warnings so a junk file can't return an unbounded payload", () => {
  const under = Array.from({ length: SIE_IMPORT_MAX_RESULT_WARNINGS }, (_, index) => `w${index}`);
  assert.deepEqual(summarizeSieWarnings(under), under, "under the cap the list passes through verbatim");

  const over = Array.from({ length: SIE_IMPORT_MAX_RESULT_WARNINGS + 7 }, (_, index) => `w${index}`);
  const summarized = summarizeSieWarnings(over);
  assert.equal(summarized.length, SIE_IMPORT_MAX_RESULT_WARNINGS + 1);
  assert.equal(summarized.at(-1), "… and 7 more parse warnings (not shown).");
});

test("planSieImport enforces hard bounds via SieImportError", () => {
  const voucher = (n: number) => ({
    series: "A",
    number: String(n),
    date: "2026-01-01",
    text: undefined,
    transactions: [{ account: "1930", amount: 0 }],
  });
  const tooManyVouchers = {
    accounts: {},
    vouchers: Array.from({ length: 501 }, (_, index) => voucher(index + 1)),
    warnings: [],
  };
  assert.throws(() => planSieImport(tooManyVouchers), SieImportError);

  const tooManyLines = {
    accounts: {},
    vouchers: [
      {
        series: "A",
        number: "1",
        date: "2026-01-01",
        text: undefined,
        transactions: Array.from({ length: 101 }, () => ({ account: "1930", amount: 0 })),
      },
    ],
    warnings: [],
  };
  assert.throws(() => planSieImport(tooManyLines), SieImportError);
});
