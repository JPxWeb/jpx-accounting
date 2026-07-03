import { expect, test } from "@playwright/test";

import { resetApiState } from "./test-helpers";

/**
 * Screenshot regression net for the advisory-pivot consolidation
 * (master plan Task 0.3). Baselines are captured BEFORE any token work;
 * intentional visual changes re-baseline explicitly with --update-snapshots
 * after reviewing the diff images — never blindly.
 *
 * Dynamic regions (timestamps, generated ids) get masked via
 * [data-visual-mask] attributes on the element in question.
 */
const SCREENS: { name: string; path: string }[] = [
  { name: "today", path: "/today" },
  { name: "capture", path: "/capture" },
  { name: "books", path: "/books" },
  { name: "reports", path: "/reports" },
  { name: "settings-company", path: "/settings/company" },
];

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

for (const screen of SCREENS) {
  test(`visual: ${screen.name}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(screen.path);
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot(`${screen.name}.png`, {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
      mask: [page.locator("[data-visual-mask]")],
    });
  });
}
