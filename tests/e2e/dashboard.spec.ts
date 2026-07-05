import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { expectAccessible } from "./a11y-helpers";
import { apiBaseUrl, resetApiState } from "./test-helpers";

/**
 * The /today advisory dashboard (Task 5.8 + the Task 6.1 getting-started
 * checklist): ten widgets on shared queries, keyboard-only reorder with layout
 * persistence, the widget picker, observation provenance, and the widget-level
 * approvals that route through the ordinary review gate.
 */

const WIDGET_IDS = [
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

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

/** Rendered widget order — chrome sections only (handles/drills share the prefix). */
function widgetOrder(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid="dashboard-canvas"] section[data-testid^="widget-"]')
    .evaluateAll((sections) => sections.map((section) => section.getAttribute("data-testid")!.slice("widget-".length)));
}

test("all ten widgets render on the default dashboard", async ({ page }) => {
  await page.goto("/today");

  await expect(page.getByTestId("dashboard-canvas")).toBeVisible();
  for (const id of WIDGET_IDS) {
    await expect(page.getByTestId(`widget-${id}`)).toBeVisible();
  }
  expect(await widgetOrder(page)).toEqual([...WIDGET_IDS]);
});

test("keyboard-only reorder swaps the first two widgets and persists across reload", async ({ page, isMobile }) => {
  // Keyboard drag is desktop coverage (the mobile grid is single-column and
  // long-press-driven); the dnd-kit keyboard sensor itself is shared code.
  test.skip(isMobile, "Keyboard-driven reorder is covered on desktop.");

  await page.goto("/today");
  await expect(page.getByTestId("widget-cash-position")).toBeVisible();
  expect(await widgetOrder(page)).toEqual([...WIDGET_IDS]);

  // dnd-kit keyboard sensor: Enter picks up, arrows move, Enter drops.
  await page.getByTestId("widget-handle-cash-position").focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");

  const expected = ["review-queue", "cash-position", ...WIDGET_IDS.slice(2)];
  await expect.poll(() => widgetOrder(page)).toEqual(expected);

  // Persistence: the layout store wrote localStorage — a reload replays it.
  await page.reload();
  await expect(page.getByTestId("widget-cash-position")).toBeVisible();
  expect(await widgetOrder(page)).toEqual(expected);
});

test("widget picker hides, re-adds, and resets widgets", async ({ page }) => {
  await page.goto("/today");
  await expect(page.getByTestId("widget-integrity")).toBeVisible();

  // Hide via the picker toggle.
  await page.getByTestId("widget-picker-open").click();
  await page.getByTestId("widget-picker-toggle-integrity").click();
  await expect(page.getByTestId("widget-integrity")).toHaveCount(0);

  // Re-add: the widget returns at its remembered slot.
  await page.getByTestId("widget-picker-toggle-integrity").click();
  await expect(page.getByTestId("widget-integrity")).toBeVisible();
  expect(await widgetOrder(page)).toEqual([...WIDGET_IDS]);

  // Remove via the widget chrome, then reset the whole layout from the picker.
  await page.keyboard.press("Escape"); // light-dismiss the popover
  await page.getByTestId("widget-remove-vat-status").click();
  await expect(page.getByTestId("widget-vat-status")).toHaveCount(0);
  await page.getByTestId("widget-picker-open").click();
  await page.getByTestId("dashboard-reset").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("widget-vat-status")).toBeVisible();
  expect(await widgetOrder(page)).toEqual([...WIDGET_IDS]);
});

/** Import prior-month cash burn so the cash-runway detector fires deterministically. */
async function importBurnFixture(request: APIRequestContext) {
  const monthToken = (offset: number) => {
    const now = new Date();
    const index = now.getFullYear() * 12 + now.getMonth() + offset;
    return `${Math.floor(index / 12)}${String((index % 12) + 1).padStart(2, "0")}`;
  };
  const voucher = (offset: number, number: number) =>
    [
      `#VER A ${number} ${monthToken(offset)}15 "Burn fixture"`,
      "{",
      "#TRANS 6540 {} 40000.00",
      "#TRANS 1930 {} -40000.00",
      "}",
    ].join("\n");
  const sieFixture = [
    "#FLAGGA 0",
    "#SIETYP 4",
    '#KONTO 6540 "IT-tjanster"',
    '#KONTO 1930 "Foretagskonto"',
    voucher(-2, 91),
    voucher(-1, 92),
  ].join("\n");

  const imported = await request.post(`${apiBaseUrl}/api/imports/sie`, {
    headers: { "content-type": "text/plain" },
    data: sieFixture,
  });
  expect(imported.ok()).toBeTruthy();
  expect(await imported.json()).toMatchObject({ accepted: true, importedVouchers: 2 });
}

test("observation provenance href resolves to its report surface", async ({ page, request }) => {
  // Two months of heavy cash burn → negative cash → critical cash-runway
  // observation, which always ranks first (severity → detector priority).
  await importBurnFixture(request);

  await page.goto("/today");
  const observationsWidget = page.getByTestId("widget-observations");
  await expect(observationsWidget).toBeVisible();

  const chip = observationsWidget.getByTestId("observation-chip").first();
  await expect(chip).toBeVisible();
  await chip.click();

  await expect(page).toHaveURL(/\/reports#cash-bridge$/);
  await expect(page.getByTestId("cash-bridge")).toBeVisible();
});

test("one-tap approve decrements the pending count through the review gate", async ({ page }) => {
  await page.goto("/today");

  const widget = page.getByTestId("widget-review-queue");
  await expect(widget.getByTestId("review-widget-pending-count")).toContainText("1 pending review");

  await widget.getByTestId("review-widget-approve").click();
  await expect(widget.getByTestId("review-widget-pending-count")).toHaveCount(0);
  await expect(widget).toContainText("The queue is clear");

  // The approval was a real review decision: the queue shows it as approved.
  await page.goto("/today?view=queue");
  await expect(page.getByTestId("review-status").filter({ hasText: "approved" })).toHaveCount(1);
});

test("batch approve routes every seeded high-confidence review through approvals", async ({ page }) => {
  await page.goto("/today");

  const widget = page.getByTestId("widget-review-queue");
  // The seeded review (confidence 0.86) lands in the shared high band (≥ 0.85).
  await expect(widget.getByTestId("confidence-band")).toHaveAttribute("data-band", "high");

  await widget.getByTestId("review-widget-batch").click();
  await expect(page.getByTestId("batch-approve-confirm")).toBeVisible();
  await page.getByTestId("batch-approve-confirm").click();

  await expect(page.getByText("1 review approved.").first()).toBeVisible();
  await expect(widget).toContainText("The queue is clear");

  await page.goto("/today?view=queue");
  await expect(page.getByTestId("review-status").filter({ hasText: "approved" })).toHaveCount(1);
});

test("getting-started checklist derives from workspace data and its links resolve", async ({ page }) => {
  await page.goto("/today");

  const widget = page.getByTestId("widget-getting-started");
  await expect(widget).toBeVisible();
  // Fresh reset: only the seeded evidence/review exist and nothing is decided,
  // imported, asked, or saved — every step is open.
  await expect(widget.getByTestId("getting-started-progress")).toHaveText("0 of 5 done");

  // Every step links to its surface.
  await expect(widget.getByTestId("getting-started-step-capture")).toHaveAttribute("href", "/capture");
  await expect(widget.getByTestId("getting-started-step-approve")).toHaveAttribute("href", "/today?view=queue");
  await expect(widget.getByTestId("getting-started-step-import")).toHaveAttribute("href", "/capture");
  await expect(widget.getByTestId("getting-started-step-advisor")).toHaveAttribute("href", "/assistant");
  await expect(widget.getByTestId("getting-started-step-profile")).toHaveAttribute("href", "/settings/company");

  // Steps are pure derivations: approving through the review widget (ordinary
  // review gate) flips the approve step without any stored checklist state.
  await page.getByTestId("widget-review-queue").getByTestId("review-widget-approve").click();
  await expect(widget.getByTestId("getting-started-step-approve")).toHaveAttribute("data-complete", "true");
  await expect(widget.getByTestId("getting-started-progress")).toHaveText("1 of 5 done");

  // And the links navigate for real.
  await widget.getByTestId("getting-started-step-capture").click();
  await expect(page).toHaveURL(/\/capture$/);
});

test("dashboard passes WCAG 2.2 AA checks idle and mid-keyboard-drag", async ({ page, isMobile }) => {
  await page.goto("/today");
  await expect(page.getByTestId("dashboard-canvas")).toBeVisible();
  await expect(page.getByTestId("widget-integrity")).toBeVisible();
  await expectAccessible(page);

  if (!isMobile) {
    // Mid-drag: pick the first widget up with the keyboard and move it once —
    // the live announcement layer and drag styling must stay accessible.
    await page.getByTestId("widget-handle-cash-position").focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowRight");
    await expectAccessible(page);
    await page.keyboard.press("Escape");
  }
});
