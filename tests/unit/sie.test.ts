import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { CompanySettings, JournalEntryProjection } from "@jpx-accounting/contracts";
import {
  buildSieExport,
  decodePc8,
  decodeSieBuffer,
  encodePc8,
  MemoryLedgerStore,
  parseSie,
  planSieImport,
  SieImportError,
} from "@jpx-accounting/domain";

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
  organizationId: "org_golden",
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
  assert.deepEqual(result, { accepted: true, importedVouchers: 2, importedTransactions: 5, skipped: [] });

  const journalAfter = (await store.getReports()).journal;
  assert.equal(journalAfter.length, journalBefore + 5);
  assert.deepEqual(
    journalAfter.slice(-5).map((entry) => [entry.accountNumber, entry.debit, entry.credit]),
    goldenJournal.map((entry) => [entry.accountNumber, entry.debit, entry.credit]),
  );
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
