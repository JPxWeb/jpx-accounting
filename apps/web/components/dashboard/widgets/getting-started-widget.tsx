"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { loadAssistantThreads } from "../../../lib/assistant-thread-storage";
import {
  countCompletedMilestones,
  deriveMilestones,
  SEEDED_EVIDENCE_COUNT,
  type MilestoneId,
} from "../../../lib/onboarding/milestone-derivation";
import { CHECKLIST_TOUR_BY_STEP, type TourId } from "../../../lib/onboarding/tour-ids";
import { webRuntimeConfig } from "../../../lib/runtime-config";
import { useOnboarding } from "../../onboarding/onboarding-context";
import { OnboardingProgress } from "../../onboarding/onboarding-progress";
import { StatusBadge } from "../../ui/status-badge";
import type { DashboardData } from "../use-dashboard-data";

const STEP_KEYS = ["capture", "approve", "import", "advisor", "profile"] as const;
type StepKey = (typeof STEP_KEYS)[number];

const STEP_HREFS: Record<StepKey, string> = {
  capture: "/capture",
  approve: "/today?view=queue",
  import: "/capture",
  advisor: "/assistant",
  profile: "/settings/company",
};

function subscribeToLocalStorage(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function hasAdvisorThread(): boolean {
  return loadAssistantThreads().length > 0;
}

function noAdvisorThreadOnServer(): boolean {
  return false;
}

function stepHintKey(
  key: StepKey,
  done: Record<MilestoneId, boolean>,
): `steps.${StepKey}.hint` | "steps.approve.queueHint" {
  if (key === "approve" && !done.approve && done.capture) {
    return "steps.approve.queueHint";
  }
  return `steps.${key}.hint`;
}

export function GettingStartedWidget({ data }: { data: DashboardData }) {
  const t = useTranslations("dashboard.widgets.getting-started");
  const tDashboard = useTranslations("dashboard");
  const { startTour } = useOnboarding();
  const advisorAsked = useSyncExternalStore(subscribeToLocalStorage, hasAdvisorThread, noAdvisorThreadOnServer);
  const runtimeMode = webRuntimeConfig.runtimeMode;

  const snapshot = data.snapshot;
  const prevDoneRef = useRef<Record<MilestoneId, boolean> | null>(null);

  const done = snapshot
    ? deriveMilestones({
        snapshot,
        settings: data.settings,
        advisorThreadCount: advisorAsked ? 1 : 0,
        runtimeMode,
      })
    : null;

  useEffect(() => {
    if (!done) return;
    const prev = prevDoneRef.current;
    if (prev) {
      (Object.keys(done) as MilestoneId[]).forEach((key) => {
        if (!prev[key] && done[key]) {
          toast.success(t(`milestones.${key}.title`), {
            description: t(`milestones.${key}.body`),
          });
        }
      });
    }
    prevDoneRef.current = done;
  }, [done, t]);

  if (!snapshot || !done) {
    return <p className="text-sm text-muted-foreground">{tDashboard("loading")}</p>;
  }

  const doneCount = countCompletedMilestones(done);
  const showDemoSeededNote =
    runtimeMode === "demo" && !done.capture && snapshot.evidence.length === SEEDED_EVIDENCE_COUNT.demo;

  if (doneCount === STEP_KEYS.length) {
    return (
      <div
        className="glass-panel-soft space-y-2 rounded-xl p-4"
        data-testid="getting-started-all-done"
        data-tour="getting-started-widget"
      >
        <StatusBadge status={t("allDoneBadge")} variant="success" />
        <p className="text-sm font-semibold text-foreground">{t("allDoneTitle")}</p>
        <p className="text-sm leading-6 text-muted-foreground">{t("allDoneHint")}</p>
      </div>
    );
  }

  function guideTourForStep(key: StepKey): TourId | undefined {
    return CHECKLIST_TOUR_BY_STEP[key as keyof typeof CHECKLIST_TOUR_BY_STEP];
  }

  return (
    <div className="space-y-3" data-tour="getting-started-widget">
      <OnboardingProgress
        done={doneCount}
        total={STEP_KEYS.length}
        label={t("progress", { done: doneCount, total: STEP_KEYS.length })}
        progressTestId="getting-started-progress"
      />
      {showDemoSeededNote ? <p className="text-caption text-muted-foreground">{t("demoSeededNote")}</p> : null}
      <button
        type="button"
        data-testid="onboarding-show-me-around"
        onClick={() => startTour("app-orientation", { force: true })}
        className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm"
      >
        {t("showMeAround")}
      </button>
      <ul className="space-y-2">
        {STEP_KEYS.map((key) => {
          const tourId = guideTourForStep(key);
          return (
            <li key={key}>
              <div className="glass-panel-soft rounded-lg px-3 py-2">
                <Link
                  href={STEP_HREFS[key]}
                  data-testid={`getting-started-step-${key}`}
                  data-complete={done[key]}
                  className="flex items-center gap-3 rounded-md -mx-1 px-1 py-1 hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span
                    aria-hidden
                    className={`flex size-5 shrink-0 items-center justify-center rounded-full ${
                      done[key] ? "bg-success-soft text-success" : "border border-border text-transparent"
                    }`}
                  >
                    <Check className="size-3.5" strokeWidth={2} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-sm font-medium ${
                        done[key] ? "text-muted-foreground line-through" : "text-foreground"
                      }`}
                    >
                      {t(`steps.${key}.label`)}
                      {done[key] ? <span className="sr-only"> — {t("stepDone")}</span> : null}
                    </span>
                    <span className="mt-0.5 block truncate text-caption text-muted-foreground">
                      {t(stepHintKey(key, done))}
                    </span>
                  </span>
                </Link>
                {!done[key] && tourId ? (
                  <button
                    type="button"
                    data-testid={`getting-started-guide-${key}`}
                    onClick={() => startTour(tourId, { force: true })}
                    className="mt-2 text-sm font-medium text-primary hover:underline"
                  >
                    {t("guideMe")}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
