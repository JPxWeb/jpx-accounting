import assert from "node:assert/strict";
import { test } from "node:test";

import {
  enrichmentProposalSchema,
  eventTypeSchema,
  projectArchivedPayloadSchema,
  projectLineEnrichmentPayloadSchema,
  projectRegisteredPayloadSchema,
  projectsListSchema,
  registerProjectInputSchema,
} from "@jpx-accounting/contracts";

test("project event types exist", () => {
  assert.ok(eventTypeSchema.options.includes("ProjectRegistered"));
  assert.ok(eventTypeSchema.options.includes("ProjectArchived"));
});

test("project line enrichment requires projectId and allows object allocation", () => {
  const row = projectLineEnrichmentPayloadSchema.parse({
    projectId: "proj_1",
    activityCode: "A1",
    objectCode: "OBJ-10",
  });

  assert.equal(row.projectId, "proj_1");
  assert.equal(row.objectCode, "OBJ-10");
  assert.equal(projectLineEnrichmentPayloadSchema.safeParse({ projectId: "" }).success, false);
});

test("project registration validates lifecycle fields", () => {
  const row = projectRegisteredPayloadSchema.parse({
    projectId: "proj_1",
    name: "Bridge retrofit",
    status: "active",
  });

  assert.equal(row.status, "active");
  assert.deepEqual(registerProjectInputSchema.parse({ projectId: "proj_1", name: "Bridge retrofit" }), {
    projectId: "proj_1",
    name: "Bridge retrofit",
  });
});

test("project archive payload identifies the immutable registry entry", () => {
  assert.deepEqual(projectArchivedPayloadSchema.parse({ projectId: "proj_1" }), {
    projectId: "proj_1",
  });
  assert.equal(projectArchivedPayloadSchema.safeParse({ projectId: "" }).success, false);
});

test("project assignment is a typed enrichment proposal", () => {
  assert.deepEqual(
    enrichmentProposalSchema.parse({
      kind: "project_assignment",
      projectId: "proj_1",
      activityCode: "A1",
      objectCode: "OBJ-10",
    }),
    {
      kind: "project_assignment",
      projectId: "proj_1",
      activityCode: "A1",
      objectCode: "OBJ-10",
    },
  );
});

test("projects list rows are contract validated", () => {
  assert.deepEqual(
    projectsListSchema.parse([
      {
        id: "proj_1",
        kind: "project",
        name: "Bridge retrofit",
        status: "active",
        activityCount: 2,
      },
    ]),
    [
      {
        id: "proj_1",
        kind: "project",
        name: "Bridge retrofit",
        status: "active",
        activityCount: 2,
      },
    ],
  );
});
