import assert from "node:assert/strict";
import test from "node:test";

import { workspaceSnapshotSchema } from "@jpx-accounting/contracts";
import type { LedgerStore } from "@jpx-accounting/domain";
import {
  deriveDeterministicExtraction,
  InvalidPeriodTokenError,
  InvalidReviewEditError,
  MemoryLedgerStore,
  parseSie,
  ReviewNotFoundError,
  SieImportError,
  today,
} from "@jpx-accounting/domain";

/**
 * March 2026 SIE fixture: seed lines are booked "now", so a voucher pinned to
 * 2026-03-15 is a permanent out-of-current-period fixture (Phase 4 finding 8).
 */
const marchSieFile = () =>
  parseSie(
    [
      "#SIETYP 4",
      '#KONTO 6110 "Kontorsmateriel"',
      '#VER A 42 20260315 "Inköpta pärmar"',
      "{",
      "#TRANS 6110 {} 100.00",
      "#TRANS 1930 {} -100.00",
      "}",
    ].join("\n"),
  );

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
    profile: {
      country: "SE" as const,
      locale: "en-GB",
      currency: "EUR",
      fiscalYearStart: "07-01",
      vatPeriod: "quarterly" as const,
    },
    aiPosture: { advisorEnabled: true, suggestionsEnabled: true },
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
  assert.deepEqual(saved.profile, {
    country: "SE",
    locale: "sv-SE",
    currency: "SEK",
    fiscalYearStart: "01-01",
    vatPeriod: "quarterly",
  });
});

test("MemoryLedgerStore.getReports(range) scopes journal/balances/vat to the inclusive day window", async () => {
  const store = new MemoryLedgerStore();
  await store.importSie({ actorId: "user_founder", file: marchSieFile() });

  // No range → unfiltered, byte-identical to the historical behavior.
  const unfiltered = await store.getReports();
  assert.equal(unfiltered.journal.length, 5, "3 seed lines + 2 imported lines");
  assert.deepEqual(await store.getReports({}), unfiltered, "empty range object is also unfiltered");

  // March window → only the imported voucher, across all three projections.
  const march = await store.getReports({ from: "2026-03-01", to: "2026-03-31" });
  assert.deepEqual(
    march.journal.map((entry) => [entry.accountNumber, entry.debit, entry.credit, entry.bookedAt]),
    [
      ["6110", 100, 0, "2026-03-15"],
      ["1930", 0, 100, "2026-03-15"],
    ],
  );
  assert.deepEqual(
    march.balances.map((balance) => [balance.accountNumber, balance.balance]),
    [
      ["1930", -100],
      ["6110", 100],
    ],
  );
  assert.deepEqual(
    march.vat.map((entry) => entry.vatCode),
    ["NA"],
    "seed VAT25 lines are outside the window",
  );

  // Inclusive at both edges: the fixture is booked exactly on 2026-03-15.
  assert.equal((await store.getReports({ from: "2026-03-15", to: "2026-03-15" })).journal.length, 2);

  // Half-open windows: `to`-only keeps history up to the day, `from`-only
  // keeps everything since (the seed lines are booked "now", after March).
  assert.equal((await store.getReports({ to: "2026-03-15" })).journal.length, 2);
  assert.equal((await store.getReports({ from: "2026-03-16" })).journal.length, 3);

  // Empty window → empty projections, not an error.
  const april = await store.getReports({ from: "2026-04-01", to: "2026-04-30" });
  assert.deepEqual(april, { journal: [], balances: [], vat: [] });
});

test("MemoryLedgerStore.getReportPack composes the period pack and reads fiscalYearStart from settings", async () => {
  const store = new MemoryLedgerStore();
  await store.importSie({ actorId: "user_founder", file: marchSieFile() });

  const pack = await store.getReportPack({ period: "2026-03" });
  assert.deepEqual(pack.period, { token: "2026-03", kind: "month", from: "2026-03-01", to: "2026-03-31" });
  const externalCost = pack.profitLoss.groups.find((group) => group.key === "externalCost");
  assert.deepEqual(externalCost?.lines, [{ accountNumber: "6110", accountName: "Kontorsmateriel", amount: -100 }]);
  assert.equal(pack.profitLoss.periodResult, -100);

  // Without settings the fiscal year defaults to 01-01: Q1 = Jan–Mar.
  const calendarQ1 = await store.getReportPack({ period: "2026-Q1" });
  assert.equal(calendarQ1.period.from, "2026-01-01");
  assert.equal(calendarQ1.period.to, "2026-03-31");
  assert.equal(calendarQ1.profitLoss.periodResult, -100);

  // A broken fiscal year from company settings shifts the quarter windows:
  // Q3 of the fy starting 2025-07-01 is Jan–Mar 2026.
  await store.putCompanySettings({
    organizationId: "org_test",
    organizationName: "Test AB",
    organizationNumber: "556677-8899",
    addressLine1: "Kungsgatan 1",
    postalCode: "111 22",
    city: "Stockholm",
    contactEmail: "test@example.com",
    profile: {
      country: "SE" as const,
      locale: "sv-SE",
      currency: "SEK",
      fiscalYearStart: "07-01",
      vatPeriod: "quarterly" as const,
    },
    aiPosture: { advisorEnabled: true, suggestionsEnabled: true },
  });
  const fiscalQ3 = await store.getReportPack({ period: "2025-Q3" });
  assert.equal(fiscalQ3.period.from, "2026-01-01");
  assert.equal(fiscalQ3.period.to, "2026-03-31");
  assert.equal(fiscalQ3.profitLoss.periodResult, -100);

  // Unknown tokens propagate InvalidPeriodTokenError (→ HTTP 422, Rule 16).
  await assert.rejects(
    () => store.getReportPack({ period: "bogus" }),
    (error) => error instanceof InvalidPeriodTokenError,
  );
});

test("MemoryLedgerStore.getSnapshot carries evidence packets so the voucher→evidence join resolves", async () => {
  const store = new MemoryLedgerStore();
  const created = await store.createEvidence({
    organizationId: "org_jpx",
    workspaceId: "workspace_main",
    actorId: "user_founder",
    title: "Packet join receipt",
    originalFilename: "packet-join.jpg",
    mimeType: "image/jpeg",
    modalities: ["camera"],
  });

  const snapshot = await store.getSnapshot();
  assert.equal(snapshot.packets.length, 2, "seeded packet + created packet");

  // Every voucher's evidencePacketId resolves to a packet whose evidenceIds
  // resolve to snapshot evidence — the client-side drill join (finding 5).
  for (const voucher of snapshot.vouchers) {
    const packet = snapshot.packets.find((candidate) => candidate.id === voucher.evidencePacketId);
    assert.ok(packet, `packet for voucher ${voucher.id} must be in the snapshot`);
    assert.ok(packet.evidenceIds.length > 0);
    for (const evidenceId of packet.evidenceIds) {
      assert.ok(
        snapshot.evidence.some((evidence) => evidence.id === evidenceId),
        "packet evidence ids resolve inside the snapshot",
      );
    }
  }
  const createdPacket = snapshot.packets.find((packet) => packet.id === created.voucher.evidencePacketId);
  assert.deepEqual(createdPacket?.evidenceIds, [created.evidence.id]);

  // Additive-safe contract (Rule 5): pre-Phase-4 payloads without `packets`
  // still parse, defaulting to [].
  const { packets: _packets, ...legacyShape } = snapshot;
  assert.deepEqual(workspaceSnapshotSchema.parse(legacyShape).packets, []);
});

test("MemoryLedgerStore.getSnapshot returns defensive copies of assistantExamples and alerts (Rule 17)", async () => {
  const store = new MemoryLedgerStore();
  const before = await store.getSnapshot();
  const examplesLen = before.assistantExamples.length;
  const alertsLen = before.alerts.length;

  await store.answerAssistantQuestion("What is moms?");
  await store.refreshComplianceAlerts();

  assert.equal(before.assistantExamples.length, examplesLen, "prior snapshot assistantExamples must not grow");
  assert.equal(before.alerts.length, alertsLen, "prior snapshot alerts array must not be replaced in place");

  const after = await store.getSnapshot();
  assert.ok(after.assistantExamples.length > examplesLen, "store gained a new assistant example");
  assert.notEqual(before.assistantExamples, after.assistantExamples, "snapshot arrays must not alias store internals");
  assert.notEqual(before.alerts, after.alerts, "snapshot alerts must not alias store internals");
});

test("MemoryLedgerStore.applyReviewDecision does not mutate a previously returned snapshot (Rule 17)", async () => {
  const store = new MemoryLedgerStore();
  const snapshotBefore = await store.getSnapshot();
  const [reviewInSnapshot] = snapshotBefore.reviews.filter((review) => review.status === "needs-review");
  assert.ok(reviewInSnapshot, "seed review in needs-review required");

  const voucherInSnapshot = snapshotBefore.vouchers.find((voucher) => voucher.id === reviewInSnapshot.voucherId);
  assert.ok(voucherInSnapshot);
  assert.equal(reviewInSnapshot.status, "needs-review");
  assert.equal(voucherInSnapshot.status, "needs-review");
  const timelineLen = reviewInSnapshot.provenanceTimeline.length;

  const [review] = await store.getReviewFeed();
  assert.equal(review?.id, reviewInSnapshot.id);

  await store.applyReviewDecision(review!.id, "approve", { actorId: "user_founder" });

  assert.equal(reviewInSnapshot.status, "needs-review", "captured review object must stay unchanged");
  assert.equal(voucherInSnapshot.status, "needs-review", "captured voucher object must stay unchanged");
  assert.equal(
    reviewInSnapshot.provenanceTimeline.length,
    timelineLen,
    "captured provenance timeline must not grow in place",
  );
});

test("MemoryLedgerStore.getReviewFeed orders newest review first (parity with Postgres created_at DESC, id DESC)", async () => {
  const store = new MemoryLedgerStore();
  // Constructor already seeds one review; two more pushes it to the back.
  const first = await store.createEvidence({
    organizationId: "org_jpx",
    workspaceId: "workspace_main",
    actorId: "user_founder",
    title: "First in feed",
    originalFilename: "first.jpg",
    mimeType: "image/jpeg",
    modalities: ["camera"],
  });
  const second = await store.createEvidence({
    organizationId: "org_jpx",
    workspaceId: "workspace_main",
    actorId: "user_founder",
    title: "Second in feed",
    originalFilename: "second.jpg",
    mimeType: "image/jpeg",
    modalities: ["camera"],
  });

  const feed = await store.getReviewFeed();
  assert.equal(feed.length, 3, "seeded review + two created");
  assert.equal(feed[0]?.id, second.review.id, "newest review first");
  assert.equal(feed[1]?.id, first.review.id);
  assert.equal(feed[2]?.title, "Approve AI subscription posting", "seeded review is oldest, sorts last");
});

test("MemoryLedgerStore.composeEvidence relinks the voucher to the newest packet and keeps optional-key packet shape", async () => {
  const store = new MemoryLedgerStore();
  const created = await store.createEvidence({
    organizationId: "org_jpx",
    workspaceId: "workspace_main",
    actorId: "user_founder",
    title: "Relink target receipt",
    originalFilename: "relink.jpg",
    mimeType: "image/jpeg",
    modalities: ["camera"],
  });

  const composed = await store.composeEvidence({
    organizationId: "org_jpx",
    workspaceId: "workspace_main",
    actorId: "user_founder",
    evidenceIds: [created.evidence.id],
    note: "Rebundled packet",
  });

  // Packet shape parity with PostgresLedgerStore (§A N10): optional keys are
  // always present on the object, even when undefined.
  assert.ok("note" in composed, "note key present even when set");
  assert.ok("voiceTranscript" in composed, "voiceTranscript key present even when undefined");
  assert.equal(composed.note, "Rebundled packet");
  assert.equal(composed.voiceTranscript, undefined);

  // Relink (§A N9): getEvidenceContext must resolve to the newest packet, and
  // the voucher's evidencePacketId must agree so getSnapshot doesn't disagree.
  const context = await store.getEvidenceContext(created.evidence.id);
  assert.equal(context?.packet?.id, composed.id, "getEvidenceContext picks the newest packet");
  assert.equal(context?.voucher?.evidencePacketId, composed.id, "voucher relinked to the newest packet");

  const snapshot = await store.getSnapshot();
  const snapshotVoucher = snapshot.vouchers.find((voucher) => voucher.id === created.voucher.id);
  assert.equal(snapshotVoucher?.evidencePacketId, composed.id, "getSnapshot voucher link matches getEvidenceContext");
});

test("MemoryLedgerStore.getCloseRun returns the honest empty shell: close_unavailable, real local month, empty checklist", async () => {
  const store = new MemoryLedgerStore();
  const closeRun = await store.getCloseRun();

  assert.equal(closeRun.id, "close_unavailable");
  assert.deepEqual(closeRun.checklist, [], "no synthetic checklist items");

  // Independently derive the expected `YYYY-MM` from LOCAL calendar parts
  // (not toISOString().slice, which UTC-shifts near midnight) to avoid
  // exercising the same helper the store uses under the hood.
  const now = new Date();
  const expectedPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  assert.equal(closeRun.period, expectedPeriod);
});
