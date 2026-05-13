import { expect, test } from "@playwright/test";

import { resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

test("reports page renders with tabs and VAT as default view", async ({ page }) => {
  await page.goto("/reports");

  await expect(
    page.getByRole("heading", { name: "VAT, P&L, balance sheet — all projected from the event history." }),
  ).toBeVisible();
  await expect(page.getByTestId("reports-tabs")).toBeVisible();
  await expect(page.getByTestId("vat-preparation")).toBeVisible();
  await expect(page.getByTestId("vat-preparation")).toContainText("VAT preparation");
});
