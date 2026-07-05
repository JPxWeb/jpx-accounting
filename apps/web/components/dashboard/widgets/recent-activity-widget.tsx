"use client";

import { useTranslations } from "next-intl";

import { formatShortDate } from "../../../lib/presentation";
import { useWorkspaceProfile } from "../../providers/workspace-profile-provider";
import type { DashboardData } from "../use-dashboard-data";

const VISIBLE_EVENTS = 5;

/** `EvidenceReceived` → `Evidence received` — event types are code, not copy. */
function humanizeEventType(eventType: string): string {
  const spaced = eventType.replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/**
 * The newest entries of the append-only event log, straight from the
 * integrity summary (`getEvents()` under the hood — no new store surface).
 * System actors (`system-*`) render as "System"; human actors keep their id.
 */
export function RecentActivityWidget({ data }: { data: DashboardData }) {
  const t = useTranslations("dashboard.widgets.recent-activity");
  const tDashboard = useTranslations("dashboard");
  const { locale } = useWorkspaceProfile();
  const integrity = data.integrity;

  if (!integrity) {
    return <p className="text-sm text-muted-foreground">{tDashboard("loading")}</p>;
  }

  const events = integrity.recentEvents.slice(0, VISIBLE_EVENTS);
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  }

  return (
    <ul className="space-y-2">
      {events.map((event) => (
        <li key={event.id} className="flex items-center justify-between gap-3 text-sm">
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{humanizeEventType(event.eventType)}</p>
            <p className="mt-0.5 truncate text-caption text-muted-foreground">
              {event.actorId.startsWith("system") ? t("system") : event.actorId}
            </p>
          </div>
          {/* Seed timestamps are now-derived; masked so visual baselines stay date-stable. */}
          <p className="shrink-0 text-caption tabular-nums text-muted-foreground" data-visual-mask>
            {formatShortDate(event.occurredAt, locale)}
          </p>
        </li>
      ))}
    </ul>
  );
}
