import { expect, test } from "@playwright/test";

import { resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

test("assistant page shows Open Advisor button", async ({ page }) => {
  await page.goto("/assistant");

  await expect(page.getByTestId("open-advisor-button")).toBeVisible();
  await expect(page.getByTestId("open-advisor-button")).toContainText("Open Advisor");
});

test("clicking Open Advisor navigates to /today?advisor=open", async ({ page }) => {
  await page.goto("/assistant");

  await page.getByTestId("open-advisor-button").click();

  await expect(page).toHaveURL(/\/today\?advisor=open/);
});
