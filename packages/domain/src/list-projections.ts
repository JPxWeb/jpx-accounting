import type { LedgerEvent } from "@jpx-accounting/contracts";

import { buildProjectsList } from "./workflows/projects";

export type ListProjectionRow = {
  id: string;
  kind: string;
  [key: string]: unknown;
};

/**
 * Wave 5 framework seam. Workflow verticals register concrete builders in
 * Waves 6a–6e; unknown kinds stay honest and return no rows.
 */
export function buildListProjection(kind: string, events: LedgerEvent[]): ListProjectionRow[] {
  if (kind === "project") return buildProjectsList(events);
  return [];
}
