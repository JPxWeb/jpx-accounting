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

test("review enrichment intent route rejects unsupported pre-post proposals before persistence", async () => {
  const store = new MemoryLedgerStore();
  const created = await store.createEvidence({
    actorId: "user:test",
    title: "Unsupported intent route",
    originalFilename: "unsupported-intent-route.pdf",
    mimeType: "application/pdf",
    modalities: ["upload"],
  });
  const app = createTestApp(store);
  const response = await app.request(`http://localhost/api/reviews/${created.review.id}/enrichment-intents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      reviewId: created.review.id,
      proposals: [{ kind: "voucher_tags_add", tagIds: ["tag_travel"] }],
    }),
  });

  assert.equal(response.status, 422);
  assert.equal(((await response.json()) as { code: string }).code, "enrichment_not_supported");
  assert.equal(await store.getReviewEnrichmentIntent(created.review.id), undefined);
});

test("review approval reports a typed error when an intent targets no planned line", async () => {
  const store = new MemoryLedgerStore();
  const created = await store.createEvidence({
    actorId: "user:test",
    title: "Missing line target",
    originalFilename: "missing-line-target.pdf",
    mimeType: "application/pdf",
    modalities: ["upload"],
  });
  const app = createTestApp(store);
  const attached = await app.request(`http://localhost/api/reviews/${created.review.id}/enrichment-intents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      reviewId: created.review.id,
      proposals: [
        {
          kind: "line_enrichment_record",
          lineId: "ln_missing",
          enrichmentType: "project",
          payload: { projectId: "proj_1" },
        },
      ],
    }),
  });
  assert.equal(attached.status, 200);
  const { version } = (await attached.json()) as { version: string };

  const response = await app.request(`http://localhost/api/reviews/${created.review.id}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enrichmentIntent: { mode: "consume", version } }),
  });
  assert.equal(response.status, 422);
  assert.equal(((await response.json()) as { code: string }).code, "enrichment_line_not_found");
});

test("approval refuses to consume an intent that was replaced after it was presented", async () => {
  const store = new MemoryLedgerStore();
  const created = await store.createEvidence({
    actorId: "user:test",
    title: "Concurrent intent replacement",
    originalFilename: "concurrent-intent-replacement.pdf",
    mimeType: "application/pdf",
    modalities: ["upload"],
  });
  const app = createTestApp(store);

  // Reviewer A attaches and reads the version their sheet will echo.
  const seen = await app.request(`http://localhost/api/reviews/${created.review.id}/enrichment-intents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reviewId: created.review.id, proposals: [{ kind: "noop" }] }),
  });
  const { version: seenVersion } = (await seen.json()) as { version: string };

  // A concurrent producer (second tab / MCP proposal / advisor) replaces it.
  await app.request(`http://localhost/api/reviews/${created.review.id}/enrichment-intents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      reviewId: created.review.id,
      proposals: [
        { kind: "invoice_registration", direction: "ap", counterparty: "Unseen supplier", dueDate: "2026-09-01" },
      ],
    }),
  });

  const eventsBefore = (await store.getEvents()).length;
  const stale = await app.request(`http://localhost/api/reviews/${created.review.id}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": "stale-consume" },
    body: JSON.stringify({ enrichmentIntent: { mode: "consume", version: seenVersion } }),
  });

  assert.equal(stale.status, 409);
  const staleBody = (await stale.json()) as { code: string; requestId: string };
  assert.equal(staleBody.code, "enrichment_intent_stale");
  assert.equal(staleBody.requestId, "stale-consume");
  const events = await store.getEvents();
  assert.equal(events.length, eventsBefore);
  assert.equal(
    events.some((event) => event.eventType === "InvoiceRegistered"),
    false,
  );
  assert.equal((await store.findReviewByVoucher(created.voucher.id))?.status, "needs-review");
});

test("a forged consume token cannot append a pre-existing intent", async () => {
  const store = new MemoryLedgerStore();
  const created = await store.createEvidence({
    actorId: "user:test",
    title: "Forged consume token",
    originalFilename: "forged-consume-token.pdf",
    mimeType: "application/pdf",
    modalities: ["upload"],
  });
  const app = createTestApp(store);
  await store.attachReviewEnrichmentIntent({
    actorId: "user:other",
    reviewId: created.review.id,
    proposals: [
      { kind: "invoice_registration", direction: "ap", counterparty: "Unseen supplier", dueDate: "2026-09-01" },
    ],
  });

  const forged = await app.request(`http://localhost/api/reviews/${created.review.id}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enrichmentIntent: { mode: "consume", version: "rei_forged" } }),
  });
  assert.equal(forged.status, 409);
  assert.equal(((await forged.json()) as { code: string }).code, "enrichment_intent_stale");

  // Omitting the assertion entirely is fail-closed, not fail-open: the review
  // posts, and the intent nobody presented is discarded rather than appended.
  const plain = await app.request(`http://localhost/api/reviews/${created.review.id}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(plain.status, 200);
  const events = await store.getEvents();
  assert.equal(
    events.some((event) => event.eventType === "InvoiceRegistered"),
    false,
  );
  assert.equal(events.filter((event) => event.eventType === "PostedToLedger").length, 1);
  assert.equal(await store.getReviewEnrichmentIntent(created.review.id), undefined);
});
