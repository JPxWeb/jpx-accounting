import { expect, test } from "@playwright/test";

import { resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

test("assistant page returns a grounded advisory answer", async ({ page }) => {
  await page.goto("/assistant");

  await page
    .getByTestId("assistant-question")
    .fill("What should we confirm before deducting VAT on a supplier invoice?");
  await page.getByTestId("assistant-submit").click();

  await expect(page.getByTestId("assistant-response").first()).toContainText(
    "What should we confirm before deducting VAT on a supplier invoice?",
  );
  await expect(page.getByTestId("assistant-response").first()).toContainText(
    /Internal architecture policy|Bokf[öÃ¶]ringslagen|Skatteverket/i,
  );
});

test("desktop rail Advisor link navigates to the assistant", async ({ page, isMobile }) => {
  test.skip(isMobile, "The Advisor entry is rail-only; the mobile dock keeps its 5 tabs.");

  await page.goto("/today");

  const railAdvisorLink = page.getByTestId("desktop-navigation").getByRole("link", { name: /Advisor/ });
  await expect(railAdvisorLink).toBeVisible();
  await railAdvisorLink.click();

  await expect(page).toHaveURL(/\/assistant/);
  await expect(page.getByTestId("assistant-panel")).toBeVisible();
  await expect(railAdvisorLink).toHaveAttribute("aria-current", "page");
});

test("the mobile dock keeps five tabs without an Advisor entry", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Dock composition only applies to the mobile project.");

  await page.goto("/today");

  const dock = page.getByTestId("mobile-dock");
  await expect(dock.getByRole("link")).toHaveCount(5);
  await expect(dock.getByRole("link", { name: /Advisor/ })).toHaveCount(0);
});

// Runs on both projects: on mobile the palette is the only Advisor entry point.
test("the command palette 'Ask advisor' action opens the assistant", async ({ page }) => {
  await page.goto("/today");
  // The review card is client-rendered, so its presence proves the shell is
  // hydrated and the global Ctrl/Cmd+K listener is attached.
  await expect(page.getByTestId("review-card").first()).toBeVisible();

  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("command-palette")).toBeVisible();

  await page.getByTestId("palette-ask-advisor").click();

  await expect(page).toHaveURL(/\/assistant/);
  await expect(page.getByTestId("assistant-panel")).toBeVisible();
});
