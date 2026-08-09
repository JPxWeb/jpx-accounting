import {
  projectArchivedPayloadSchema,
  projectLineEnrichmentPayloadSchema,
  projectRegisteredPayloadSchema,
  type LedgerEvent,
  type ProjectProjection,
  type ProjectsListRow,
} from "@jpx-accounting/contracts";

import { buildLineEnrichmentsFromEvents } from "../enrichment-projections";
import { buildJournal, collectLedgerLinesFromEvents } from "../projections";

export type { ProjectsListRow } from "@jpx-accounting/contracts";

export function buildProjectRegistryFromEvents(events: LedgerEvent[]): ProjectProjection[] {
  const projects = new Map<string, ProjectProjection>();

  for (const event of events) {
    if (event.eventType === "ProjectRegistered") {
      const project = projectRegisteredPayloadSchema.parse(event.payload);
      // Registration is immutable: a duplicate event must not rename or
      // reactivate an existing project during replay.
      if (projects.has(project.projectId)) continue;
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
  const projects = new Map<string, ProjectsListRow>(
    buildProjectRegistryFromEvents(events).map((project) => [
      project.projectId,
      {
        id: project.projectId,
        kind: "project" as const,
        name: project.name,
        status: project.status,
        activityCount: 0,
        voucherIds: [],
      },
    ]),
  );
  // Reuse the canonical journal projection so payload `ln_` ids and
  // projection-only legacy ids follow the single Wave 5 identity rule.
  const voucherIdByLineId = new Map(
    buildJournal(collectLedgerLinesFromEvents(events)).flatMap((line) =>
      line.lineId === undefined ? [] : [[line.lineId, line.voucherId] as const],
    ),
  );

  for (const enrichment of buildLineEnrichmentsFromEvents(events)) {
    if (enrichment.superseded || enrichment.enrichmentType !== "project") continue;

    const projectPayload = projectLineEnrichmentPayloadSchema.safeParse(enrichment.payload);
    if (!projectPayload.success) continue;

    const project = projects.get(projectPayload.data.projectId);
    if (project) {
      project.activityCount += 1;
      const voucherId = voucherIdByLineId.get(enrichment.lineId);
      if (voucherId !== undefined && !project.voucherIds.includes(voucherId)) {
        project.voucherIds.push(voucherId);
      }
    }
  }

  return [...projects.values()];
}
