import assert from "node:assert/strict";
import { test } from "node:test";

import type { LedgerEvent } from "@jpx-accounting/contracts";
import { buildListProjection, buildProjectRegistryFromEvents, buildProjectsList } from "@jpx-accounting/domain";

function event(id: string, eventType: LedgerEvent["eventType"], payload: Record<string, unknown>): LedgerEvent {
  return {
    id,
    organizationId: "org_jpx",
    workspaceId: "workspace_main",
    aggregateType: "ledger",
    aggregateId: "voucher_1",
    eventType,
    actorId: "user:test",
    occurredAt: "2026-08-09T10:00:00.000Z",
    payload,
    previousHash: id === "evt_project" ? "GENESIS" : "sha256_project",
    eventHash: `sha256_${id.padEnd(64, "0").slice(0, 64)}`,
    digestDate: "2026-08-09",
  };
}

test("project registry derives archive status without rewriting registration", () => {
  const events = [
    event("evt_project", "ProjectRegistered", {
      projectId: "proj_1",
      name: "Bridge retrofit",
      status: "active",
    }),
    event("evt_archive", "ProjectArchived", { projectId: "proj_1" }),
  ];

  assert.deepEqual(buildProjectRegistryFromEvents(events), [
    {
      projectId: "proj_1",
      name: "Bridge retrofit",
      status: "archived",
    },
  ]);
  assert.equal(events[0]?.payload.status, "active");
});

test("project registry keeps the first registration authoritative", () => {
  const events = [
    event("evt_project", "ProjectRegistered", {
      projectId: "proj_1",
      name: "Bridge retrofit",
      status: "active",
    }),
    event("evt_archive", "ProjectArchived", { projectId: "proj_1" }),
    event("evt_duplicate", "ProjectRegistered", {
      projectId: "proj_1",
      name: "Rewritten project",
      status: "active",
    }),
  ];

  assert.deepEqual(buildProjectRegistryFromEvents(events), [
    {
      projectId: "proj_1",
      name: "Bridge retrofit",
      status: "archived",
    },
  ]);
});

test("projects list counts active project line enrichments", () => {
  const rows = buildProjectsList([
    event("evt_project", "ProjectRegistered", {
      projectId: "proj_1",
      name: "Bridge retrofit",
      status: "active",
    }),
    event("evt_enrichment", "LineEnrichmentRecorded", {
      lineId: "ln_1",
      enrichmentType: "project",
      enrichmentId: "le_1",
      payload: { projectId: "proj_1" },
    }),
  ]);

  assert.deepEqual(rows, [
    {
      id: "proj_1",
      kind: "project",
      name: "Bridge retrofit",
      status: "active",
      activityCount: 1,
    },
  ]);
});

test("projects list excludes superseded assignments from activity counts", () => {
  const rows = buildProjectsList([
    event("evt_project", "ProjectRegistered", {
      projectId: "proj_1",
      name: "Bridge retrofit",
      status: "active",
    }),
    event("evt_project_2", "ProjectRegistered", {
      projectId: "proj_2",
      name: "Rail extension",
      status: "active",
    }),
    event("evt_enrichment", "LineEnrichmentRecorded", {
      lineId: "ln_1",
      enrichmentType: "project",
      enrichmentId: "le_1",
      payload: { projectId: "proj_1" },
    }),
    event("evt_superseded", "LineEnrichmentSuperseded", {
      lineId: "ln_1",
      priorEnrichmentId: "le_1",
      replacementEnrichmentId: "le_2",
    }),
    event("evt_replacement", "LineEnrichmentRecorded", {
      lineId: "ln_1",
      enrichmentType: "project",
      enrichmentId: "le_2",
      payload: { projectId: "proj_2" },
    }),
  ]);

  assert.deepEqual(
    rows.map(({ id, activityCount }) => ({ id, activityCount })),
    [
      { id: "proj_1", activityCount: 0 },
      { id: "proj_2", activityCount: 1 },
    ],
  );
});

test("project list builder is registered on the generic projection seam", () => {
  const events = [
    event("evt_project", "ProjectRegistered", {
      projectId: "proj_1",
      name: "Bridge retrofit",
      status: "active",
    }),
  ];

  assert.deepEqual(buildListProjection("project", events), buildProjectsList(events));
  assert.deepEqual(buildListProjection("unknown", events), []);
});
