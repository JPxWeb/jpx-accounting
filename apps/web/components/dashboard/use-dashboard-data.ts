"use client";

import type {
  CompanySettings,
  IntegritySummary,
  Observation,
  ReportPack,
  TaxDeadline,
  WorkspaceSnapshot,
} from "@jpx-accounting/contracts";
import { buildTaxTimeline, currentMonthToken, currentVatPeriodToken, localTodayIso } from "@jpx-accounting/domain";
import { buildObservations } from "@jpx-accounting/reporting";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { apiClient } from "../../lib/client";
import { useWorkspaceProfile } from "../providers/workspace-profile-provider";

/**
 * ONE data layer for all nine dashboard widgets (Task 5.8). Widgets share
 * queries instead of fetching per-widget: the workspace snapshot, the
 * current-month `ReportPack`, the VAT-period pack (only when the VAT period
 * differs from the calendar month — plan finding 15), the integrity summary,
 * and company settings. Query keys match the rest of the app (`["workspace"]`,
 * `["reports","pack",<token>]`, `["company-settings"]`, `["integrity"]`) so
 * the cache is shared with the queue, reports, and settings screens.
 *
 * Observations and the statutory tax timeline are client-computed from those
 * fetched inputs (no endpoint — plan finding 5), memoized per input identity.
 */

export type DashboardData = {
  snapshot: WorkspaceSnapshot | undefined;
  /** Current calendar-month pack — feeds cash/result/bridge/observations. */
  pack: ReportPack | undefined;
  /** Pack for the workspace's current VAT period (may be the month pack). */
  vatPack: ReportPack | undefined;
  integrity: IntegritySummary | undefined;
  settings: CompanySettings | null | undefined;
  deadlines: TaxDeadline[];
  observations: Observation[];
  /** Injected local day the timeline/observations were computed for. */
  today: string;
  /** Workspace-load failure with nothing cached — the screen-level error. */
  snapshotError: unknown;
};

export function useDashboardData(): DashboardData {
  const profile = useWorkspaceProfile();
  const today = localTodayIso();
  const monthToken = currentMonthToken(today);
  const vatToken = currentVatPeriodToken(profile.vatPeriod, profile.fiscalYearStart, today);

  const workspaceQuery = useQuery({
    queryKey: ["workspace"],
    queryFn: () => apiClient.getSnapshot(),
    // Match the review queue: demo MemoryLedgerStore mutates reviews in place,
    // which structural sharing would collapse back to stale references.
    structuralSharing: false,
  });

  const packQuery = useQuery({
    queryKey: ["reports", "pack", monthToken],
    queryFn: () => apiClient.getReportPack(monthToken),
  });

  const vatPackQuery = useQuery({
    queryKey: ["reports", "pack", vatToken],
    queryFn: () => apiClient.getReportPack(vatToken),
    enabled: vatToken !== monthToken,
  });

  const integrityQuery = useQuery({
    queryKey: ["integrity"],
    queryFn: () => apiClient.getIntegritySummary(),
  });

  const settingsQuery = useQuery({
    queryKey: ["company-settings"],
    queryFn: () => apiClient.getCompanySettings(),
  });

  const deadlines = useMemo(
    () =>
      buildTaxTimeline({
        profile: { vatPeriod: profile.vatPeriod, fiscalYearStart: profile.fiscalYearStart },
        today,
      }),
    [profile.vatPeriod, profile.fiscalYearStart, today],
  );

  const snapshot = workspaceQuery.data;
  const pack = packQuery.data;

  const observations = useMemo(
    () => (pack && snapshot ? buildObservations({ pack, snapshot, deadlines, today }) : []),
    [pack, snapshot, deadlines, today],
  );

  return {
    snapshot,
    pack,
    vatPack: vatToken === monthToken ? packQuery.data : vatPackQuery.data,
    integrity: integrityQuery.data,
    settings: settingsQuery.data,
    deadlines,
    observations,
    today,
    snapshotError: workspaceQuery.error,
  };
}
