import type { LedgerEvent } from "@jpx-accounting/contracts";

export type ListProjectionRow = {
  id: string;
  kind: string;
  [key: string]: unknown;
};

/**
 * Wave 5 framework seam. Workflow verticals register concrete builders in
 * Waves 6a–6e; unknown kinds stay honest and return no rows.
 */
export function buildListProjection(_kind: string, _events: LedgerEvent[]): ListProjectionRow[] {
  return [];
}
