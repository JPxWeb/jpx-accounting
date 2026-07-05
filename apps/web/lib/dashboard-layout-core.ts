/**
 * Pure widget-layout model for the Today dashboard (advisory pivot, Task 5.5).
 *
 * No React, no browser APIs — everything here is deterministic and unit-tested
 * from Node (`tests/unit/dashboard-layout-core.test.ts`). Persistence and
 * cross-tab sync live in `dashboard-layout-storage.ts`.
 *
 * Model invariants (enforced by `parseLayout` and preserved by every helper):
 * - `order` always contains ALL known widget ids exactly once. Hidden widgets
 *   keep their slot in `order`, so re-adding one restores its old position.
 * - `hidden` is a duplicate-free subset of the known ids.
 * - Helpers are immutable: they return a NEW layout, or the SAME reference
 *   when the operation is a no-op (lets callers cheaply skip persistence).
 */

/**
 * Canonical widget set, in default display order (Phase 5 plan, Task 5.5;
 * `getting-started` appended in Phase 6, Task 6.1). New widgets MUST be
 * appended LAST: `parseLayout` re-appends ids missing from a persisted order
 * in canonical order, so appending keeps existing saved layouts intact.
 */
export const WIDGET_IDS = [
  "cash-position",
  "review-queue",
  "tax-timeline",
  "observations",
  "result",
  "cash-bridge",
  "vat-status",
  "recent-activity",
  "integrity",
  "getting-started",
] as const;

export type WidgetId = (typeof WIDGET_IDS)[number];

export const DASHBOARD_LAYOUT_VERSION = 1;

export type DashboardLayout = {
  /** Persisted-schema version — bump (and migrate in `parseLayout`) on shape changes. */
  v: typeof DASHBOARD_LAYOUT_VERSION;
  /** Full ordering of ALL known widgets; hidden ones keep their slot. */
  order: readonly WidgetId[];
  /** Widgets currently not rendered (subset of `order`). */
  hidden: readonly WidgetId[];
};

const WIDGET_ID_SET: ReadonlySet<string> = new Set(WIDGET_IDS);

function isWidgetId(value: unknown): value is WidgetId {
  return typeof value === "string" && WIDGET_ID_SET.has(value);
}

export const DEFAULT_LAYOUT: DashboardLayout = Object.freeze({
  v: DASHBOARD_LAYOUT_VERSION,
  order: Object.freeze([...WIDGET_IDS]),
  hidden: Object.freeze([] as WidgetId[]),
});

/** Keep known ids only, first occurrence wins (drops duplicates + unknown ids). */
function sanitizeIds(input: unknown): WidgetId[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<WidgetId>();
  for (const value of input) {
    if (isWidgetId(value)) seen.add(value);
  }
  return [...seen];
}

/**
 * Parse a persisted layout string. Never throws: any malformed, foreign, or
 * versioned-differently payload falls back to `DEFAULT_LAYOUT`. Unknown ids
 * are dropped, duplicates deduped, and widgets missing from `order` (e.g.
 * after this build shipped new widgets) are re-appended in canonical order.
 */
export function parseLayout(raw: string | null | undefined): DashboardLayout {
  if (!raw) return DEFAULT_LAYOUT;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_LAYOUT;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return DEFAULT_LAYOUT;
  const candidate = parsed as { v?: unknown; order?: unknown; hidden?: unknown };
  if (candidate.v !== DASHBOARD_LAYOUT_VERSION) return DEFAULT_LAYOUT;
  const order = sanitizeIds(candidate.order);
  for (const id of WIDGET_IDS) {
    if (!order.includes(id)) order.push(id);
  }
  return { v: DASHBOARD_LAYOUT_VERSION, order, hidden: sanitizeIds(candidate.hidden) };
}

export function serializeLayout(layout: DashboardLayout): string {
  return JSON.stringify(layout);
}

/** The ids the dashboard actually renders, in display order. */
export function visibleWidgetIds(layout: DashboardLayout): WidgetId[] {
  const hidden = new Set(layout.hidden);
  return layout.order.filter((id) => !hidden.has(id));
}

/**
 * Commit a new ordering of the VISIBLE widgets (what the sortable grid emits
 * on drop). Hidden widgets keep their absolute slots in `order`. The input is
 * sanitized defensively: ids that are unknown/hidden/duplicated are dropped,
 * visible ids the caller omitted are re-appended in their old relative order.
 */
export function reorderVisible(layout: DashboardLayout, nextVisibleIds: readonly WidgetId[]): DashboardLayout {
  const visible = visibleWidgetIds(layout);
  const visibleSet = new Set(visible);
  const seen = new Set<WidgetId>();
  const next: WidgetId[] = [];
  for (const id of nextVisibleIds) {
    if (visibleSet.has(id) && !seen.has(id)) {
      seen.add(id);
      next.push(id);
    }
  }
  for (const id of visible) {
    if (!seen.has(id)) {
      seen.add(id);
      next.push(id);
    }
  }
  if (next.every((id, index) => id === visible[index])) return layout;
  const hiddenSet = new Set(layout.hidden);
  const queue = [...next];
  const order = layout.order.map((id) => (hiddenSet.has(id) ? id : (queue.shift() ?? id)));
  return { ...layout, order };
}

/** Move one visible widget to `toVisibleIndex` within the visible sequence (clamped). */
export function moveWidget(layout: DashboardLayout, id: WidgetId, toVisibleIndex: number): DashboardLayout {
  const visible = visibleWidgetIds(layout);
  const from = visible.indexOf(id);
  if (from === -1) return layout;
  const to = Math.max(0, Math.min(Math.trunc(toVisibleIndex), visible.length - 1));
  if (from === to) return layout;
  const next = [...visible];
  next.splice(to, 0, ...next.splice(from, 1));
  return reorderVisible(layout, next);
}

/** Un-hide a widget; it reappears at its remembered slot in `order`. */
export function addWidget(layout: DashboardLayout, id: WidgetId): DashboardLayout {
  if (!isWidgetId(id) || !layout.hidden.includes(id)) return layout;
  return { ...layout, hidden: layout.hidden.filter((hiddenId) => hiddenId !== id) };
}

/** Hide a widget. Its slot in `order` is retained for a later `addWidget`. */
export function removeWidget(layout: DashboardLayout, id: WidgetId): DashboardLayout {
  if (!isWidgetId(id) || layout.hidden.includes(id)) return layout;
  return { ...layout, hidden: [...layout.hidden, id] };
}

export function resetLayout(): DashboardLayout {
  return DEFAULT_LAYOUT;
}
