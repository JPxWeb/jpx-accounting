import assert from "node:assert/strict";
import test from "node:test";

import type { LedgerStore } from "@jpx-accounting/domain";
import { MemoryLedgerStore } from "@jpx-accounting/domain";

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

test("MemoryLedgerStore.runSimulation returns real projection deltas and writes no journal lines", async () => {
  const store = new MemoryLedgerStore();
  const reviews = await store.getReviewFeed();
  const target = reviews[0];
  assert.ok(target, "seed must include at least one review");

  const reportsBefore = await store.getReports();

  const sim = await store.runSimulation({
    actorId: "user_test",
    title: "What if I approve the seeded review",
    scenario: "approve 1 pending",
    reviewIds: [target.id],
    action: "approve",
  });

  assert.ok(sim.balanceDelta.length > 0, "balance delta non-empty");
  assert.ok(sim.affectedAccounts.includes("2641"), "input VAT must be in affected accounts");

  const reportsAfter = await store.getReports();
  assert.deepEqual(reportsAfter, reportsBefore, "runSimulation must not mutate ledger state");
});

test("MemoryLedgerStore.answerAssistantQuestion delegates to the shared scaffold", async () => {
  const store = new MemoryLedgerStore();
  const answer = await store.answerAssistantQuestion("Can I deduct this?");
  assert.equal(answer.status, "grounded");
  assert.equal(answer.citations.length, 1);
  assert.equal(answer.question, "Can I deduct this?");
});

test("MemoryLedgerStore.refreshComplianceAlerts returns rule output and is idempotent", async () => {
  const store = new MemoryLedgerStore();
  const first = await store.refreshComplianceAlerts();
  const second = await store.refreshComplianceAlerts();
  assert.equal(first.length, second.length);
  assert.ok(first.some((a) => a.kind === "representation-review"));
});
