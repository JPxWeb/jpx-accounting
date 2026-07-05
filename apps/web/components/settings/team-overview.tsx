"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { apiClient } from "../../lib/client";
import { SectionLabel } from "../ui/section-label";
import { StatusBadge } from "../ui/status-badge";

/**
 * Sentinel actor every mutation is attributed to until real auth lands —
 * matches the id the API and the demo store stamp on ledger events.
 */
const CURRENT_ACTOR_ID = "user_founder";

/**
 * Honest single-user team state (Phase 6 Task 6.2): the current actor, the
 * attribution that already exists on every ledger event (read live from the
 * integrity summary's recent-event tail — the only "roles" that exist today),
 * and the planned free accountant seat as a design commitment. No invite
 * form, because invitations are not built.
 */
export function TeamOverview() {
  const t = useTranslations("settings.team");

  // Same query key as the dashboard/compliance integrity views — one cache
  // entry; the recent-event tail carries the actor attribution shown here.
  const integrityQuery = useQuery({
    queryKey: ["integrity"],
    queryFn: () => apiClient.getIntegritySummary(),
  });
  const recentEvents = integrityQuery.data?.recentEvents;

  const actorCounts = new Map<string, number>();
  for (const event of recentEvents ?? []) {
    actorCounts.set(event.actorId, (actorCounts.get(event.actorId) ?? 0) + 1);
  }

  return (
    <div className="space-y-6" data-testid="team-overview">
      <section className="glass-panel rounded-xl p-5" data-testid="team-current-actor">
        <SectionLabel>{t("currentTitle")}</SectionLabel>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="font-mono text-lg font-semibold text-foreground">{CURRENT_ACTOR_ID}</p>
          <StatusBadge status={t("currentRole")} variant="accent" />
        </div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("currentBody")}</p>
      </section>

      <section className="glass-panel rounded-xl p-5" data-testid="team-recent-actors">
        <SectionLabel>{t("actorsTitle")}</SectionLabel>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("actorsBody")}</p>
        {recentEvents ? (
          actorCounts.size === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">{t("actorsEmpty")}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {[...actorCounts.entries()].map(([actorId, count]) => (
                <li
                  key={actorId}
                  data-testid="team-actor-row"
                  className="glass-panel-soft flex items-center justify-between gap-3 rounded-lg px-3 py-2"
                >
                  <p className="truncate font-mono text-sm text-foreground">{actorId}</p>
                  <p className="shrink-0 text-caption tabular-nums text-muted-foreground">
                    {t("actorEvents", { count })}
                  </p>
                </li>
              ))}
            </ul>
          )
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            {integrityQuery.isError ? t("actorsUnavailable") : t("actorsLoading")}
          </p>
        )}
      </section>

      <section className="glass-panel rounded-xl p-5" data-testid="team-accountant-seat">
        <div className="flex items-start justify-between gap-3">
          <SectionLabel>{t("seatTitle")}</SectionLabel>
          <StatusBadge status={t("seatBadge")} variant="info" />
        </div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("seatBody")}</p>
        <p
          className="mt-4 rounded-lg bg-warning-soft px-4 py-3 text-sm leading-6 text-warning"
          data-testid="team-invite-note"
        >
          {t("inviteNote")}
        </p>
      </section>
    </div>
  );
}
