import assert from "node:assert/strict";
import test from "node:test";

import { createAccountingApiClient } from "@jpx-accounting/api-client";
import type { EnrichmentWorkItem } from "@jpx-accounting/contracts";

const BASE_URL = "http://api.test";

const pendingItem: EnrichmentWorkItem = {
  id: "ewi_1",
  organizationId: "org_jpx",
  workspaceId: "workspace_main",
  targetKind: "voucher",
  targetId: "voucher_1",
  proposedChange: { kind: "noop" },
  status: "pending_confirmation",
  source: "ui",
  idempotencyKey: "ui:1",
  createdAt: "2026-08-09T10:00:00.000Z",
  createdBy: "user:abc",
};

type CapturedRequest = { url: string; init: RequestInit | undefined };

function captureFetch(t: test.TestContext, responseFor: (url: string) => EnrichmentWorkItem): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    captured.push({ url, init });
    return new Response(JSON.stringify(responseFor(url)), {
      status: url.endsWith("/api/enrichment-work-items") ? 201 : 200,
      headers: { "content-type": "application/json" },
    });
  });
  return captured;
}

test("proposeEnrichmentWorkItem posts the contract input", async (t) => {
  const captured = captureFetch(t, () => pendingItem);
  const client = createAccountingApiClient({ baseUrl: BASE_URL, runtimeMode: "normal" });
  const input = {
    targetKind: "voucher" as const,
    targetId: "voucher_1",
    proposedChange: { kind: "noop" as const },
    source: "ui" as const,
    idempotencyKey: "ui:1",
    actorId: "spoofed-client",
  };

  const result = await client.proposeEnrichmentWorkItem(input);

  assert.deepEqual(result, pendingItem);
  assert.equal(captured[0]?.url, `${BASE_URL}/api/enrichment-work-items`);
  assert.equal(captured[0]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(captured[0]?.init?.body)), {
    targetKind: "voucher",
    targetId: "voucher_1",
    proposedChange: { kind: "noop" },
    source: "ui",
    idempotencyKey: "ui:1",
  });
});

test("demo fallback strips client-supplied actor attribution", async () => {
  const client = createAccountingApiClient({ runtimeMode: "demo" });
  const snapshot = await client.getSnapshot();
  const review = snapshot.reviews.find((candidate) => candidate.status === "needs-review");
  assert.ok(review);
  await client.approveReview(review.id);

  const input = {
    targetKind: "voucher" as const,
    targetId: review.voucherId,
    proposedChange: { kind: "noop" as const },
    source: "ui" as const,
    idempotencyKey: `ui:${review.voucherId}`,
    actorId: "spoofed-client",
  };
  const item = await client.proposeEnrichmentWorkItem(input);

  assert.notEqual(item.createdBy, "spoofed-client");
});

test("get, confirm, and reject enrichment work items use their dedicated routes", async (t) => {
  const captured = captureFetch(t, (url) => ({
    ...pendingItem,
    status: url.endsWith("/confirm") ? "confirmed" : url.endsWith("/reject") ? "rejected" : "pending_confirmation",
  }));
  const client = createAccountingApiClient({ baseUrl: BASE_URL, runtimeMode: "normal" });

  const fetched = await client.getEnrichmentWorkItem("ewi_1");
  const confirmed = await client.confirmEnrichmentWorkItem("ewi_1");
  const rejected = await client.rejectEnrichmentWorkItem("ewi_1");

  assert.equal(fetched?.status, "pending_confirmation");
  assert.equal(confirmed.status, "confirmed");
  assert.equal(rejected.status, "rejected");
  assert.deepEqual(
    captured.map(({ url, init }) => [url, init?.method ?? "GET"]),
    [
      [`${BASE_URL}/api/enrichment-work-items/ewi_1`, "GET"],
      [`${BASE_URL}/api/enrichment-work-items/ewi_1/confirm`, "POST"],
      [`${BASE_URL}/api/enrichment-work-items/ewi_1/reject`, "POST"],
    ],
  );
});
