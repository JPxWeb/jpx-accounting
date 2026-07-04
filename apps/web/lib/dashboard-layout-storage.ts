"use client";

/**
 * Persistence + cross-tab sync for the dashboard widget layout (Task 5.5).
 *
 * Locked design (Phase 5 tech memo §4): schema-versioned JSON in localStorage,
 * change fan-out over a BroadcastChannel, consumed through ONE
 * `useSyncExternalStore` per hook call (mirrors `hooks/use-mobile.ts` — no
 * `useState`+`useEffect` mirroring, SSR-safe server snapshot).
 *
 * Referential stability: the parsed layout is cached per raw string, so
 * `getSnapshot` returns the same object until the stored value actually
 * changes, and `visibleIds` is derived once per layout object (WeakMap).
 */

import * as React from "react";

import {
  addWidget,
  DEFAULT_LAYOUT,
  parseLayout,
  removeWidget,
  reorderVisible,
  resetLayout,
  serializeLayout,
  visibleWidgetIds,
  type DashboardLayout,
  type WidgetId,
} from "./dashboard-layout-core";

export const DASHBOARD_LAYOUT_STORAGE_KEY = "jpx.accounting.dashboardLayout.v1";
export const DASHBOARD_LAYOUT_CHANNEL = "jpx-dashboard-layout";

/** Same-tab subscribers, notified synchronously on write. Other tabs hear the
 * BroadcastChannel; other browser windows on old engines still get `storage`. */
const localListeners = new Set<() => void>();

let cache: { raw: string | null; layout: DashboardLayout } | null = null;

function readLayout(): DashboardLayout {
  const raw = window.localStorage.getItem(DASHBOARD_LAYOUT_STORAGE_KEY);
  if (!cache || cache.raw !== raw) {
    cache = { raw, layout: parseLayout(raw) };
  }
  return cache.layout;
}

function getServerSnapshot(): DashboardLayout {
  return DEFAULT_LAYOUT;
}

function subscribe(callback: () => void) {
  localListeners.add(callback);
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(DASHBOARD_LAYOUT_CHANNEL);
  channel?.addEventListener("message", callback);
  const onStorage = (event: StorageEvent) => {
    // key === null means the whole store was cleared.
    if (event.key === null || event.key === DASHBOARD_LAYOUT_STORAGE_KEY) callback();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    localListeners.delete(callback);
    channel?.removeEventListener("message", callback);
    channel?.close();
    window.removeEventListener("storage", onStorage);
  };
}

function commit(next: DashboardLayout) {
  if (typeof window === "undefined") return;
  if (cache && cache.layout === next) return; // core helpers return the same ref on no-ops
  const raw = serializeLayout(next);
  try {
    window.localStorage.setItem(DASHBOARD_LAYOUT_STORAGE_KEY, raw);
  } catch {
    // Quota/private-mode failure: keep the in-memory layout for this session.
  }
  cache = { raw, layout: next };
  for (const listener of [...localListeners]) listener();
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(DASHBOARD_LAYOUT_CHANNEL);
    channel.postMessage({ v: next.v });
    channel.close();
  }
}

/** Derive-once cache so `visibleIds` is referentially stable per layout object. */
const visibleIdsCache = new WeakMap<DashboardLayout, readonly WidgetId[]>();

function visibleFor(layout: DashboardLayout): readonly WidgetId[] {
  let ids = visibleIdsCache.get(layout);
  if (!ids) {
    ids = visibleWidgetIds(layout);
    visibleIdsCache.set(layout, ids);
  }
  return ids;
}

// Actions are module-scoped (not re-created per render) and read the CURRENT
// layout at call time, so rapid successive calls never act on a stale render.
function move(nextVisibleIds: readonly WidgetId[]) {
  commit(reorderVisible(readLayout(), nextVisibleIds));
}

function add(id: WidgetId) {
  commit(addWidget(readLayout(), id));
}

function remove(id: WidgetId) {
  commit(removeWidget(readLayout(), id));
}

function reset() {
  commit(resetLayout());
}

export type UseDashboardLayoutResult = {
  layout: DashboardLayout;
  /** Render order for the grid — `layout.order` minus `layout.hidden`. */
  visibleIds: readonly WidgetId[];
  /** Commit a new visible ordering (wire to `SortableGrid.onReorder`). */
  move: (nextVisibleIds: readonly WidgetId[]) => void;
  add: (id: WidgetId) => void;
  remove: (id: WidgetId) => void;
  reset: () => void;
};

export function useDashboardLayout(): UseDashboardLayoutResult {
  const layout = React.useSyncExternalStore(subscribe, readLayout, getServerSnapshot);
  return { layout, visibleIds: visibleFor(layout), move, add, remove, reset };
}
