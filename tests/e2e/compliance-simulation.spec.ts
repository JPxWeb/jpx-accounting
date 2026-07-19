import { expect, test } from "@playwright/test";

import { expectAccessible } from "./a11y-helpers";
import { activateControl, checkControl, resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

// Buttons/checkboxes are activated via `activateControl`/`checkControl`:
// pointer on desktop, trusted keyboard on mobile — see the helpers' doc
// comments for the Pixel 7 visual-viewport emulation quirk.

test("compliance settings: alerts panel refreshes and renders severity chips", async ({ page, isMobile }) => {
  await page.goto("/settings/compliance");

  const panel = page.getByTestId("compliance-alerts-panel");
  await expect(panel).toBeVisible();

  await expect(panel.getByTestId("compliance-alert-row").first()).toBeVisible({ timeout: 15_000 });

  const severity = panel.getByTestId("compliance-alert-severity").first();
  await expect(severity).toBeVisible();

  await activateControl(panel.getByTestId("compliance-alerts-refresh"), isMobile);
  await expect(panel.getByTestId("compliance-alert-row").first()).toBeVisible();

  await expectAccessible(page);
});

test("review queue: simulation preview shows balance delta for selected reviews", async ({ page, isMobile }) => {
  await page.goto("/today?view=queue&status=needs-review");

  const firstCheckbox = page.locator('[data-testid^="review-select-"]').first();
  await expect(firstCheckbox).toBeVisible();
  await checkControl(firstCheckbox, isMobile);

  await activateControl(page.getByTestId("simulation-preview-open"), isMobile);

  const modal = page.getByTestId("simulation-preview-modal");
  await expect(modal).toBeVisible();
  await expect(modal.getByTestId("simulation-balance-table")).toBeVisible({ timeout: 15_000 });

  await activateControl(page.getByTestId("simulation-preview-close"), isMobile);
  await expect(modal).toBeHidden();
});

test("review queue: simulation preview surfaces 404 for unknown review ids", async ({ page, isMobile }) => {
  await page.goto("/today?view=queue&status=needs-review");

  const firstCheckbox = page.locator('[data-testid^="review-select-"]').first();
  await expect(firstCheckbox).toBeVisible();
  await checkControl(firstCheckbox, isMobile);

  await page.route("**/api/simulations/run", (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not found" }) }),
  );

  await activateControl(page.getByTestId("simulation-preview-open"), isMobile);
  await expect(page.getByTestId("simulation-preview-error")).toContainText(/no longer exist/i);
});
