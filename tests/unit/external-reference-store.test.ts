import assert from "node:assert/strict";
import { test } from "node:test";

import { ExternalReferenceNotFoundError } from "@jpx-accounting/domain";
import { MemoryLedgerStore } from "@jpx-accounting/domain/store";
import { LedgerStoreUnavailableError, UnavailableLedgerStore } from "../../services/api/src/runtime";
import { createApp } from "../../services/api/src/app";
import { createApiRuntimeDependencies } from "../../services/api/src/runtime";

async function createPostedVoucher(store: MemoryLedgerStore) {
  const created = await store.createEvidence({
    actorId: "user:test",
    title: "External reference invoice",
    originalFilename: "external-reference.pdf",
    mimeType: "application/pdf",
    modalities: ["upload"],
  });
  await store.applyReviewDecision(created.review.id, "approve", { actorId: "user:test" });
  return created;
}

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

test("appendVoucherExternalReference rejects non-https URLs", async () => {
  const store = new MemoryLedgerStore();
  const created = await createPostedVoucher(store);

  await assert.rejects(
    store.appendVoucherExternalReference(created.voucher.id, {
      url: "http://insecure.example",
      actorId: "user:test",
    }),
    /https/i,
  );
});

test("direct link and unlink append audit events without another posting", async () => {
  const store = new MemoryLedgerStore();
  const created = await createPostedVoucher(store);
  const postedBefore = (await store.getEvents()).filter((event) => event.eventType === "PostedToLedger").length;

  const linked = await store.appendVoucherExternalReference(created.voucher.id, {
    url: "https://example.com/invoice",
    label: "Supplier portal",
    actorId: "user:human",
  });
  const removed = await store.removeVoucherExternalReference(created.voucher.id, linked.refId, {
    actorId: "user:human",
  });

  assert.equal(linked.voucherId, created.voucher.id);
  assert.equal(linked.url, "https://example.com/invoice");
  assert.equal(linked.linkedBy, "user:human");
  assert.equal(linked.removed, false);
  assert.equal(removed.refId, linked.refId);
  assert.equal(removed.url, linked.url);
  assert.equal(removed.removed, true);
  assert.equal(removed.removedBy, "user:human");

  const events = await store.getEvents();
  assert.equal(events.filter((event) => event.eventType === "PostedToLedger").length, postedBefore);
  assert.deepEqual(
    events
      .filter((event) => event.aggregateId === created.voucher.id)
      .map((event) => event.eventType)
      .slice(-2),
    ["ExternalReferenceLinked", "ExternalReferenceRemoved"],
  );
});

test("workspace snapshot exposes replayed external references for the web data path", async () => {
  const store = new MemoryLedgerStore();
  const created = await createPostedVoucher(store);
  const linked = await store.appendVoucherExternalReference(created.voucher.id, {
    url: "https://example.com/snapshot-document",
    label: "Snapshot document",
    actorId: "user:human",
  });

  const snapshot = await store.getSnapshot();

  assert.deepEqual(snapshot.externalReferences, [linked]);
});

test("work-item confirmation emits external reference events idempotently", async () => {
  const store = new MemoryLedgerStore();
  const created = await createPostedVoucher(store);
  const proposed = await store.proposeEnrichmentWorkItem({
    actorId: "system:mcp",
    targetKind: "voucher",
    targetId: created.voucher.id,
    proposedChange: {
      kind: "external_reference_link",
      url: "https://example.com/mcp-document",
      label: "MCP proposal",
    },
    source: "mcp",
    idempotencyKey: "mcp:external-reference:1",
  });

  const first = await store.confirmEnrichmentWorkItem(proposed.id, { actorId: "user:confirmer" });
  const second = await store.confirmEnrichmentWorkItem(proposed.id, { actorId: "user:confirmer" });
  const linkedEvents = (await store.getEvents()).filter(
    (event) => event.eventType === "ExternalReferenceLinked" && event.aggregateId === created.voucher.id,
  );

  assert.equal(first.resultingEventIds?.length, 1);
  assert.deepEqual(second.resultingEventIds, first.resultingEventIds);
  assert.equal(linkedEvents.length, 1);
  assert.equal(linkedEvents[0]?.actorId, "user:confirmer");
  assert.equal(linkedEvents[0]?.payload.url, "https://example.com/mcp-document");

  const refId = linkedEvents[0]?.payload.refId;
  assert.equal(typeof refId, "string");
  const unlink = await store.proposeEnrichmentWorkItem({
    actorId: "system:mcp",
    targetKind: "voucher",
    targetId: created.voucher.id,
    proposedChange: { kind: "external_reference_unlink", refId: String(refId) },
    source: "mcp",
    idempotencyKey: "mcp:external-reference:unlink:1",
  });
  const unlinked = await store.confirmEnrichmentWorkItem(unlink.id, { actorId: "user:confirmer" });
  const replayedUnlink = await store.confirmEnrichmentWorkItem(unlink.id, { actorId: "user:confirmer" });
  const removedEvents = (await store.getEvents()).filter(
    (event) => event.eventType === "ExternalReferenceRemoved" && event.payload.refId === refId,
  );
  assert.equal(unlinked.resultingEventIds?.length, 1);
  assert.deepEqual(replayedUnlink.resultingEventIds, unlinked.resultingEventIds);
  assert.equal(removedEvents.length, 1);
});

test("work-item unlink rejects an inactive reference without appending an event", async () => {
  const store = new MemoryLedgerStore();
  const created = await createPostedVoucher(store);
  const proposed = await store.proposeEnrichmentWorkItem({
    actorId: "system:mcp",
    targetKind: "voucher",
    targetId: created.voucher.id,
    proposedChange: { kind: "external_reference_unlink", refId: "ref_missing" },
    source: "mcp",
    idempotencyKey: "mcp:external-reference:missing",
  });
  const eventCount = (await store.getEvents()).length;

  await assert.rejects(
    store.confirmEnrichmentWorkItem(proposed.id, { actorId: "user:confirmer" }),
    ExternalReferenceNotFoundError,
  );

  assert.equal((await store.getEvents()).length, eventCount);
  assert.equal((await store.getEnrichmentWorkItem(proposed.id))?.status, "pending_confirmation");
});

test("direct external-reference routes strip client actor attribution", async () => {
  const store = new MemoryLedgerStore();
  const created = await createPostedVoucher(store);
  const app = createTestApp(store);

  const linkedResponse = await app.request(`http://localhost/api/vouchers/${created.voucher.id}/external-references`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: "https://example.com/route-document",
      label: "Portal",
      actorId: "spoofed-client",
    }),
  });
  assert.equal(linkedResponse.status, 201);
  const linked = (await linkedResponse.json()) as { refId: string; linkedBy: string };
  assert.equal(linked.linkedBy, "user_founder");

  const removedResponse = await app.request(
    `http://localhost/api/vouchers/${created.voucher.id}/external-references/${linked.refId}/unlink`,
    { method: "POST" },
  );
  assert.equal(removedResponse.status, 200);
  assert.equal(((await removedResponse.json()) as { removedBy: string }).removedBy, "user_founder");

  const replayedRemoval = await app.request(
    `http://localhost/api/vouchers/${created.voucher.id}/external-references/${linked.refId}/unlink`,
    { method: "POST" },
  );
  assert.equal(replayedRemoval.status, 404);
  assert.equal(((await replayedRemoval.json()) as { code: string }).code, "external_reference_not_found");
});

test("UnavailableLedgerStore fails closed for direct external-reference methods", async () => {
  const store = new UnavailableLedgerStore("ledger unavailable");
  await assert.rejects(store.appendVoucherExternalReference(), LedgerStoreUnavailableError);
  await assert.rejects(store.removeVoucherExternalReference(), LedgerStoreUnavailableError);
});
