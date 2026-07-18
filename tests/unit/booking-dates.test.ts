import assert from "node:assert/strict";
import test from "node:test";

import type { ExtractionResult } from "@jpx-accounting/contracts";
import {
  deriveBookedAt,
  InvalidReviewEditError,
  localDayOfTimestamp,
  localTodayIso,
  MemoryLedgerStore,
  nowIso,
} from "@jpx-accounting/domain";

/**
 * WS-B R13 — postings are dated by the voucher's transaction/receipt date,
 * not by the approval click. The decision events keep decision-time
 * `occurredAt` (audit trail); only the LINES carry the accounting date, so
 * entries land in the correct fiscal/VAT period.
 */

/** ISO timestamp built from LOCAL calendar parts — timezone-safe fixtures. */
const localStamp = (year: number, month: number, day: number, hour = 12) =>
  new Date(year, month - 1, day, hour).toISOString();

/** Local `YYYY-MM-DD` for a day offset from now (0 = today, 1 = tomorrow). */
const localDayOffset = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad2 = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};

const marchExtraction = (): ExtractionResult => ({
  modelId: "stub-test",
  extractedAt: nowIso(),
  fields: [
    { key: "receiptDate", label: "Receipt date", value: "2026-03-15", confidence: 0.97, required: true },
    { key: "transactionDate", label: "Transaction date", value: "2026-03-15", confidence: 0.9, required: false },
  ],
});

const legacyCreateInput = (title: string, filename: string) => ({
  organizationId: "org_jpx",
  workspaceId: "workspace_main",
  actorId: "user_founder",
  title,
  originalFilename: filename,
  mimeType: "image/jpeg" as const,
  modalities: ["camera" as const],
});

test("localDayOfTimestamp uses LOCAL calendar parts and guards NaN", () => {
  assert.equal(localDayOfTimestamp(localStamp(2026, 3, 15)), "2026-03-15");
  // Local midnight must stay on the same local day (the UTC slice would shift
  // it in any timezone east of UTC).
  assert.equal(localDayOfTimestamp(new Date(2026, 6, 1, 0, 0, 0).toISOString()), "2026-07-01");
  assert.throws(() => localDayOfTimestamp("garbage"), /unparseable timestamp/);
});

test("deriveBookedAt prefers transactionDate, then receiptDate, then the decision day", () => {
  const occurredAt = localStamp(2026, 7, 18);
  assert.equal(deriveBookedAt({ transactionDate: "2026-03-15", receiptDate: "2026-03-14" }, occurredAt), "2026-03-15");
  assert.equal(deriveBookedAt({ receiptDate: "2026-03-14" }, occurredAt), "2026-03-14");
  assert.equal(deriveBookedAt({}, occurredAt), "2026-07-18");
  assert.equal(deriveBookedAt(undefined, occurredAt), "2026-07-18");
});

test("deriveBookedAt skips malformed, non-calendar, and future-dated candidates", () => {
  const occurredAt = localStamp(2026, 7, 18);
  // Malformed transactionDate falls through to receiptDate.
  assert.equal(deriveBookedAt({ transactionDate: "15/03/2026", receiptDate: "2026-03-14" }, occurredAt), "2026-03-14");
  // Non-existent calendar day (Feb 31) is rejected, not silently reparsed.
  assert.equal(deriveBookedAt({ transactionDate: "2026-02-31" }, occurredAt), "2026-07-18");
  // Full ISO timestamps are not calendar days — strict YYYY-MM-DD only.
  assert.equal(deriveBookedAt({ transactionDate: "2026-03-15T10:00:00.000Z" }, occurredAt), "2026-07-18");
  // Future-dated extraction noise must not book into an open future period.
  assert.equal(deriveBookedAt({ transactionDate: "2026-07-19" }, occurredAt), "2026-07-18");
  // A future transactionDate falls through to a valid past receiptDate.
  assert.equal(deriveBookedAt({ transactionDate: "2026-09-01", receiptDate: "2026-07-01" }, occurredAt), "2026-07-01");
});

test("approval with a prior-month receipt date books into that month (journal + VAT bucketing); decision events keep decision time", async () => {
  const store = new MemoryLedgerStore();
  const created = await store.createEvidence(legacyCreateInput("Prior-month receipt", "prior-month.jpg"));

  const refreshed = await store.updateEvidenceExtraction(created.evidence.id, marchExtraction());
  assert.equal(refreshed?.voucher?.voucherFields.transactionDate, "2026-03-15", "refresh precondition");

  const beforeDecision = nowIso();
  const decided = await store.applyReviewDecision(created.review.id, "approve", { actorId: "user_founder" });
  assert.equal(decided?.status, "approved");

  // Journal bucketing: the 3 posted lines land in the March window, dated by
  // the receipt's transaction date — not by the approval click.
  const march = await store.getReports({ from: "2026-03-01", to: "2026-03-31" });
  assert.equal(march.journal.length, 3, "expense + input VAT + bank all in March");
  for (const entry of march.journal) {
    assert.equal(entry.bookedAt, "2026-03-15");
  }

  // VAT period bucketing: the input VAT (2641) is claimed in the March window.
  const inputVatLine = march.journal.find((entry) => entry.accountNumber === "2641");
  assert.ok(inputVatLine, "input VAT line in the March window");
  assert.equal(inputVatLine.debit, 249.8, "seed VAT amount rides unchanged");
  const vat25 = march.vat.find((entry) => entry.vatCode === "VAT25");
  assert.ok(vat25, "VAT25 bucket present in the March VAT report");
  assert.equal(vat25.vatAmount, 249.8);

  // The current period does NOT contain the posting: only these 3 lines carry
  // the March date, and nothing booked in March leaks into later windows.
  const unfiltered = await store.getReports();
  assert.equal(
    unfiltered.journal.filter((entry) => entry.bookedAt.slice(0, 10) === "2026-03-15").length,
    3,
    "exactly the posted lines are March-dated",
  );

  // Audit trail unchanged (R13): decision events keep decision-time occurredAt.
  const events = await store.getEvents();
  const approvedEvt = events.find((event) => event.eventType === "ReviewApproved");
  const postedEvt = events.find((event) => event.eventType === "PostedToLedger");
  assert.ok(approvedEvt && postedEvt);
  assert.ok(approvedEvt.occurredAt >= beforeDecision, "ReviewApproved occurredAt is decision time");
  assert.ok(postedEvt.occurredAt >= beforeDecision, "PostedToLedger occurredAt is decision time");
  assert.notEqual(postedEvt.occurredAt.slice(0, 10), "2026-03-15", "event occurredAt is NOT the accounting date");
  const postedLines = postedEvt.payload.lines as Array<{ bookedAt: string }>;
  assert.ok(Array.isArray(postedLines) && postedLines.length === 3);
  for (const line of postedLines) {
    assert.equal(line.bookedAt, "2026-03-15", "event payload lines carry the accounting date (replay truth)");
  }
});

test("approval without a usable receipt/transaction date falls back to the decision day", async () => {
  const store = new MemoryLedgerStore();
  const created = await store.createEvidence(legacyCreateInput("Broken-date receipt", "broken-date.jpg"));

  await store.updateEvidenceExtraction(created.evidence.id, {
    modelId: "stub-test",
    extractedAt: nowIso(),
    fields: [
      { key: "receiptDate", label: "Receipt date", value: "not-a-date", confidence: 0.4, required: true },
      { key: "transactionDate", label: "Transaction date", value: "15/03/2026", confidence: 0.4, required: false },
    ],
  });

  const dayBefore = localTodayIso();
  const decided = await store.applyReviewDecision(created.review.id, "approve", { actorId: "user_founder" });
  const dayAfter = localTodayIso();
  assert.equal(decided?.status, "approved");

  const journal = (await store.getReports()).journal.slice(-3);
  assert.equal(journal.length, 3);
  for (const entry of journal) {
    assert.ok(
      entry.bookedAt === dayBefore || entry.bookedAt === dayAfter,
      `fallback bookedAt ${entry.bookedAt} must be the local decision day`,
    );
  }
});

test("edited bookedAt overrides the derivation and round-trips through events append-only", async () => {
  const store = new MemoryLedgerStore();
  const [review] = await store.getReviewFeed();
  assert.ok(review?.suggestion, "seed review with suggestion required");
  const voucherBefore = (await store.getSnapshot()).vouchers.find((voucher) => voucher.id === review.voucherId);
  assert.ok(voucherBefore);

  const edited = {
    accountNumber: "6110",
    accountName: "Kontorsmateriel",
    vatCode: "VAT25",
    bookedAt: "2026-04-02",
  };
  const decided = await store.applyReviewDecision(review.id, "approve", { actorId: "user_founder", edited });
  assert.equal(decided?.status, "approved");

  // Posted lines carry the edited accounting date.
  const april = await store.getReports({ from: "2026-04-01", to: "2026-04-30" });
  assert.equal(april.journal.length, 3);
  for (const entry of april.journal) {
    assert.equal(entry.bookedAt, "2026-04-02");
  }

  // ReviewApproved payload records the edit (audit trail), PostedToLedger
  // lines carry the date (replay truth).
  const events = await store.getEvents();
  const approvedEvt = events.find((event) => event.eventType === "ReviewApproved");
  assert.deepEqual(approvedEvt?.payload.edited, edited);
  const postedEvt = events.find((event) => event.eventType === "PostedToLedger");
  const postedLines = postedEvt?.payload.lines as Array<{ bookedAt: string }>;
  assert.ok(Array.isArray(postedLines) && postedLines.length === 3);
  assert.equal(postedLines[0]?.bookedAt, "2026-04-02");

  // Append-only: the stored voucher row keeps its original dates.
  const voucherAfter = (await store.getSnapshot()).vouchers.find((voucher) => voucher.id === review.voucherId);
  assert.equal(voucherAfter?.voucherFields.transactionDate, voucherBefore.voucherFields.transactionDate);
  assert.equal(voucherAfter?.voucherFields.receiptDate, voucherBefore.voucherFields.receiptDate);
});

test("invalid edited bookedAt (future or malformed) throws InvalidReviewEditError before any mutation", async () => {
  const store = new MemoryLedgerStore();
  const [review] = await store.getReviewFeed();
  assert.ok(review);
  const eventsBefore = (await store.getEvents()).length;
  const journalBefore = (await store.getReports()).journal.length;

  const base = { accountNumber: "6110", accountName: "Kontorsmateriel", vatCode: "VAT25" };
  for (const bookedAt of [localDayOffset(1), "2026-02-30", "garbage", "2026-04-02T10:00:00.000Z"]) {
    await assert.rejects(
      () => store.applyReviewDecision(review.id, "approve", { actorId: "user_founder", edited: { ...base, bookedAt } }),
      (error) => {
        assert.ok(error instanceof InvalidReviewEditError, `expected InvalidReviewEditError for ${bookedAt}`);
        assert.ok(error.issues.length > 0);
        return true;
      },
    );
  }

  // Nothing mutated: the review stays decidable and no events/lines landed.
  const [reviewAfter] = await store.getReviewFeed();
  assert.equal(reviewAfter?.status, "needs-review");
  assert.equal((await store.getEvents()).length, eventsBefore);
  assert.equal((await store.getReports()).journal.length, journalBefore);
});

test("an edited bookedAt of today is accepted (future gate is exclusive)", async () => {
  const store = new MemoryLedgerStore();
  const [review] = await store.getReviewFeed();
  assert.ok(review?.suggestion);

  const todayLocal = localTodayIso();
  const decided = await store.applyReviewDecision(review.id, "approve", {
    actorId: "user_founder",
    edited: { accountNumber: "6110", accountName: "Kontorsmateriel", vatCode: "VAT25", bookedAt: todayLocal },
  });
  assert.equal(decided?.status, "approved");
  const journal = (await store.getReports()).journal.slice(-3);
  for (const entry of journal) {
    assert.equal(entry.bookedAt, todayLocal);
  }
});
