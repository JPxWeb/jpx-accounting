import { expect, test } from "@playwright/test";

import { resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

test("settings redirect lands on company sub-page", async ({ page }) => {
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings\/company$/);
  await expect(page.getByTestId("settings-sidebar")).toBeVisible();
  await expect(page.getByTestId("company-form")).toBeVisible();
});

test("company form persists name change", async ({ page }) => {
  await page.goto("/settings/company");
  const input = page.getByLabel("Organization name");
  await input.fill("New Test Name AB");
  await page.getByTestId("company-form-submit").click();
  await expect(page.getByText("Company settings saved")).toBeVisible();
  // Verify the saved value is retained in the form after the mutation succeeds.
  await expect(page.getByLabel("Organization name")).toHaveValue("New Test Name AB");
});

test("about page shows legacy posture content", async ({ page }) => {
  await page.goto("/settings/about");
  await expect(page.getByText(/runtime posture/i)).toBeVisible();
});
