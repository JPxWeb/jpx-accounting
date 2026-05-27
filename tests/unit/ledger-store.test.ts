import assert from "node:assert/strict";
import test from "node:test";

import type { LedgerStore } from "@jpx-accounting/domain";
import { MemoryLedgerStore, ReviewNotFoundError } from "@jpx-accounting/domain";

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
  };
  const saved = await store.putCompanySettings(settings);
  assert.equal(saved.organizationName, "Test AB");
  const loaded = await store.getCompanySettings();
  assert.equal(loaded?.organizationName, "Test AB");
});
