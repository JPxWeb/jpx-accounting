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

test("review enrichment intent routes derive actor and guard closed reviews", async () => {
  const store = new MemoryLedgerStore();
  const created = await store.createEvidence({
    actorId: "user:test",
    title: "Intent route",
    originalFilename: "intent-route.pdf",
    mimeType: "application/pdf",
    modalities: ["upload"],
  });
  const app = createTestApp(store);

  const attached = await app.request(`http://localhost/api/reviews/${created.review.id}/enrichment-intents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      reviewId: created.review.id,
      proposals: [{ kind: "noop" }],
      actorId: "spoofed-client",
    }),
  });
  assert.equal(attached.status, 200);
  const attachedBody = (await attached.json()) as { updatedBy: string };
  assert.equal(attachedBody.updatedBy, "user_founder");

  const fetched = await app.request(`http://localhost/api/reviews/${created.review.id}/enrichment-intents`);
  assert.equal(fetched.status, 200);
  assert.deepEqual(await fetched.json(), attachedBody);

  await store.applyReviewDecision(created.review.id, "approve", { actorId: "user:test" });
  const closed = await app.request(`http://localhost/api/reviews/${created.review.id}/enrichment-intents`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": "intent-closed" },
    body: JSON.stringify({ reviewId: created.review.id, proposals: [{ kind: "noop" }] }),
  });
  assert.equal(closed.status, 409);
  const closedBody = (await closed.json()) as { code: string; requestId: string };
  assert.equal(closedBody.code, "review_not_open");
  assert.equal(closedBody.requestId, "intent-closed");
});

test("review enrichment intent route rejects a mismatched body review id", async () => {
  const store = new MemoryLedgerStore();
  const created = await store.createEvidence({
    actorId: "user:test",
    title: "Intent mismatch",
    originalFilename: "intent-mismatch.pdf",
    mimeType: "application/pdf",
    modalities: ["upload"],
  });
  const response = await createTestApp(store).request(
    `http://localhost/api/reviews/${created.review.id}/enrichment-intents`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reviewId: "review_other", proposals: [{ kind: "noop" }] }),
    },
  );
  assert.equal(response.status, 400);
});
