"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { parseAsString, parseAsStringEnum, useQueryState } from "nuqs";
import { useEffect } from "react";

import { Dashboard } from "../dashboard/dashboard";
import { ReviewQueueView } from "../today/review-queue-view";

/**
 * `/today` view switch (Task 5.8): the advisory dashboard is the default; the
 * full review queue (extracted verbatim into `review-queue-view.tsx`, all
 * testids and J/K/Y/N/E/B hotkeys intact) renders at `?view=queue`. A present
 * `?review=` deep-link param FORCES the queue so command-palette links keep
 * landing on a focused card unmodified. Review hotkeys stay queue-scoped —
 * they unmount with the queue and never fight dnd-kit's keyboard sensor.
 */

const todayViews = ["dashboard", "queue"] as const;
type TodayView = (typeof todayViews)[number];

export function TodayScreen() {
  const [view, setView] = useQueryState("view", parseAsStringEnum<TodayView>([...todayViews]).withDefault("dashboard"));
  const [reviewParam] = useQueryState("review", parseAsString);

  // Pin the forced queue view into the URL: the queue drops `?review=` when
  // focus moves to another card, and without `?view=queue` that would snap the
  // user back to the dashboard mid-interaction.
  useEffect(() => {
    if (reviewParam && view !== "queue") {
      void setView("queue");
    }
  }, [reviewParam, view, setView]);

  const effectiveView: TodayView = reviewParam ? "queue" : view;
  const toggle = <TodayViewToggle active={effectiveView} />;

  return effectiveView === "queue" ? <ReviewQueueView viewToggle={toggle} /> : <Dashboard viewToggle={toggle} />;
}

function TodayViewToggle({ active }: { active: TodayView }) {
  const t = useTranslations("dashboard.view");

  const linkClass = (isActive: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition ${
      isActive ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div role="group" aria-label={t("label")} className="glass-panel-soft inline-flex rounded-lg p-1 print:hidden">
      <Link
        href="/today"
        data-testid="today-view-dashboard"
        aria-current={active === "dashboard" ? "page" : undefined}
        className={linkClass(active === "dashboard")}
      >
        {t("dashboard")}
      </Link>
      <Link
        href="/today?view=queue"
        data-testid="today-view-queue"
        data-tour="today-view-queue"
        aria-current={active === "queue" ? "page" : undefined}
        className={linkClass(active === "queue")}
      >
        {t("queue")}
      </Link>
    </div>
  );
}
