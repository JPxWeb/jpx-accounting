import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryLedgerStore } from "@jpx-accounting/domain/store";

import { createApp } from "../../services/api/src/app";
import { createApiRuntimeDependencies } from "../../services/api/src/runtime";

function createTestApp(store: MemoryLedgerStore) {
  const dependencies = createApiRuntimeDependencies({
    port: 0,
    runtimeMode: "demo",
    allowTestReset: false,
    corsPolicy: { kind: "wildcard" },
    azureOpenAi: {},
    database: { poolMode: "direct", poolMax: 10 },
    azureStorage: {},
    azureDocumentIntelligence: {},
    auth: {},
    advisor: {
      toolApprovalSecret: "test-advisor-approval-secret",
      maxOutputTokens: 2048,
      streamTimeoutMs: 90_000,
    },
  });
  return createApp({ ...dependencies, store, allowTestReset: false });
}

async function createOpenReview(store: MemoryLedgerStore) {
  return store.createEvidence({
    actorId: "user:test",
    title: "Proposal route fixture",
    originalFilename: "proposal.pdf",
    mimeType: "application/pdf",
    modalities: ["upload"],
  });
}

test("POST /api/review-proposals returns 409 for a posted review", async () => {
  const store = new MemoryLedgerStore();
  const created = await createOpenReview(store);
  await store.applyReviewDecision(created.review.id, "approve", { actorId: "user:test" });
  const response = await createTestApp(store).request("http://localhost/api/review-proposals", {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": "proposal-closed" },
    body: JSON.stringify({
      reviewId: created.review.id,
      voucherId: created.voucher.id,
      proposals: [{ kind: "noop" }],
    }),
  });

  assert.equal(response.status, 409);
  const body = (await response.json()) as { code: string; error: string; requestId: string };
  assert.equal(body.code, "review_not_open");
  assert.match(body.error, /open review|remain open/i);
  assert.equal(body.requestId, "proposal-closed");
});

test("POST /api/review-proposals attaches server-attributed intent for an open review", async () => {
  const store = new MemoryLedgerStore();
  const created = await createOpenReview(store);
  const app = createTestApp(store);
  const response = await app.request("http://localhost/api/review-proposals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      reviewId: created.review.id,
      voucherId: created.voucher.id,
      proposals: [{ kind: "noop" }],
      actorId: "spoofed-client",
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    reviewId: created.review.id,
    deepLink: `/today?view=queue&review=${encodeURIComponent(created.review.id)}`,
    status: "pending_review",
  });
  const intent = await store.getReviewEnrichmentIntent(created.review.id);
  assert.equal(intent?.voucherId, created.voucher.id);
  assert.equal(intent?.updatedBy, "user_founder");
});

test("POST /api/review-proposals rejects a review and voucher mismatch", async () => {
  const store = new MemoryLedgerStore();
  const first = await createOpenReview(store);
  const second = await createOpenReview(store);
  const response = await createTestApp(store).request("http://localhost/api/review-proposals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      reviewId: first.review.id,
      voucherId: second.voucher.id,
      proposals: [{ kind: "noop" }],
    }),
  });
  assert.equal(response.status, 404);
});
