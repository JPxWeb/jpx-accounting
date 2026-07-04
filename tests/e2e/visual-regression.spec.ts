import { expect, test } from "@playwright/test";

import { resetApiState } from "./test-helpers";

/**
 * Screenshot regression net for the advisory-pivot consolidation
 * (master plan Task 0.3, dark variants added at the Phase 1 exit gate).
 * Intentional visual changes re-baseline explicitly with --update-snapshots
 * after reviewing the diff images — never blindly.
 *
 * Dynamic regions (timestamps, generated ids) get masked via
 * [data-visual-mask] attributes on the element in question.
 */
const SCREENS: { name: string; path: string; readySelector?: string }[] = [
  { name: "today", path: "/today" },
  { name: "capture", path: "/capture" },
  { name: "books", path: "/books" },
  // The report charts mount via next/dynamic({ ssr: false }) — networkidle can
  // fire before the lazy chunk renders, so wait for the waterfall SVG.
  { name: "reports", path: "/reports", readySelector: '[data-testid="cash-bridge"] svg' },
  { name: "settings-company", path: "/settings/company" },
];

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

for (const theme of ["light", "dark"] as const) {
  for (const screen of SCREENS) {
    test(`visual: ${screen.name} (${theme})`, async ({ page }) => {
      // next-themes reads the stored choice before paint; forcing it via
      // localStorage avoids any flash and keeps the snapshot deterministic.
      await page.addInitScript((storedTheme) => {
        window.localStorage.setItem("theme", storedTheme);
      }, theme);
      await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
      await page.goto(screen.path);
      await page.waitForLoadState("networkidle");
      if (screen.readySelector) {
        await page.waitForSelector(screen.readySelector);
      }
      await expect(page).toHaveScreenshot(`${screen.name}-${theme}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.02,
        mask: [page.locator("[data-visual-mask]")],
      });
    });
  }
}
