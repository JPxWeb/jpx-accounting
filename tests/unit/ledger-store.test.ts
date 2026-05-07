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
