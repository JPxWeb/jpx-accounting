import { expect, test } from "@playwright/test";

import { resetApiState } from "./test-helpers";

// The palette is opened with Ctrl/Cmd+K, so it is keyboard-driven by design;
// one desktop pass covers the behavior and the shortcut is not reachable on touch.
test.skip(({ isMobile }) => isMobile, "The command palette is keyboard-driven; desktop coverage is sufficient.");

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

test("a palette review hit deep-links to /today?review=<id> and focuses the card", async ({ page }) => {
  await page.goto("/books");
  await expect(page.getByRole("tab", { name: "Journal" })).toBeVisible();

  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("command-palette")).toBeVisible();

  // The demo seed contains exactly one review: "Approve AI subscription posting".
  await page.getByTestId("command-palette-input").fill("Approve AI subscription");
  const reviewHit = page.getByRole("option").filter({ hasText: "Review ·" }).first();
  await expect(reviewHit).toBeVisible();
  await reviewHit.getByRole("button").click();

  await expect(page).toHaveURL(/\/today\?review=review_/);
  const focusedCard = page.getByTestId("review-card").filter({ hasText: "Approve AI subscription posting" });
  await expect(focusedCard).toBeVisible();
  await expect(focusedCard).toHaveClass(/ring-2/);
});
