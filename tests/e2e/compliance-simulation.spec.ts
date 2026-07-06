import { expect, test } from "@playwright/test";

import { expectAccessible } from "./a11y-helpers";
import { resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

test("compliance settings: alerts panel refreshes and renders severity chips", async ({ page }) => {
  await page.goto("/settings/compliance");

  const panel = page.getByTestId("compliance-alerts-panel");
  await expect(panel).toBeVisible();

  await expect(panel.getByTestId("compliance-alert-row").first()).toBeVisible({ timeout: 15_000 });

  const severity = panel.getByTestId("compliance-alert-severity").first();
  await expect(severity).toBeVisible();

  await panel.getByTestId("compliance-alerts-refresh").click();
  await expect(panel.getByTestId("compliance-alert-row").first()).toBeVisible();

  await expectAccessible(page);
});

test("review queue: simulation preview shows balance delta for selected reviews", async ({ page }) => {
  await page.goto("/today?view=queue&status=needs-review");

  const firstCheckbox = page.locator('[data-testid^="review-select-"]').first();
  await expect(firstCheckbox).toBeVisible();
  await firstCheckbox.check();

  await page.getByTestId("simulation-preview-open").click();

  const modal = page.getByTestId("simulation-preview-modal");
  await expect(modal).toBeVisible();
  await expect(modal.getByTestId("simulation-balance-table")).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("simulation-preview-close").click();
  await expect(modal).toBeHidden();
});

test("review queue: simulation preview surfaces 404 for unknown review ids", async ({ page }) => {
  await page.goto("/today?view=queue&status=needs-review");

  const firstCheckbox = page.locator('[data-testid^="review-select-"]').first();
  await expect(firstCheckbox).toBeVisible();
  await firstCheckbox.check();

  await page.route("**/api/simulations/run", (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not found" }) }),
  );

  await page.getByTestId("simulation-preview-open").click();
  await expect(page.getByTestId("simulation-preview-error")).toContainText(/no longer exist/i);
});
