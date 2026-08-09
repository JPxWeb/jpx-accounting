import {
  projectArchivedPayloadSchema,
  projectLineEnrichmentPayloadSchema,
  projectRegisteredPayloadSchema,
  type LedgerEvent,
  type ProjectProjection,
  type ProjectsListRow,
} from "@jpx-accounting/contracts";

import { buildLineEnrichmentsFromEvents } from "../enrichment-projections";

export type { ProjectsListRow } from "@jpx-accounting/contracts";

export function buildProjectRegistryFromEvents(events: LedgerEvent[]): ProjectProjection[] {
  const projects = new Map<string, ProjectProjection>();

  for (const event of events) {
    if (event.eventType === "ProjectRegistered") {
      const project = projectRegisteredPayloadSchema.parse(event.payload);
      projects.set(project.projectId, project);
      continue;
    }

    if (event.eventType === "ProjectArchived") {
      const { projectId } = projectArchivedPayloadSchema.parse(event.payload);
      const project = projects.get(projectId);
      if (project) {
        projects.set(projectId, { ...project, status: "archived" });
      }
    }
  }

  return [...projects.values()];
}

export function buildProjectsList(events: LedgerEvent[]): ProjectsListRow[] {
  const projects = new Map(
    buildProjectRegistryFromEvents(events).map((project) => [
      project.projectId,
      {
        id: project.projectId,
        kind: "project" as const,
        name: project.name,
        status: project.status,
        activityCount: 0,
      },
    ]),
  );

  for (const enrichment of buildLineEnrichmentsFromEvents(events)) {
    if (enrichment.superseded || enrichment.enrichmentType !== "project") continue;

    const projectPayload = projectLineEnrichmentPayloadSchema.safeParse(enrichment.payload);
    if (!projectPayload.success) continue;

    const project = projects.get(projectPayload.data.projectId);
    if (project) project.activityCount += 1;
  }

  return [...projects.values()];
}
