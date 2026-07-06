"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";

import {
  isTourCompleted as readTourCompleted,
  loadOnboardingState,
  markTourCompleted,
  resetOnboardingTours,
  subscribeOnboardingStorage,
} from "../../lib/onboarding/onboarding-storage";
import type { TourId } from "../../lib/onboarding/tour-ids";

type OnboardingContextValue = {
  startTour: (tourId: TourId, options?: { force?: boolean }) => void;
  resetAllTours: () => void;
  isTourCompleted: (tourId: TourId) => boolean;
  activeTourId: TourId | null;
  registerTourBlocker: (id: string, blocked: boolean) => void;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({
  children,
  onStartTour,
  activeTourId,
}: {
  children: ReactNode;
  onStartTour: (tourId: TourId, options?: { force?: boolean }) => void;
  activeTourId: TourId | null;
}) {
  const blockersRef = useRef(new Set<string>());

  const onboardingSnapshot = useSyncExternalStore(subscribeOnboardingStorage, loadOnboardingState, () =>
    loadOnboardingState(),
  );

  const isTourCompleted = useCallback(
    (tourId: TourId) => onboardingSnapshot.completedTours.includes(tourId),
    [onboardingSnapshot.completedTours],
  );

  const startTour = useCallback(
    (tourId: TourId, options?: { force?: boolean }) => {
      if (blockersRef.current.size > 0) return;
      if (!options?.force && readTourCompleted(tourId)) return;
      onStartTour(tourId, options);
    },
    [onStartTour],
  );

  const resetAllTours = useCallback(() => {
    resetOnboardingTours();
  }, []);

  const registerTourBlocker = useCallback((id: string, blocked: boolean) => {
    if (blocked) blockersRef.current.add(id);
    else blockersRef.current.delete(id);
  }, []);

  const value = useMemo<OnboardingContextValue>(
    () => ({
      startTour,
      resetAllTours,
      isTourCompleted,
      activeTourId,
      registerTourBlocker,
    }),
    [startTour, resetAllTours, isTourCompleted, activeTourId, registerTourBlocker],
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error("useOnboarding must be used within OnboardingShell");
  }
  return context;
}

export function markActiveTourCompleted(tourId: TourId) {
  markTourCompleted(tourId);
}
