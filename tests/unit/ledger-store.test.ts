import assert from "node:assert/strict";
import test from "node:test";

import type { LedgerStore } from "@jpx-accounting/domain";
import { deriveDeterministicExtraction, MemoryLedgerStore, ReviewNotFoundError, today } from "@jpx-accounting/domain";

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
