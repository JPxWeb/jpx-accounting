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

test("POST /api/enrichment-work-items rejects unposted voucher with 409", async () => {
  const store = new MemoryLedgerStore();
  const created = await store.createEvidence({
    actorId: "user:test",
    title: "Open review",
    originalFilename: "open.pdf",
    mimeType: "application/pdf",
    modalities: ["upload"],
  });
  const response = await createTestApp(store).request("http://localhost/api/enrichment-work-items", {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": "ewi-unposted" },
    body: JSON.stringify({
      targetKind: "voucher",
      targetId: created.voucher.id,
      proposedChange: { kind: "noop" },
      source: "ui",
      idempotencyKey: "route-test:unposted",
      actorId: "spoofed-client",
    }),
  });

  assert.equal(response.status, 409);
  const body = (await response.json()) as { code: string; error: string; requestId: string };
  assert.equal(body.code, "enrichment_target_not_posted");
  assert.match(body.error, /posted/i);
  assert.equal(body.requestId, "ewi-unposted");
});

test("GET /api/enrichment-work-items/:id returns the work-item 404 shape", async () => {
  const response = await createTestApp(new MemoryLedgerStore()).request(
    "http://localhost/api/enrichment-work-items/ewi_missing",
    { headers: { "x-request-id": "ewi-missing" } },
  );

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("x-request-id"), "ewi-missing");
  const body = (await response.json()) as { code: string; requestId: string };
  assert.equal(body.code, "enrichment_work_item_not_found");
  assert.equal(body.requestId, "ewi-missing");
});

test("propose, GET, confirm, and idempotent confirm use the demo actor", async () => {
  const store = new MemoryLedgerStore();
  const created = await store.createEvidence({
    actorId: "user:test",
    title: "Posted voucher",
    originalFilename: "posted.pdf",
    mimeType: "application/pdf",
    modalities: ["upload"],
  });
  await store.applyReviewDecision(created.review.id, "approve", { actorId: "user:test" });
  const app = createTestApp(store);

  const proposed = await app.request("http://localhost/api/enrichment-work-items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      targetKind: "voucher",
      targetId: created.voucher.id,
      proposedChange: { kind: "noop" },
      source: "ui",
      idempotencyKey: "route-test:posted",
      actorId: "spoofed-client",
    }),
  });
  assert.equal(proposed.status, 201);
  const item = (await proposed.json()) as { id: string; createdBy: string; status: string };
  assert.equal(item.createdBy, "user_founder");
  assert.equal(item.status, "pending_confirmation");

  const fetched = await app.request(`http://localhost/api/enrichment-work-items/${item.id}`);
  assert.equal(fetched.status, 200);
  assert.equal(((await fetched.json()) as { id: string }).id, item.id);

  const confirmed = await app.request(`http://localhost/api/enrichment-work-items/${item.id}/confirm`, {
    method: "POST",
  });
  assert.equal(confirmed.status, 200);
  const confirmedBody = (await confirmed.json()) as { status: string; resultingEventIds: string[] };
  assert.equal(confirmedBody.status, "confirmed");
  assert.deepEqual(confirmedBody.resultingEventIds, []);

  const replay = await app.request(`http://localhost/api/enrichment-work-items/${item.id}/confirm`, {
    method: "POST",
  });
  assert.equal(replay.status, 200);
  assert.deepEqual((await replay.json()) as unknown, confirmedBody);
});
