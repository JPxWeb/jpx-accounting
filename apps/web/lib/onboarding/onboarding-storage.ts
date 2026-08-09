import { isTourId, type TourId } from "./tour-ids";

/**
 * Persists opt-in tour completion/dismiss state (not checklist step progress —
 * that stays data-derived in the getting-started widget).
 *
 * Referential stability: the parsed state is cached per raw localStorage string
 * so `useSyncExternalStore` getSnapshot stays Object.is-stable until storage
 * actually changes (mirrors `dashboard-layout-storage.ts`).
 *
 * Hydration: `getServerOnboardingSnapshot` and the pre-subscribe client snapshot
 * both return the frozen module `EMPTY_STATE`. Reading seeded localStorage only
 * begins after `subscribeOnboardingStorage` runs (post-hydration), so the first
 * paint matches the server and uSES performs one intentional client update.
 */

export const ONBOARDING_STORAGE_KEY = "jpx.accounting.onboarding.v1";

export type OnboardingState = {
  schemaVersion: 1;
  completedTours: TourId[];
  dismissedAt?: string;
  lastStartedAt?: string;
};

const EMPTY_COMPLETED: TourId[] = [];
const EMPTY_STATE: OnboardingState = Object.freeze({
  schemaVersion: 1,
  completedTours: EMPTY_COMPLETED,
});

let cache: { raw: string | null; state: OnboardingState } | null = null;
/** Becomes true on first uSES subscribe — keeps hydration paint === EMPTY_STATE. */
let storeSubscribed = false;

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

/** Imperative / post-subscribe read — Object.is-stable while raw is unchanged. */
export function readCachedState(): OnboardingState {
  if (typeof window === "undefined") return EMPTY_STATE;
  const raw = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
  if (!cache || cache.raw !== raw) {
    cache = { raw, state: parseOnboardingState(raw) };
  }
  return cache.state;
}

/**
 * Client getSnapshot for `useSyncExternalStore`. Returns EMPTY_STATE until the
 * store has subscribers so hydration's first client paint matches
 * `getServerOnboardingSnapshot` even when `addInitScript` seeded localStorage.
 */
export function getClientOnboardingSnapshot(): OnboardingState {
  if (!storeSubscribed) return EMPTY_STATE;
  return readCachedState();
}

/** SSR / hydration snapshot — always the module EMPTY_STATE (never touch storage). */
export function getServerOnboardingSnapshot(): OnboardingState {
  return EMPTY_STATE;
}

export function loadOnboardingState(): OnboardingState {
  return readCachedState();
}

const listeners = new Set<() => void>();

function notifyOnboardingStorageChange() {
  for (const listener of [...listeners]) {
    listener();
  }
}

function writeOnboardingState(state: OnboardingState) {
  if (typeof window === "undefined") return;
  const raw = JSON.stringify(state);
  window.localStorage.setItem(ONBOARDING_STORAGE_KEY, raw);
  cache = { raw, state };
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
  storeSubscribed = true;
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

/** Test-only: reset module cache + subscribe gate between unit cases. */
export function resetOnboardingStoreForTests() {
  cache = null;
  storeSubscribed = false;
  listeners.clear();
}
