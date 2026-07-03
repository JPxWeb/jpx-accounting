import { expect, test } from "@playwright/test";

import { resetApiState } from "./test-helpers";

// The theme toggle behaves identically on every viewport; one desktop pass is enough.
test.skip(({ isMobile }) => isMobile, "Theme switching is viewport-independent; desktop coverage is sufficient.");

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

test.afterEach(async ({ page }) => {
  // next-themes persists the choice under localStorage key "theme" — clear it
  // so a forced theme cannot leak into other specs. Guard against the hook
  // running for runtime-skipped tests where the page never left about:blank
  // (localStorage access throws a SecurityError there).
  if (!page.url().startsWith("http")) return;
  await page.evaluate(() => window.localStorage.removeItem("theme"));
});

test("theme toggle switches the app to dark mode and back", async ({ page }) => {
  await page.goto("/settings/about");

  const html = page.locator("html");
  // The shell renders toggles in the rail and topbar too — scope to the
  // settings Appearance section to stay strict-mode clean.
  const appearance = page.getByTestId("appearance-settings");
  await expect(appearance.getByTestId("theme-toggle")).toBeVisible();
  await expect(html).not.toHaveClass(/dark/);

  // The active state only renders once next-themes has mounted — waiting for it
  // guarantees the buttons are hydrated before we click.
  await expect(appearance.getByTestId("theme-toggle-system")).toHaveAttribute("aria-pressed", "true");

  await appearance.getByTestId("theme-toggle-dark").click();
  await expect(html).toHaveClass(/dark/);

  // The .dark remap in ui-tokens swaps --background to a near-black value.
  // Browsers serialize the computed token in varying color spaces (Chromium
  // returns lab(…)), so parse the lightness instead of matching raw text.
  const readBackgroundLightness = () =>
    page.evaluate(() => {
      const value = getComputedStyle(document.documentElement).getPropertyValue("--background").trim();
      const match = value.match(/\(\s*([\d.]+)(%?)/);
      if (!match) return Number.NaN;
      const raw = Number.parseFloat(match[1]!);
      return match[2] === "%" ? raw / 100 : raw;
    });

  expect(await readBackgroundLightness()).toBeLessThan(0.3);

  await appearance.getByTestId("theme-toggle-light").click();
  await expect(html).not.toHaveClass(/dark/);

  expect(await readBackgroundLightness()).toBeGreaterThan(0.7);
});
