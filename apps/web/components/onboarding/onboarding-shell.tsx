"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Joyride, STATUS, type Step } from "react-joyride";

import { useIsMobile } from "../../hooks/use-mobile";
import { apiClient } from "../../lib/client";
import { buildTourStepDefinitions } from "../../lib/onboarding/tour-definitions";
import { waitForElement } from "../../lib/onboarding/wait-for-element";
import type { TourId } from "../../lib/onboarding/tour-ids";
import { webRuntimeConfig } from "../../lib/runtime-config";
import { markActiveTourCompleted, OnboardingProvider } from "./onboarding-context";
import { TourTooltip } from "./tour-tooltip";

function isCurrentRoute(route: string): boolean {
  if (typeof window === "undefined") return false;
  const [routePath, routeQuery = ""] = route.split("?");
  const samePath = window.location.pathname === routePath;
  const sameQuery = routeQuery ? window.location.search === `?${routeQuery}` : window.location.search === "";
  return samePath && sameQuery;
}

export function OnboardingShell({ children }: { children: ReactNode }) {
  const t = useTranslations("onboarding");
  const router = useRouter();
  const isMobile = useIsMobile();
  const [activeTourId, setActiveTourId] = useState<TourId | null>(null);
  const [run, setRun] = useState(false);
  const resumeAfterBlockRef = useRef(false);
  const blockersRef = useRef(new Set<string>());
  const pendingStartRef = useRef(false);

  const { data: workspaceSnapshot } = useQuery({
    queryKey: ["workspace"],
    queryFn: () => apiClient.getSnapshot(),
  });

  const pendingReviewCount =
    workspaceSnapshot?.reviews.filter((review) => review.status === "needs-review").length ?? 0;

  const tourBuildContext = useMemo(
    () => ({
      isMobile,
      isDemo: webRuntimeConfig.runtimeMode === "demo",
      pendingReviewCount,
    }),
    [isMobile, pendingReviewCount],
  );

  const stepDefinitions = useMemo(() => {
    if (!activeTourId) return [];
    return buildTourStepDefinitions(activeTourId, tourBuildContext);
  }, [activeTourId, tourBuildContext]);

  const steps = useMemo<Step[]>(() => {
    if (!activeTourId) return [];
    return stepDefinitions.map((definition) => ({
      id: definition.id,
      target: definition.target,
      placement: definition.placement ?? "bottom",
      skipBeacon: true,
      data: definition.diagram ?? undefined,
      title: t(`tours.${activeTourId}.steps.${definition.id}.title`),
      content: t(`tours.${activeTourId}.steps.${definition.id}.content`),
      before: async () => {
        if (definition.route && !isCurrentRoute(definition.route)) {
          router.push(definition.route);
        }
        const selector = typeof definition.target === "string" ? definition.target : null;
        if (selector) {
          await waitForElement(selector).catch(() => undefined);
        }
      },
    }));
  }, [activeTourId, stepDefinitions, router, t]);

  const finishTour = useCallback(
    (completed: boolean) => {
      if (completed && activeTourId) {
        markActiveTourCompleted(activeTourId);
      }
      setRun(false);
      setActiveTourId(null);
      resumeAfterBlockRef.current = false;
    },
    [activeTourId],
  );

  const startTour = useCallback(
    async (tourId: TourId) => {
      if (blockersRef.current.size > 0) {
        resumeAfterBlockRef.current = true;
        return;
      }

      const definitions = buildTourStepDefinitions(tourId, tourBuildContext);
      const firstRoute = definitions[0]?.route;
      const firstTarget = definitions[0]?.target;
      if (firstRoute && !isCurrentRoute(firstRoute)) {
        router.push(firstRoute);
      }
      if (typeof firstTarget === "string") {
        const element = await waitForElement(firstTarget).catch(() => undefined);
        element?.scrollIntoView({ block: "center" });
      }

      setActiveTourId(tourId);
      pendingStartRef.current = true;
      setRun(false);
    },
    [router, tourBuildContext],
  );

  useEffect(() => {
    if (!pendingStartRef.current || !activeTourId || steps.length === 0) return;
    pendingStartRef.current = false;
    setRun(true);
  }, [activeTourId, steps.length]);

  const registerTourBlocker = useCallback(
    (id: string, blocked: boolean) => {
      if (blocked) {
        blockersRef.current.add(id);
        if (run) {
          resumeAfterBlockRef.current = true;
          setRun(false);
        }
        return;
      }

      blockersRef.current.delete(id);
      if (resumeAfterBlockRef.current && blockersRef.current.size === 0 && activeTourId) {
        resumeAfterBlockRef.current = false;
        setRun(true);
      }
    },
    [activeTourId, run],
  );

  useEffect(() => {
    if (!activeTourId || steps.length === 0) return;
    if (run) return;
    if (blockersRef.current.size > 0) return;
    if (resumeAfterBlockRef.current) {
      resumeAfterBlockRef.current = false;
      setRun(true);
    }
  }, [activeTourId, run, steps.length]);

  return (
    <OnboardingProvider onStartTour={startTour} activeTourId={activeTourId}>
      <OnboardingBlockerRegistrar registerTourBlocker={registerTourBlocker} />
      {children}
      <Joyride
        key={activeTourId ?? "idle"}
        steps={steps}
        run={run}
        continuous
        tooltipComponent={TourTooltip}
        locale={{
          back: t("controls.back"),
          close: t("controls.close"),
          last: t("controls.last"),
          next: t("controls.next"),
          nextWithProgress: t("controls.nextWithProgress"),
          skip: t("controls.skip"),
        }}
        onEvent={(data) => {
          if (data.status === STATUS.FINISHED) {
            finishTour(true);
          }
          if (data.status === STATUS.SKIPPED) {
            finishTour(false);
          }
        }}
      />
    </OnboardingProvider>
  );
}

const blockerRegistry = new Set<(id: string, blocked: boolean) => void>();

export function registerGlobalTourBlocker(id: string, blocked: boolean) {
  for (const listener of blockerRegistry) {
    listener(id, blocked);
  }
}

function OnboardingBlockerRegistrar({
  registerTourBlocker,
}: {
  registerTourBlocker: (id: string, blocked: boolean) => void;
}) {
  useEffect(() => {
    blockerRegistry.add(registerTourBlocker);
    return () => {
      blockerRegistry.delete(registerTourBlocker);
    };
  }, [registerTourBlocker]);

  return null;
}
