import assert from "node:assert/strict";
import test from "node:test";

import type { AccountingSuggestion, Voucher } from "@jpx-accounting/contracts";
import type { LedgerLine } from "@jpx-accounting/domain";
import {
  assertBalancedPosting,
  buildPostingLines,
  buildVat,
  buildVatReturnBoxes,
  InvalidReviewEditError,
  MemoryLedgerStore,
  planSieImport,
  postingImbalanceOre,
  UnbalancedPostingError,
} from "@jpx-accounting/domain";

/**
 * N3 (risk R1) regression suite: every posting path must produce journal lines
 * where Σdebit === Σcredit to the öre. "Book without VAT" used to post the net
 * to the cost account while crediting the gross — permanently unbalanced by
 * exactly the VAT amount in an append-only ledger.
 */

const voucherFixture = (fields: { grossAmount?: number; netAmount?: number; vatAmount?: number }): Voucher => ({
  id: "v1",
  organizationId: "o",
  workspaceId: "w",
  evidencePacketId: "p",
  voucherNumber: "V-v1",
  status: "needs-review",
  accountingMethod: "invoice",
  extractedFields: [],
  voucherFields: {
    vatRate: 25,
    currency: "SEK",
    description: "Balance test",
    ...fields,
  },
  createdAt: "2026-05-01T00:00:00.000Z",
  createdBy: "u",
});

const suggestionFixture = (): AccountingSuggestion => ({
  id: "s_v1",
  voucherId: "v1",
  accountNumber: "6540",
  accountName: "IT-tjänster",
  vatCode: "VAT25",
  confidence: 0.9,
  reasoning: "r",
  kind: "recommendation",
  citations: [],
  ruleHits: [],
});

const sumOre = (lines: ReadonlyArray<{ debit: number; credit: number }>) => ({
  debit: lines.reduce((sum, line) => sum + Math.round(line.debit * 100), 0),
  credit: lines.reduce((sum, line) => sum + Math.round(line.credit * 100), 0),
});

const assertJournalTailBalanced = (journal: Array<{ debit: number; credit: number }>, count: number) => {
  const tail = journal.slice(-count);
  assert.equal(tail.length, count);
  const { debit, credit } = sumOre(tail);
  assert.equal(debit, credit, `posted lines must balance to the öre (Σdebit ${debit} vs Σcredit ${credit})`);
};

test("assertBalancedPosting passes balanced lines through and throws UnbalancedPostingError otherwise", () => {
  const balanced = [
    { debit: 98.76, credit: 0 },
    { debit: 24.69, credit: 0 },
    { debit: 0, credit: 123.45 },
  ];
  assert.equal(assertBalancedPosting(balanced), balanced, "returns the same array for call-through");

  const unbalanced = [
    { debit: 999.2, credit: 0 },
    { debit: 0, credit: 1249 },
  ];
  assert.throws(
    () => assertBalancedPosting(unbalanced, "voucher v1"),
    (error: unknown) => {
      assert.ok(error instanceof UnbalancedPostingError);
      assert.equal(error.name, "UnbalancedPostingError");
      assert.equal(error.debitTotal, 999.2);
      assert.equal(error.creditTotal, 1249);
      assert.match(error.message, /voucher v1/);
      return true;
    },
  );

  // NaN amounts must never slip through as "balanced".
  assert.throws(
    () => assertBalancedPosting([{ debit: Number.NaN, credit: 0 }]),
    (error: unknown) => error instanceof UnbalancedPostingError,
  );
});

test("buildPostingLines book-without-vat debits the full gross to the cost account and claims zero VAT", () => {
  const lines = buildPostingLines(
    voucherFixture({ grossAmount: 1249, netAmount: 999.2, vatAmount: 249.8 }),
    suggestionFixture(),
    "book-without-vat",
    "2026-05-01T00:00:00.000Z",
  );

  assert.equal(lines.length, 3, "3-line shape stays stable (zero VAT line kept)");
  const [cost, vat, bank] = lines;
  assert.ok(cost && vat && bank);
  assert.equal(cost.accountNumber, "6540");
  assert.equal(cost.debit, 1249, "non-deductible VAT becomes part of the cost: gross on the cost line");
  assert.equal(cost.deductible, false);
  assert.equal(vat.accountNumber, "2641");
  assert.equal(vat.debit, 0, "no input VAT claimed");
  assert.equal(vat.deductible, false);
  assert.equal(bank.credit, 1249);
  assert.equal(postingImbalanceOre(lines), 0);
});

test("buildPostingLines approve keeps the net + VAT split for a consistent triple", () => {
  const lines = buildPostingLines(
    voucherFixture({ grossAmount: 1249, netAmount: 999.2, vatAmount: 249.8 }),
    suggestionFixture(),
    "approve",
    "2026-05-01T00:00:00.000Z",
  );
  const [cost, vat, bank] = lines;
  assert.ok(cost && vat && bank);
  assert.equal(cost.debit, 999.2);
  assert.equal(cost.deductible, true);
  assert.equal(vat.debit, 249.8);
  assert.equal(bank.credit, 1249);
  assert.equal(postingImbalanceOre(lines), 0);
});

test("buildPostingLines derives net from gross − VAT so inconsistent triples still balance", () => {
  // Öre-inconsistent triple: 98.77 + 24.69 = 123.46 ≠ 123.45. Trusting the
  // stated net used to post 1 öre unbalanced; the derived net (98.76) balances.
  const oreDrift = buildPostingLines(
    voucherFixture({ grossAmount: 123.45, netAmount: 98.77, vatAmount: 24.69 }),
    suggestionFixture(),
    "approve",
    "2026-05-01T00:00:00.000Z",
  );
  assert.equal(oreDrift[0]?.debit, 98.76);
  assert.equal(postingImbalanceOre(oreDrift), 0);

  // Grossly inconsistent triple: net is ignored, gross − VAT wins.
  const grossDrift = buildPostingLines(
    voucherFixture({ grossAmount: 500, netAmount: 400, vatAmount: 50 }),
    suggestionFixture(),
    "approve",
    "2026-05-01T00:00:00.000Z",
  );
  assert.equal(grossDrift[0]?.debit, 450);
  assert.equal(postingImbalanceOre(grossDrift), 0);

  // Missing gross: derived from net + VAT instead of collapsing to credit 0.
  const noGross = buildPostingLines(
    voucherFixture({ netAmount: 80, vatAmount: 20 }),
    suggestionFixture(),
    "approve",
    "2026-05-01T00:00:00.000Z",
  );
  assert.equal(noGross[2]?.credit, 100);
  assert.equal(postingImbalanceOre(noGross), 0);
});

test("property sweep: buildPostingLines can never return an unbalanced entry", () => {
  const edgeCases: Array<{ grossAmount?: number; netAmount?: number; vatAmount?: number }> = [
    { grossAmount: 1249, netAmount: 999.2, vatAmount: 249.8 },
    { grossAmount: 123.45, netAmount: 98.76, vatAmount: 24.69 },
    { grossAmount: 123.45, netAmount: 98.77, vatAmount: 24.69 },
    { grossAmount: 0.01, netAmount: 0, vatAmount: 0.01 },
    { grossAmount: 0.03, netAmount: 0.01, vatAmount: 0.01 },
    { grossAmount: 100, netAmount: 0, vatAmount: 100 },
    { grossAmount: 100, netAmount: 100, vatAmount: 100 },
    { grossAmount: 1, netAmount: 0.8, vatAmount: 0.2 },
    { grossAmount: 100 },
    { netAmount: 80, vatAmount: 20 },
    { vatAmount: 25 },
    {},
  ];

  // Deterministic LCG so the sweep is reproducible.
  let seed = 42;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const randomCases = Array.from({ length: 400 }, () => {
    const grossOre = Math.floor(nextRand() * 5_000_000);
    const vatOre = Math.floor(nextRand() * grossOre * 1.2); // sometimes VAT > gross
    const jitterOre = Math.floor(nextRand() * 7) - 3; // öre-inconsistent triples
    const fields: { grossAmount?: number; netAmount?: number; vatAmount?: number } = {
      grossAmount: grossOre / 100,
      netAmount: (grossOre - vatOre + jitterOre) / 100,
      vatAmount: vatOre / 100,
    };
    if (nextRand() < 0.1) delete fields.grossAmount;
    if (nextRand() < 0.1) delete fields.netAmount;
    if (nextRand() < 0.1) delete fields.vatAmount;
    return fields;
  });

  for (const fields of [...edgeCases, ...randomCases]) {
    for (const action of ["approve", "book-without-vat"] as const) {
      const lines = buildPostingLines(voucherFixture(fields), suggestionFixture(), action, "2026-05-01T00:00:00.000Z");
      assert.equal(lines.length, 3);
      assert.equal(
        postingImbalanceOre(lines),
        0,
        `unbalanced entry for ${action} with fields ${JSON.stringify(fields)}`,
      );
    }
  }
});

test("MemoryLedgerStore.applyReviewDecision approve posts a balanced journal entry", async () => {
  const store = new MemoryLedgerStore();
  const [review] = await store.getReviewFeed();
  assert.ok(review?.suggestion);

  await store.applyReviewDecision(review.id, "approve", { actorId: "user_founder" });

  const journal = (await store.getReports()).journal;
  assertJournalTailBalanced(journal, 3);
  const { debit, credit } = sumOre(journal);
  assert.equal(debit, credit, "the whole journal stays balanced");
});

test("MemoryLedgerStore.applyReviewDecision book-without-vat posts gross-on-cost, balanced, with no input VAT claimed", async () => {
  const store = new MemoryLedgerStore();
  const [review] = await store.getReviewFeed();
  assert.ok(review?.suggestion);
  const voucher = (await store.getSnapshot()).vouchers.find((candidate) => candidate.id === review.voucherId);
  assert.equal(voucher?.voucherFields.grossAmount, 1249, "seed precondition");

  const decided = await store.applyReviewDecision(review.id, "book-without-vat", { actorId: "user_founder" });
  assert.equal(decided?.status, "booked-without-vat");

  const journal = (await store.getReports()).journal;
  const [cost, vat, bank] = journal.slice(-3);
  assert.ok(cost && vat && bank);
  assert.equal(cost.debit, 1249, "gross debited to the cost account (VAT is part of the cost)");
  assert.equal(vat.accountNumber, "2641");
  assert.equal(vat.debit, 0);
  assert.equal(bank.credit, 1249);
  assertJournalTailBalanced(journal, 3);

  // VAT projections: the decision must not add claimable input VAT. The seed
  // journal already carries 250 input VAT on 2641; it must stay exactly 250.
  const vatProjection = (await store.getReports()).vat.find((entry) => entry.vatCode === "VAT25");
  assert.equal(vatProjection?.vatAmount, 250, "book-without-vat claims no input VAT in buildVat");

  // Box 48 (Ingående moms att dra av) over just the posted lines must be 0.
  const postedEvt = (await store.getEvents()).find((event) => event.eventType === "PostedToLedger");
  const postedLines = postedEvt?.payload.lines as LedgerLine[];
  assert.ok(Array.isArray(postedLines) && postedLines.length === 3);
  const box48 = buildVatReturnBoxes(postedLines).find((box) => box.box === "48");
  assert.equal(box48?.amount, 0, "non-deductible VAT must not appear in box 48");
  const costVatCode = postedLines[0]?.vatCode;
  assert.ok(costVatCode);
  const vatOfPosted = buildVat(postedLines).find((entry) => entry.vatCode === costVatCode);
  assert.equal(vatOfPosted?.vatAmount, 0, "posted lines carry no claimable input VAT");
  assert.equal(vatOfPosted?.deductible, false);
});

test("MemoryLedgerStore.applyReviewDecision edited approval posts balanced lines (consistent and öre-tolerance inputs)", async () => {
  // Consistent edited triple.
  const store = new MemoryLedgerStore();
  const [review] = await store.getReviewFeed();
  assert.ok(review?.suggestion);
  await store.applyReviewDecision(review.id, "approve", {
    actorId: "user_founder",
    edited: {
      accountNumber: "6110",
      accountName: "Kontorsmateriel",
      vatCode: "VAT25",
      grossAmount: 500,
      netAmount: 400,
      vatAmount: 100,
    },
  });
  assertJournalTailBalanced((await store.getReports()).journal, 3);

  // Öre-tolerance edited triple: 98.77 + 24.69 = 123.46 passes the ±0.01 edit
  // validation but is 1 öre off — the posting derives net 98.76 and balances.
  const toleranceStore = new MemoryLedgerStore();
  const [toleranceReview] = await toleranceStore.getReviewFeed();
  assert.ok(toleranceReview?.suggestion);
  await toleranceStore.applyReviewDecision(toleranceReview.id, "approve", {
    actorId: "user_founder",
    edited: {
      accountNumber: "6110",
      accountName: "Kontorsmateriel",
      vatCode: "VAT25",
      grossAmount: 123.45,
      netAmount: 98.77,
      vatAmount: 24.69,
    },
  });
  const journal = (await toleranceStore.getReports()).journal;
  const [cost, vat, bank] = journal.slice(-3);
  assert.ok(cost && vat && bank);
  assert.equal(cost.debit, 98.76, "net derived from gross − VAT, not the stated 98.77");
  assert.equal(vat.debit, 24.69);
  assert.equal(bank.credit, 123.45);
  assertJournalTailBalanced(journal, 3);
});

test("MemoryLedgerStore.applyReviewDecision rejects unbalanced edited input before any posting", async () => {
  const store = new MemoryLedgerStore();
  const [review] = await store.getReviewFeed();
  assert.ok(review);
  const journalBefore = (await store.getReports()).journal;

  await assert.rejects(
    () =>
      store.applyReviewDecision(review.id, "approve", {
        actorId: "user_founder",
        edited: {
          accountNumber: "6110",
          accountName: "Kontorsmateriel",
          vatCode: "VAT25",
          grossAmount: 500,
          netAmount: 400,
          vatAmount: 50,
        },
      }),
    (error: unknown) => error instanceof InvalidReviewEditError,
  );

  const journalAfter = (await store.getReports()).journal;
  assert.equal(journalAfter.length, journalBefore.length, "no lines posted");
  const { debit, credit } = sumOre(journalAfter);
  assert.equal(debit, credit, "journal remains balanced after the rejected edit");
});

test("planSieImport skips vouchers whose per-line rounding leaves the entry öre-unbalanced", () => {
  // Raw sum is exactly 0 (passes the ≤0.005 raw check), but round2 per line
  // yields 0.33 + 0.33 vs 0.67 — 1 öre unbalanced. Must be skipped, not imported.
  const file = {
    accounts: {},
    warnings: [],
    vouchers: [
      {
        series: "A",
        number: "1",
        date: "2026-01-15",
        text: "rounding residue",
        transactions: [
          { account: "6110", amount: 0.334 },
          { account: "6110", amount: 0.334 },
          { account: "1930", amount: -0.668 },
        ],
      },
      {
        series: "A",
        number: "2",
        date: "2026-01-15",
        text: "clean voucher",
        transactions: [
          { account: "6110", amount: 100 },
          { account: "1930", amount: -100 },
        ],
      },
    ],
  };

  const { vouchers, skipped } = planSieImport(file);
  assert.deepEqual(skipped, [{ reference: "A 1", reason: "unbalanced" }]);
  assert.equal(vouchers.length, 1);
  const clean = vouchers[0];
  assert.ok(clean);
  assert.equal(clean.reference, "A 2");
  assert.equal(postingImbalanceOre(clean.lines), 0);
});
