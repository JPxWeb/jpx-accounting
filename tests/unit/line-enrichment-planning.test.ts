import assert from "node:assert/strict";
import { test } from "node:test";

import type { EnrichmentWorkItem } from "@jpx-accounting/contracts";
import { buildLineEnrichmentsFromEvents, planPostPostEnrichmentConfirm } from "@jpx-accounting/domain";
import { MemoryLedgerStore } from "@jpx-accounting/domain/store";

function workItem(proposedChange: EnrichmentWorkItem["proposedChange"]): EnrichmentWorkItem {
  return {
    id: "ewi_1",
    organizationId: "org_jpx",
    workspaceId: "workspace_main",
    targetKind: "line",
    targetId: "ln_1",
    proposedChange,
    status: "pending_confirmation",
    source: "ui",
    idempotencyKey: "key_1",
    createdAt: "2026-08-09T10:00:00.000Z",
    createdBy: "user:abc",
  };
}

const postedTargets = {
  postedVoucherIds: new Set(["voucher_1"]),
  postedLineIds: new Set(["ln_1"]),
};

test("line enrichment record emits one typed event and never reposts", () => {
  const plan = planPostPostEnrichmentConfirm({
    workItem: workItem({
      kind: "line_enrichment_record",
      lineId: "ln_1",
      enrichmentType: "project",
      payload: { projectId: "proj_1" },
    }),
    actorId: "user:abc",
    ...postedTargets,
  });

  assert.deepEqual(
    plan.events.map((event) => event.eventType),
    ["LineEnrichmentRecorded"],
  );
  assert.equal(plan.events[0]?.payload.lineId, "ln_1");
  assert.match(String(plan.events[0]?.payload.enrichmentId), /^le_/);
  assert.ok(plan.events.every((event) => event.eventType !== "PostedToLedger"));
});

test("supersession emits superseded then replacement record without reposting", () => {
  const priorEvent = {
    eventType: "LineEnrichmentRecorded" as const,
    occurredAt: "2026-08-09T09:00:00.000Z",
    actorId: "user:prior",
    payload: {
      lineId: "ln_1",
      enrichmentId: "le_old",
      enrichmentType: "project",
      payload: { projectId: "proj_1" },
    },
  };
  const plan = planPostPostEnrichmentConfirm({
    workItem: workItem({
      kind: "line_enrichment_supersede",
      lineId: "ln_1",
      priorEnrichmentId: "le_old",
      replacement: { enrichmentType: "project", payload: { projectId: "proj_2" } },
    }),
    actorId: "user:abc",
    ...postedTargets,
    lineEnrichmentEvents: [priorEvent],
  });

  assert.deepEqual(
    plan.events.map((event) => event.eventType),
    ["LineEnrichmentSuperseded", "LineEnrichmentRecorded"],
  );
  assert.equal(plan.events[0]?.payload.replacementEnrichmentId, plan.events[1]?.payload.enrichmentId);
  assert.ok(plan.events.every((event) => event.eventType !== "PostedToLedger"));

  const history = buildLineEnrichmentsFromEvents([priorEvent, ...plan.events]);
  assert.equal(history.find((entry) => entry.enrichmentId === "le_old")?.superseded, true);
  assert.equal(history.find((entry) => entry.enrichmentId !== "le_old")?.superseded, false);
});

test("supersession rejects an unknown or already superseded prior enrichment", () => {
  const proposedChange = {
    kind: "line_enrichment_supersede" as const,
    lineId: "ln_1",
    priorEnrichmentId: "le_old",
    replacement: { enrichmentType: "project", payload: { projectId: "proj_2" } },
  };
  const priorEvent = {
    eventType: "LineEnrichmentRecorded" as const,
    occurredAt: "2026-08-09T09:00:00.000Z",
    actorId: "user:prior",
    payload: {
      lineId: "ln_1",
      enrichmentId: "le_old",
      enrichmentType: "project",
      payload: { projectId: "proj_1" },
    },
  };
  const supersededEvent = {
    eventType: "LineEnrichmentSuperseded" as const,
    occurredAt: "2026-08-09T09:30:00.000Z",
    actorId: "user:prior",
    payload: {
      lineId: "ln_1",
      priorEnrichmentId: "le_old",
      replacementEnrichmentId: "le_new",
    },
  };

  assert.throws(
    () =>
      planPostPostEnrichmentConfirm({
        workItem: workItem(proposedChange),
        actorId: "user:abc",
        ...postedTargets,
        lineEnrichmentEvents: [],
      }),
    /active line enrichment/i,
  );
  assert.throws(
    () =>
      planPostPostEnrichmentConfirm({
        workItem: workItem(proposedChange),
        actorId: "user:abc",
        ...postedTargets,
        lineEnrichmentEvents: [priorEvent, supersededEvent],
      }),
    /active line enrichment/i,
  );
});

test("MemoryLedgerStore confirms only active line-enrichment supersession", async () => {
  const store = new MemoryLedgerStore();
  const created = await store.createEvidence({
    actorId: "user:test",
    title: "Line enrichment",
    originalFilename: "line.pdf",
    mimeType: "application/pdf",
    modalities: ["upload"],
  });
  await store.applyReviewDecision(created.review.id, "approve", { actorId: "user:test" });
  const posted = (await store.getEvents()).find((event) => event.eventType === "PostedToLedger");
  const lineId = (posted?.payload.lines as Array<{ lineId?: string }> | undefined)?.[0]?.lineId;
  assert.ok(lineId);

  const record = await store.proposeEnrichmentWorkItem({
    actorId: "user:test",
    targetKind: "line",
    targetId: lineId,
    proposedChange: {
      kind: "line_enrichment_record",
      lineId,
      enrichmentType: "project",
      payload: { projectId: "proj_1" },
    },
    source: "ui",
    idempotencyKey: "line-record",
  });
  const confirmedRecord = await store.confirmEnrichmentWorkItem(record.id, { actorId: "user:test" });
  const recordedEvent = (await store.getEvents()).find((event) =>
    confirmedRecord.resultingEventIds?.includes(event.id),
  );
  const enrichmentId = recordedEvent?.payload.enrichmentId;
  assert.equal(typeof enrichmentId, "string");

  const supersede = async (idempotencyKey: string) => {
    const item = await store.proposeEnrichmentWorkItem({
      actorId: "user:test",
      targetKind: "line",
      targetId: lineId,
      proposedChange: {
        kind: "line_enrichment_supersede",
        lineId,
        priorEnrichmentId: String(enrichmentId),
        replacement: { enrichmentType: "project", payload: { projectId: "proj_2" } },
      },
      source: "ui",
      idempotencyKey,
    });
    return store.confirmEnrichmentWorkItem(item.id, { actorId: "user:test" });
  };

  await supersede("line-supersede");
  await assert.rejects(() => supersede("line-supersede-stale"), /active line enrichment/i);
});

test("replay keeps the first supersession and ignores a stale second one", () => {
  const recorded = {
    eventType: "LineEnrichmentRecorded" as const,
    occurredAt: "2026-08-09T09:00:00.000Z",
    actorId: "user:prior",
    payload: { lineId: "ln_1", enrichmentId: "le_old", enrichmentType: "project", payload: { projectId: "proj_1" } },
  };
  const firstSupersession = {
    eventType: "LineEnrichmentSuperseded" as const,
    occurredAt: "2026-08-09T09:30:00.000Z",
    actorId: "user:first",
    payload: { lineId: "ln_1", priorEnrichmentId: "le_old", replacementEnrichmentId: "le_new" },
  };
  const staleSupersession = {
    eventType: "LineEnrichmentSuperseded" as const,
    occurredAt: "2026-08-09T10:00:00.000Z",
    actorId: "user:stale",
    payload: { lineId: "ln_1", priorEnrichmentId: "le_old", replacementEnrichmentId: "le_other" },
  };

  const history = buildLineEnrichmentsFromEvents([recorded, firstSupersession, staleSupersession]);
  const prior = history.find((entry) => entry.enrichmentId === "le_old");

  assert.equal(prior?.superseded, true);
  assert.equal(prior?.supersededBy, "user:first");
  assert.equal(prior?.supersededAt, "2026-08-09T09:30:00.000Z");
  assert.equal(prior?.replacementEnrichmentId, "le_new");
});

test("line proposal cannot target a different posted line", () => {
  assert.throws(
    () =>
      planPostPostEnrichmentConfirm({
        workItem: workItem({
          kind: "line_enrichment_record",
          lineId: "ln_other",
          enrichmentType: "project",
          payload: {},
        }),
        actorId: "user:abc",
        ...postedTargets,
      }),
    /target|line|supported/i,
  );
});
