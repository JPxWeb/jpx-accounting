import assert from "node:assert/strict";
import test from "node:test";

import {
  addWidget,
  DASHBOARD_LAYOUT_VERSION,
  DEFAULT_LAYOUT,
  moveWidget,
  parseLayout,
  removeWidget,
  reorderVisible,
  resetLayout,
  serializeLayout,
  visibleWidgetIds,
  WIDGET_IDS,
  type DashboardLayout,
  type WidgetId,
} from "../../apps/web/lib/dashboard-layout-core";

test("DEFAULT_LAYOUT covers every widget id exactly once, in spec order, none hidden", () => {
  assert.equal(DEFAULT_LAYOUT.v, DASHBOARD_LAYOUT_VERSION);
  assert.deepEqual([...DEFAULT_LAYOUT.order], [...WIDGET_IDS]);
  assert.deepEqual([...DEFAULT_LAYOUT.hidden], []);
  assert.equal(WIDGET_IDS.length, 10);
  assert.equal(new Set(WIDGET_IDS).size, WIDGET_IDS.length);
  // The plan's exact default order (Task 5.5; `getting-started` appended LAST
  // in Task 6.1 so persisted layouts keep working) — pinned so a reorder is
  // deliberate.
  assert.deepEqual(
    [...WIDGET_IDS],
    [
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
    ],
  );
});

test("a persisted pre-Phase-6 nine-widget layout re-appends getting-started last", () => {
  const nineWidgetIds = WIDGET_IDS.filter((id) => id !== "getting-started");
  const layout = parseLayout(JSON.stringify({ v: 1, order: [...nineWidgetIds].reverse(), hidden: ["result"] }));
  // The user's saved order survives untouched; the new widget lands at the end.
  assert.deepEqual(layout.order, [...[...nineWidgetIds].reverse(), "getting-started"]);
  assert.deepEqual(layout.hidden, ["result"]);
  assert.ok(visibleWidgetIds(layout).includes("getting-started"));
});

test("serialize → parse round-trips a customized layout", () => {
  const custom: DashboardLayout = {
    v: 1,
    order: ["integrity", ...WIDGET_IDS.filter((id) => id !== "integrity")],
    hidden: ["vat-status", "recent-activity"],
  };
  const roundTripped = parseLayout(serializeLayout(custom));
  assert.deepEqual(roundTripped, custom);
  // And the round-trip of the default is the default.
  assert.deepEqual(parseLayout(serializeLayout(DEFAULT_LAYOUT)), {
    v: 1,
    order: [...WIDGET_IDS],
    hidden: [],
  });
});

test("parseLayout falls back to DEFAULT_LAYOUT on garbage input", () => {
  assert.equal(parseLayout(null), DEFAULT_LAYOUT);
  assert.equal(parseLayout(undefined), DEFAULT_LAYOUT);
  assert.equal(parseLayout(""), DEFAULT_LAYOUT);
  assert.equal(parseLayout("not json {"), DEFAULT_LAYOUT);
  assert.equal(parseLayout('"a string"'), DEFAULT_LAYOUT);
  assert.equal(parseLayout("[1,2,3]"), DEFAULT_LAYOUT);
  // Wrong or missing version → defaults (forward-compat: a future v2 payload never half-parses).
  assert.equal(parseLayout(JSON.stringify({ v: 2, order: [...WIDGET_IDS], hidden: [] })), DEFAULT_LAYOUT);
  assert.equal(parseLayout(JSON.stringify({ order: [...WIDGET_IDS], hidden: [] })), DEFAULT_LAYOUT);
});

test("parseLayout tolerates unknown ids, duplicates, and missing widgets", () => {
  const raw = JSON.stringify({
    v: 1,
    order: ["integrity", "retired-widget", "cash-position", "integrity", 42, "review-queue"],
    hidden: ["cash-position", "unknown-id", "cash-position", null],
  });
  const layout = parseLayout(raw);
  // Unknown ids dropped, duplicates deduped (first occurrence wins),
  // missing widgets re-appended in canonical order.
  assert.deepEqual(layout.order, [
    "integrity",
    "cash-position",
    "review-queue",
    "tax-timeline",
    "observations",
    "result",
    "cash-bridge",
    "vat-status",
    "recent-activity",
    "getting-started",
  ]);
  assert.deepEqual(layout.hidden, ["cash-position"]);
  assert.equal(layout.order.length, WIDGET_IDS.length);
});

test("parseLayout with non-array order/hidden still yields a complete layout", () => {
  const layout = parseLayout(JSON.stringify({ v: 1, order: "nope", hidden: { a: 1 } }));
  assert.deepEqual(layout.order, [...WIDGET_IDS]);
  assert.deepEqual(layout.hidden, []);
});

test("visibleWidgetIds is order minus hidden", () => {
  const layout: DashboardLayout = { v: 1, order: [...WIDGET_IDS], hidden: ["review-queue", "integrity"] };
  assert.deepEqual(
    visibleWidgetIds(layout),
    WIDGET_IDS.filter((id) => id !== "review-queue" && id !== "integrity"),
  );
  assert.deepEqual(visibleWidgetIds(DEFAULT_LAYOUT), [...WIDGET_IDS]);
});

test("moveWidget relocates within the visible sequence and clamps out-of-range targets", () => {
  const moved = moveWidget(DEFAULT_LAYOUT, "integrity", 0);
  assert.deepEqual(visibleWidgetIds(moved)[0], "integrity");
  assert.deepEqual(visibleWidgetIds(moved), ["integrity", ...WIDGET_IDS.filter((id) => id !== "integrity")]);

  // Clamped: far past the end lands at the last slot.
  const toEnd = moveWidget(DEFAULT_LAYOUT, "cash-position", 99);
  assert.equal(visibleWidgetIds(toEnd).at(-1), "cash-position");
  const toStart = moveWidget(DEFAULT_LAYOUT, "integrity", -5);
  assert.equal(visibleWidgetIds(toStart)[0], "integrity");

  // No-ops return the SAME reference (callers skip persistence on identity).
  assert.equal(moveWidget(DEFAULT_LAYOUT, "cash-position", 0), DEFAULT_LAYOUT);
  const withHidden = removeWidget(DEFAULT_LAYOUT, "result");
  assert.equal(moveWidget(withHidden, "result", 0), withHidden, "hidden widgets cannot be moved");
});

test("reorderVisible keeps hidden widgets pinned to their order slots", () => {
  // Hide "tax-timeline" (slot 2) then reverse the visible ordering.
  const layout: DashboardLayout = { v: 1, order: [...WIDGET_IDS], hidden: ["tax-timeline"] };
  const visible = visibleWidgetIds(layout);
  const reversed = [...visible].reverse();
  const next = reorderVisible(layout, reversed);
  assert.deepEqual(visibleWidgetIds(next), reversed);
  // The hidden widget still occupies index 2 of the full order.
  assert.equal(next.order[2], "tax-timeline");
  // Un-hiding restores it at its remembered slot.
  assert.equal(visibleWidgetIds(addWidget(next, "tax-timeline"))[2], "tax-timeline");
});

test("reorderVisible sanitizes foreign input instead of corrupting the layout", () => {
  const layout = removeWidget(DEFAULT_LAYOUT, "integrity");
  const visible = visibleWidgetIds(layout);
  // Hidden id, duplicate, and an omission all get repaired.
  const sloppy = ["result", "integrity", "result", "cash-position"] as WidgetId[];
  const next = reorderVisible(layout, sloppy);
  const nextVisible = visibleWidgetIds(next);
  assert.deepEqual(nextVisible.slice(0, 2), ["result", "cash-position"]);
  assert.deepEqual(new Set(nextVisible), new Set(visible), "same visible set, only order changed");
  assert.equal(next.order.length, WIDGET_IDS.length);
  // Identical ordering → same reference.
  assert.equal(reorderVisible(layout, visible), layout);
});

test("removeWidget hides, addWidget restores, both are idempotent no-ops on repeat", () => {
  const hidden = removeWidget(DEFAULT_LAYOUT, "vat-status");
  assert.deepEqual(hidden.hidden, ["vat-status"]);
  assert.ok(!visibleWidgetIds(hidden).includes("vat-status"));
  // Order slot retained even while hidden.
  assert.deepEqual([...hidden.order], [...WIDGET_IDS]);

  assert.equal(removeWidget(hidden, "vat-status"), hidden, "hiding twice is a no-op");
  const restored = addWidget(hidden, "vat-status");
  assert.deepEqual(restored.hidden, []);
  assert.deepEqual(visibleWidgetIds(restored), [...WIDGET_IDS]);
  assert.equal(addWidget(DEFAULT_LAYOUT, "vat-status"), DEFAULT_LAYOUT, "adding a visible widget is a no-op");
});

test("removeWidget rejects unknown ids at runtime", () => {
  const layout = removeWidget(DEFAULT_LAYOUT, "not-a-widget" as WidgetId);
  assert.equal(layout, DEFAULT_LAYOUT);
});

test("resetLayout returns the frozen default", () => {
  assert.equal(resetLayout(), DEFAULT_LAYOUT);
  assert.ok(Object.isFrozen(DEFAULT_LAYOUT));
  assert.ok(Object.isFrozen(DEFAULT_LAYOUT.order));
  assert.ok(Object.isFrozen(DEFAULT_LAYOUT.hidden));
});

test("helpers never mutate their input", () => {
  const layout: DashboardLayout = { v: 1, order: [...WIDGET_IDS], hidden: ["result"] };
  const orderBefore = [...layout.order];
  const hiddenBefore = [...layout.hidden];
  moveWidget(layout, "integrity", 0);
  reorderVisible(layout, [...visibleWidgetIds(layout)].reverse());
  addWidget(layout, "result");
  removeWidget(layout, "cash-position");
  assert.deepEqual([...layout.order], orderBefore);
  assert.deepEqual([...layout.hidden], hiddenBefore);
});
