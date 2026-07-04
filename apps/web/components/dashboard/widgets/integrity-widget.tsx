"use client";

import { useTranslations } from "next-intl";

import { formatShortDate } from "../../../lib/presentation";
import { useWorkspaceProfile } from "../../providers/workspace-profile-provider";
import { VerifiedLedgerChip } from "../../ui/verified-ledger-chip";
import type { DashboardData } from "../use-dashboard-data";

/**
 * Ledger integrity: the shared `VerifiedLedgerChip` (hash-chain linkage
 * verdict + BAS template + event count) plus the head hash and last-event
 * date. Linkage verification only — removal/reordering/insertion are caught;
 * payload recomputation is a documented future note (plan finding 7).
 */
export function IntegrityWidget({ data }: { data: DashboardData }) {
  const t = useTranslations("dashboard.widgets.integrity");
  const tDashboard = useTranslations("dashboard");
  const { locale } = useWorkspaceProfile();
  const integrity = data.integrity;

  if (!integrity) {
    return <p className="text-sm text-muted-foreground">{tDashboard("loading")}</p>;
  }

  return (
    <div className="space-y-3">
      <VerifiedLedgerChip integrity={integrity} />
      {!integrity.chainLinked ? <p className="text-sm leading-6 text-warning">{t("brokenHint")}</p> : null}
      <dl className="space-y-1.5 text-sm">
        {integrity.lastEventAt ? (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">{t("lastEvent")}</dt>
            {/* Seed timestamps (and the hashes derived from them) are now-derived;
                masked so visual baselines stay date-stable. */}
            <dd className="font-medium tabular-nums" data-visual-mask>
              {formatShortDate(integrity.lastEventAt, locale)}
            </dd>
          </div>
        ) : null}
        {integrity.headHash ? (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">{t("headHash")}</dt>
            <dd className="min-w-0 truncate font-mono text-caption" title={integrity.headHash} data-visual-mask>
              {integrity.headHash.slice(0, 12)}…
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
