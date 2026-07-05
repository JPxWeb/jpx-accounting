"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";

import { apiClient } from "../../lib/client";
import { BFL_RETENTION_SOURCE } from "../../lib/legal-sources";
import { formatShortDate } from "../../lib/presentation";
import { useWorkspaceProfile } from "../providers/workspace-profile-provider";
import { SectionLabel } from "../ui/section-label";
import { VerifiedLedgerChip } from "../ui/verified-ledger-chip";

/**
 * Real compliance view (Phase 6 Task 6.2): the hash-chain verdict from
 * `GET /api/integrity` rendered through the shared `VerifiedLedgerChip`, the
 * chain facts (event count, BAS template, head hash, last event), the recent
 * event tail with actor attribution, and the statutory retention baseline the
 * append-only ledger exists to satisfy. Linkage verification only — the panel
 * never claims more than the check proves.
 */
export function ComplianceIntegrityPanel() {
  const t = useTranslations("settings.compliance");
  const { locale } = useWorkspaceProfile();

  // Same query key as the dashboard integrity widget — one cache entry.
  const integrityQuery = useQuery({
    queryKey: ["integrity"],
    queryFn: () => apiClient.getIntegritySummary(),
  });
  const integrity = integrityQuery.data;

  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-xl p-5" data-testid="compliance-integrity-panel">
        <SectionLabel>{t("chainLabel")}</SectionLabel>
        {integrity ? (
          <>
            <div className="mt-3">
              <VerifiedLedgerChip integrity={integrity} />
            </div>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="glass-panel-inset rounded-lg px-3 py-3">
                <dt className="text-eyebrow">{t("eventCount")}</dt>
                <dd className="mt-2 text-sm font-semibold tabular-nums text-foreground">{integrity.eventCount}</dd>
              </div>
              <div className="glass-panel-inset rounded-lg px-3 py-3">
                <dt className="text-eyebrow">{t("basTemplate")}</dt>
                <dd className="mt-2 text-sm font-semibold text-foreground">
                  {integrity.bas.template} · {t("basAccounts", { count: integrity.bas.accountCount })}
                </dd>
              </div>
              <div className="glass-panel-inset min-w-0 rounded-lg px-3 py-3">
                <dt className="text-eyebrow">{t("headHash")}</dt>
                {/* Seed timestamps (and the hashes derived from them) are
                    now-derived — masked so visual baselines stay date-stable. */}
                <dd
                  className="mt-2 truncate font-mono text-sm text-foreground"
                  title={integrity.headHash ?? undefined}
                  data-visual-mask
                >
                  {integrity.headHash ? `${integrity.headHash.slice(0, 12)}…` : "—"}
                </dd>
              </div>
              <div className="glass-panel-inset rounded-lg px-3 py-3">
                <dt className="text-eyebrow">{t("lastEvent")}</dt>
                <dd className="mt-2 text-sm font-semibold tabular-nums text-foreground" data-visual-mask>
                  {integrity.lastEventAt ? formatShortDate(integrity.lastEventAt, locale) : "—"}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">{t("scopeNote")}</p>

            <h2 className="mt-5 text-sm font-semibold text-foreground">{t("recentTitle")}</h2>
            {integrity.recentEvents.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">{t("recentEmpty")}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {integrity.recentEvents.map((event) => (
                  <li
                    key={event.id}
                    data-testid="integrity-recent-event"
                    className="glass-panel-soft flex items-center justify-between gap-3 rounded-lg px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm text-foreground">{event.eventType}</p>
                      <p className="mt-0.5 truncate text-caption text-muted-foreground">
                        {event.aggregateType} · {event.actorId}
                      </p>
                    </div>
                    <p className="shrink-0 text-caption tabular-nums text-muted-foreground" data-visual-mask>
                      {formatShortDate(event.occurredAt, locale)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            {integrityQuery.isError ? t("unavailable") : t("loading")}
          </p>
        )}
      </section>

      <section className="glass-panel rounded-xl p-5" data-testid="compliance-retention-statement">
        <SectionLabel>{t("retentionTitle")}</SectionLabel>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("retentionBody")}</p>
        <div className="mt-4 border-t border-border pt-3">
          <p className="text-eyebrow">{t("sourceLabel")}</p>
          <p className="mt-2 text-caption leading-5 text-muted-foreground">{BFL_RETENTION_SOURCE}</p>
        </div>
        <p className="mt-3 text-sm">
          <Link href="/settings/retention" className="font-semibold text-foreground underline">
            {t("retentionLink")}
          </Link>
        </p>
      </section>
    </div>
  );
}
