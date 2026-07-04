"use client";

import type { ObservationSeverity } from "@jpx-accounting/contracts";
import { useTranslations } from "next-intl";
import Link from "next/link";

import type { DashboardData } from "../use-dashboard-data";

const VISIBLE_OBSERVATIONS = 3;

const SEVERITY_DOT: Record<ObservationSeverity, string> = {
  critical: "bg-danger",
  warning: "bg-warning",
  info: "bg-info",
};

const SEVERITY_TEXT: Record<ObservationSeverity, string> = {
  critical: "text-danger",
  warning: "text-warning",
  info: "text-info",
};

/**
 * Top observations from the deterministic engine, ranked (severity → detector
 * priority → id). Every title is `t(titleKey, params)` where the params were
 * copied from the pack/snapshot the widgets already render — observations can
 * never contradict the numbers next to them. Severity shows as dot + TEXT
 * (never color alone); the action chip links to the observation's provenance
 * surface.
 */
export function ObservationsWidget({ data }: { data: DashboardData }) {
  const t = useTranslations("dashboard.widgets.observations");
  const tDashboard = useTranslations("dashboard");
  const tObservations = useTranslations("observations");

  if (!data.pack || !data.snapshot) {
    return <p className="text-sm text-muted-foreground">{tDashboard("loading")}</p>;
  }

  const observations = data.observations.slice(0, VISIBLE_OBSERVATIONS);
  if (observations.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  }

  return (
    <ul className="space-y-3">
      {observations.map((observation) => (
        <li key={observation.id} data-observation={observation.detector}>
          <p className="flex items-center gap-2 text-caption font-semibold">
            <span aria-hidden="true" className={`size-2 rounded-full ${SEVERITY_DOT[observation.severity]}`} />
            <span className={SEVERITY_TEXT[observation.severity]}>{t(`severity.${observation.severity}`)}</span>
          </p>
          <p className="mt-1 text-sm leading-6 text-foreground">
            {tObservations(observation.titleKey, observation.params)}
          </p>
          {observation.action ? (
            <Link
              href={observation.action.href}
              data-testid="observation-chip"
              className="mt-1 inline-flex rounded-md bg-primary-soft px-2 py-1 text-caption font-semibold text-primary hover:underline"
            >
              {tObservations(observation.action.labelKey)}
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
