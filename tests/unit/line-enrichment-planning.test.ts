import assert from "node:assert/strict";
import { test } from "node:test";

import type { EnrichmentWorkItem } from "@jpx-accounting/contracts";
import { buildLineEnrichmentsFromEvents, planPostPostEnrichmentConfirm } from "@jpx-accounting/domain";

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
  const plan = planPostPostEnrichmentConfirm({
    workItem: workItem({
      kind: "line_enrichment_supersede",
      lineId: "ln_1",
      priorEnrichmentId: "le_old",
      replacement: { enrichmentType: "project", payload: { projectId: "proj_2" } },
    }),
    actorId: "user:abc",
    ...postedTargets,
  });

  assert.deepEqual(
    plan.events.map((event) => event.eventType),
    ["LineEnrichmentSuperseded", "LineEnrichmentRecorded"],
  );
  assert.equal(plan.events[0]?.payload.replacementEnrichmentId, plan.events[1]?.payload.enrichmentId);
  assert.ok(plan.events.every((event) => event.eventType !== "PostedToLedger"));

  const history = buildLineEnrichmentsFromEvents([
    {
      eventType: "LineEnrichmentRecorded",
      occurredAt: "2026-08-09T09:00:00.000Z",
      actorId: "user:prior",
      payload: {
        lineId: "ln_1",
        enrichmentId: "le_old",
        enrichmentType: "project",
        payload: { projectId: "proj_1" },
      },
    },
    ...plan.events,
  ]);
  assert.equal(history.find((entry) => entry.enrichmentId === "le_old")?.superseded, true);
  assert.equal(history.find((entry) => entry.enrichmentId !== "le_old")?.superseded, false);
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
