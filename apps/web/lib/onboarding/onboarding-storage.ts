import { isTourId, type TourId } from "./tour-ids";

/**
 * Persists opt-in tour completion/dismiss state (not checklist step progress —
 * that stays data-derived in the getting-started widget).
 */

export const ONBOARDING_STORAGE_KEY = "jpx.accounting.onboarding.v1";

export type OnboardingState = {
  schemaVersion: 1;
  completedTours: TourId[];
  dismissedAt?: string;
  lastStartedAt?: string;
};

const EMPTY_STATE: OnboardingState = {
  schemaVersion: 1,
  completedTours: [],
};

function isOnboardingState(value: unknown): value is OnboardingState {
  if (typeof value !== "object" || value === null) return false;
  const row = value as OnboardingState;
  return (
    row.schemaVersion === 1 &&
    Array.isArray(row.completedTours) &&
    row.completedTours.every((id) => typeof id === "string" && isTourId(id))
  );
}

export function parseOnboardingState(raw: string | null): OnboardingState {
  if (!raw) return EMPTY_STATE;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isOnboardingState(parsed) ? parsed : EMPTY_STATE;
  } catch {
    return EMPTY_STATE;
  }
}

export function loadOnboardingState(): OnboardingState {
  if (typeof window === "undefined") return EMPTY_STATE;
  return parseOnboardingState(window.localStorage.getItem(ONBOARDING_STORAGE_KEY));
}

const listeners = new Set<() => void>();

function notifyOnboardingStorageChange() {
  queueMicrotask(() => {
    for (const listener of listeners) {
      listener();
    }
  });
}

function writeOnboardingState(state: OnboardingState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state));
  notifyOnboardingStorageChange();
}

export function isTourCompleted(tourId: TourId, state = loadOnboardingState()): boolean {
  return state.completedTours.includes(tourId);
}

export function markTourCompleted(tourId: TourId): OnboardingState {
  const prev = loadOnboardingState();
  if (prev.completedTours.includes(tourId)) return prev;
  const next: OnboardingState = {
    ...prev,
    completedTours: [...prev.completedTours, tourId],
  };
  writeOnboardingState(next);
  return next;
}

export function resetOnboardingTours(): OnboardingState {
  writeOnboardingState(EMPTY_STATE);
  return EMPTY_STATE;
}

export function touchTourStarted(): OnboardingState {
  const prev = loadOnboardingState();
  const next: OnboardingState = {
    ...prev,
    lastStartedAt: new Date().toISOString(),
  };
  writeOnboardingState(next);
  return next;
}

export function subscribeOnboardingStorage(callback: () => void) {
  listeners.add(callback);
  const onStorage = (event: StorageEvent) => {
    if (event.key === ONBOARDING_STORAGE_KEY) callback();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", onStorage);
  };
}
