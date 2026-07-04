import assert from "node:assert/strict";
import test from "node:test";

import type { LedgerStore } from "@jpx-accounting/domain";
import {
  deriveDeterministicExtraction,
  InvalidReviewEditError,
  MemoryLedgerStore,
  parseSie,
  ReviewNotFoundError,
  SieImportError,
  today,
} from "@jpx-accounting/domain";

test("MemoryLedgerStore satisfies the LedgerStore contract for create, review, and reports", async () => {
  const store: LedgerStore = new MemoryLedgerStore();
  const journalBefore = (await store.getReports()).journal.length;

  const created = await store.createEvidence({
    organizationId: "org_jpx",
    workspaceId: "workspace_main",
    actorId: "user_founder",
    title: "Contract test receipt",
    originalFilename: "contract-test.jpg",
    mimeType: "image/jpeg",
    modalities: ["camera"],
  });

  const evidenceContext = await store.getEvidenceContext(created.evidence.id);
  assert.equal(evidenceContext?.voucher?.id, created.voucher.id);

  const approved = await store.applyReviewDecision(created.review.id, "approve", {
    actorId: "user_founder",
  });

  assert.equal(approved?.status, "approved");
  assert.equal((await store.getReports()).journal.length, journalBefore + 3);
});

test("MemoryLedgerStore.createEvidence honors upload metadata and derives file-seeded voucher fields", async () => {
  const store = new MemoryLedgerStore();
  const sha256 = "ab".repeat(32);
  const blobPath = "evidence-uploads/upload-test-1/uploaded-receipt.jpg";

  const created = await store.createEvidence({
    organizationId: "org_jpx",
    workspaceId: "workspace_main",
    actorId: "user_founder",
    title: "Uploaded receipt",
    originalFilename: "uploaded-receipt.jpg",
    mimeType: "image/jpeg",
    modalities: ["upload"],
    sizeBytes: 48211,
    sha256,
    uploadId: "upload-test-1",
    blobPath,
  });

  assert.equal(created.evidence.hash, sha256, "sha256 must become the evidence hash");
  assert.equal(created.evidence.blobPath, blobPath, "client-echoed blobPath must be stored");
  assert.equal(created.evidence.sizeBytes, 48211, "sizeBytes must round-trip");

  const expectedFields = deriveDeterministicExtraction({ filename: "uploaded-receipt.jpg", sizeBytes: 48211 }, today());
  const expectedGross = Number.parseFloat(expectedFields.find((field) => field.key === "grossAmount")!.value);
  assert.notEqual(created.voucher.voucherFields.grossAmount, 1249, "file-seeded gross must not be the legacy 1249");
  assert.equal(created.voucher.voucherFields.grossAmount, expectedGross);
  assert.deepEqual(created.voucher.extractedFields, expectedFields);

  const snapshot = await store.getSnapshot();
  const roundTripped = snapshot.evidence.find((item) => item.id === created.evidence.id);
  assert.equal(roundTripped?.sizeBytes, 48211);
});

test("MemoryLedgerStore.createEvidence without upload metadata keeps the legacy synthetic path and 1249 seed", async () => {
  const store = new MemoryLedgerStore();
  const created = await store.createEvidence({
    organizationId: "org_jpx",
    workspaceId: "workspace_main",
    actorId: "user_founder",
    title: "Legacy receipt",
    originalFilename: "legacy-receipt.jpg",
    mimeType: "image/jpeg",
    modalities: ["camera"],
  });

  assert.equal(created.evidence.blobPath, `evidence/${created.evidence.id}/legacy-receipt.jpg`);
  assert.equal(created.evidence.sizeBytes, undefined);
  assert.equal(created.voucher.voucherFields.grossAmount, 1249, "legacy path must keep the canned 1249 gross");
  assert.equal(created.voucher.voucherFields.netAmount, 999.2);
  assert.equal(created.voucher.voucherFields.vatAmount, 249.8);

  // Seed stability: the constructor-seeded voucher also rides the legacy path.
  const snapshot = await store.getSnapshot();
  const seeded = snapshot.vouchers.find((voucher) => voucher.id !== created.voucher.id);
  assert.equal(seeded?.voucherFields.grossAmount, 1249);
});

test("MemoryLedgerStore.applyReviewDecision with edits posts corrected lines append-only", async () => {
  const store = new MemoryLedgerStore();
  const [review] = await store.getReviewFeed();
  assert.ok(review?.suggestion, "seed review with suggestion required");
  const voucherBefore = (await store.getSnapshot()).vouchers.find((voucher) => voucher.id === review.voucherId);
  assert.equal(voucherBefore?.voucherFields.grossAmount, 1249, "seed precondition");

  const journalBefore = (await store.getReports()).journal.length;
  const edited = {
    accountNumber: "6110",
    accountName: "Kontorsmateriel",
    vatCode: "VAT25",
    grossAmount: 500,
    netAmount: 400,
    vatAmount: 100,
  };
  const decided = await store.applyReviewDecision(review.id, "approve", { actorId: "user_founder", edited });

  assert.equal(decided?.status, "approved");
  assert.equal(decided.suggestion?.accountNumber, "6110", "review read model carries the edited suggestion");
  assert.equal(decided.suggestion?.accountName, "Kontorsmateriel");
  assert.equal(decided.suggestion?.vatCode, "VAT25");
  assert.equal(decided.provenanceTimeline.at(-1)?.label, "Approved with edits");

  // Posted lines use the edited account and amounts.
  const journal = (await store.getReports()).journal;
  assert.equal(journal.length, journalBefore + 3);
  const [expense, vat, bank] = journal.slice(-3);
  assert.equal(expense?.accountNumber, "6110");
  assert.equal(expense?.debit, 400);
  assert.equal(vat?.accountNumber, "2641");
  assert.equal(vat?.debit, 100);
  assert.equal(bank?.credit, 500);

  // Append-only: the stored voucher row is NOT rewritten by the edit.
  const voucherAfter = (await store.getSnapshot()).vouchers.find((voucher) => voucher.id === review.voucherId);
  assert.equal(voucherAfter?.voucherFields.grossAmount, 1249, "voucher read model keeps original amounts");
  assert.equal(voucherAfter?.status, "approved");

  // Events: ReviewApproved carries the edit; PostedToLedger carries the lines
  // (Memory/Postgres payload parity — Phase 3 finding 13).
  const events = await store.getEvents();
  const approvedEvt = events.find((event) => event.eventType === "ReviewApproved");
  assert.deepEqual(approvedEvt?.payload.edited, edited);
  const postedEvt = events.find((event) => event.eventType === "PostedToLedger");
  const postedLines = postedEvt?.payload.lines as Array<{ accountNumber: string; debit: number; credit: number }>;
  assert.ok(Array.isArray(postedLines) && postedLines.length === 3, "PostedToLedger payload must include lines");
  assert.equal(postedLines[0]?.accountNumber, "6110");
  assert.equal(postedLines[0]?.debit, 400);
});

test("MemoryLedgerStore.applyReviewDecision rejects inconsistent edited amounts before any mutation", async () => {
  const store = new MemoryLedgerStore();
  const [review] = await store.getReviewFeed();
  assert.ok(review);
  const eventsBefore = (await store.getEvents()).length;
  const journalBefore = (await store.getReports()).journal.length;

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
    (error) => {
      assert.ok(error instanceof InvalidReviewEditError);
      assert.ok(error.issues.length > 0);
      return true;
    },
  );

  // Partial amounts are equally invalid: all three or none.
  await assert.rejects(
    () =>
      store.applyReviewDecision(review.id, "approve", {
        actorId: "user_founder",
        edited: { accountNumber: "6110", accountName: "Kontorsmateriel", vatCode: "VAT25", grossAmount: 500 },
      }),
    (error) => error instanceof InvalidReviewEditError,
  );

  // Nothing mutated: the review stays decidable and no events/lines landed.
  const [reviewAfter] = await store.getReviewFeed();
  assert.equal(reviewAfter?.status, "needs-review");
  assert.equal((await store.getEvents()).length, eventsBefore);
  assert.equal((await store.getReports()).journal.length, journalBefore);
});

test("MemoryLedgerStore.applyReviewDecision reject ignores edited entirely", async () => {
  const store = new MemoryLedgerStore();
  const [review] = await store.getReviewFeed();
  assert.ok(review?.suggestion);
  const originalAccount = review.suggestion.accountNumber;
  const journalBefore = (await store.getReports()).journal.length;

  // Even an inconsistent edit must not throw on reject — it is ignored.
  const rejected = await store.applyReviewDecision(review.id, "reject", {
    actorId: "user_founder",
    edited: {
      accountNumber: "6110",
      accountName: "Kontorsmateriel",
      vatCode: "VAT25",
      grossAmount: 500,
      netAmount: 1,
      vatAmount: 1,
    },
  });

  assert.equal(rejected?.status, "rejected");
  assert.equal(rejected.suggestion?.accountNumber, originalAccount, "suggestion untouched on reject");
  assert.equal((await store.getReports()).journal.length, journalBefore, "no lines posted on reject");
  const rejectedEvt = (await store.getEvents()).find((event) => event.eventType === "ReviewRejected");
  assert.equal(rejectedEvt?.payload.edited, undefined, "reject payload carries no edit");
});

test("MemoryLedgerStore.runSimulation returns real deltas and writes no journal lines", async () => {
  const store = new MemoryLedgerStore();
  const reviews = await store.getReviewFeed();
  const target = reviews[0];
  assert.ok(target);
  const reportsBefore = await store.getReports();

  const sim = await store.runSimulation({
    actorId: "u",
    title: "what-if",
    scenario: "approve one",
    reviewIds: [target.id],
    action: "approve",
  });
  assert.ok(sim.balanceDelta.length > 0);
  assert.ok(sim.affectedAccounts.includes("2641"));

  const reportsAfter = await store.getReports();
  assert.deepEqual(reportsAfter, reportsBefore);
});

test("MemoryLedgerStore.runSimulation throws ReviewNotFoundError on missing IDs", async () => {
  const store = new MemoryLedgerStore();
  await assert.rejects(
    () =>
      store.runSimulation({
        actorId: "u",
        title: "t",
        scenario: "s",
        reviewIds: ["does_not_exist"],
        action: "approve",
      }),
    (err) => {
      assert.ok(err instanceof ReviewNotFoundError);
      assert.deepEqual(err.missingIds, ["does_not_exist"]);
      return true;
    },
  );
});

test("MemoryLedgerStore.runSimulation dedupes duplicate reviewIds", async () => {
  const store = new MemoryLedgerStore();
  const reviews = await store.getReviewFeed();
  const target = reviews[0];
  assert.ok(target);
  const single = await store.runSimulation({
    actorId: "u",
    title: "single",
    scenario: "s",
    reviewIds: [target.id],
    action: "approve",
  });
  const dup = await store.runSimulation({
    actorId: "u",
    title: "dup",
    scenario: "s",
    reviewIds: [target.id, target.id, target.id],
    action: "approve",
  });
  assert.deepEqual(dup.balanceDelta, single.balanceDelta);
});

test("MemoryLedgerStore.importSie grows the journal, appends VoucherImported events, and dedupes re-imports", async () => {
  const store = new MemoryLedgerStore();
  const sieText = [
    "#SIETYP 4",
    '#KONTO 6110 "Kontorsmateriel"',
    '#VER A 42 20260315 "Inköpta pärmar"',
    "{",
    "#TRANS 6110 {} 100.00",
    "#TRANS 1930 {} -100.00",
    "}",
  ].join("\n");
  const file = parseSie(sieText);

  const journalBefore = (await store.getReports()).journal.length;
  const eventsBefore = (await store.getEvents()).length;

  const result = await store.importSie({ actorId: "user_founder", file });
  assert.deepEqual(result, { accepted: true, importedVouchers: 1, importedTransactions: 2, skipped: [] });

  const journal = (await store.getReports()).journal;
  assert.equal(journal.length, journalBefore + 2);
  const [expense, bank] = journal.slice(-2);
  assert.equal(expense?.accountNumber, "6110");
  assert.equal(expense?.accountName, "Kontorsmateriel");
  assert.equal(expense?.debit, 100);
  assert.equal(bank?.accountNumber, "1930");
  assert.equal(bank?.accountName, "Företagskonto", "registry fallback when the file has no #KONTO");
  assert.equal(bank?.credit, 100);
  assert.equal(expense?.bookedAt, "2026-03-15");

  const events = await store.getEvents();
  assert.equal(events.length, eventsBefore + 1, "one VoucherImported event per accepted voucher");
  const imported = events.at(-1);
  assert.equal(imported?.eventType, "VoucherImported");
  assert.equal(imported?.aggregateType, "ledger");
  assert.equal(imported?.aggregateId, "sie_A_42");
  assert.equal(imported?.actorId, "user_founder");
  const payload = imported?.payload as { source?: string; lines?: unknown[] };
  assert.equal(payload.source, "sie");
  assert.ok(Array.isArray(payload.lines) && payload.lines.length === 2, "payload carries the replay lines");

  // Idempotency: the same file re-imported skips everything as duplicate.
  const replay = await store.importSie({ actorId: "user_founder", file });
  assert.deepEqual(replay, {
    accepted: true,
    importedVouchers: 0,
    importedTransactions: 0,
    skipped: [{ reference: "A 42", reason: "duplicate" }],
  });
  assert.equal((await store.getReports()).journal.length, journalBefore + 2, "no duplicate lines");
  assert.equal((await store.getEvents()).length, eventsBefore + 1, "no duplicate events");
});

test("MemoryLedgerStore.importSie rejects bound violations with SieImportError", async () => {
  const store = new MemoryLedgerStore();
  const file = {
    accounts: {},
    warnings: [],
    vouchers: Array.from({ length: 501 }, (_, index) => ({
      series: "A",
      number: String(index + 1),
      date: "2026-01-01",
      text: undefined,
      transactions: [{ account: "1930", amount: 0 }],
    })),
  };
  await assert.rejects(
    () => store.importSie({ actorId: "user_founder", file }),
    (error) => error instanceof SieImportError,
  );
});

test("MemoryLedgerStore.refreshComplianceAlerts idempotent + immutable", async () => {
  const store = new MemoryLedgerStore();
  const first = await store.refreshComplianceAlerts();
  const second = await store.refreshComplianceAlerts();
  assert.equal(first.length, second.length);
});

test("MemoryLedgerStore.getCompanySettings/putCompanySettings round-trip", async () => {
  const store = new MemoryLedgerStore();
  assert.equal(await store.getCompanySettings(), null);
  const settings = {
    organizationId: "org_test",
    organizationName: "Test AB",
    organizationNumber: "556677-8899",
    addressLine1: "Kungsgatan 1",
    postalCode: "111 22",
    city: "Stockholm",
    contactEmail: "test@example.com",
    profile: { country: "SE" as const, locale: "en-GB", currency: "EUR", fiscalYearStart: "07-01" },
  };
  const saved = await store.putCompanySettings(settings);
  assert.equal(saved.organizationName, "Test AB");
  assert.equal(saved.profile.currency, "EUR");
  const loaded = await store.getCompanySettings();
  assert.equal(loaded?.organizationName, "Test AB");
  assert.equal(loaded?.profile.locale, "en-GB");
});

test("MemoryLedgerStore.putCompanySettings normalizes legacy payloads without a profile", async () => {
  const store = new MemoryLedgerStore();
  const legacy = {
    organizationId: "org_test",
    organizationName: "Legacy AB",
    organizationNumber: "556677-8899",
    addressLine1: "Kungsgatan 1",
    postalCode: "111 22",
    city: "Stockholm",
    contactEmail: "legacy@example.com",
  } as Parameters<MemoryLedgerStore["putCompanySettings"]>[0];
  const saved = await store.putCompanySettings(legacy);
  assert.deepEqual(saved.profile, { country: "SE", locale: "sv-SE", currency: "SEK", fiscalYearStart: "01-01" });
});
