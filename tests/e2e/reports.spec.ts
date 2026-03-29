import { expect, test } from "@playwright/test";

import { resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

test("reports page renders the current reporting slices", async ({ page }) => {
  await page.goto("/reports");

  await expect(
    page.getByRole("heading", { name: "Fast reporting with the ledger still in plain sight." }),
  ).toBeVisible();
  await expect(page.getByTestId("journal-summary")).toContainText("Journal summary");
  await expect(page.getByTestId("trial-balance")).toContainText("Trial balance view");
  await expect(page.getByTestId("vat-preparation")).toContainText("VAT preparation");
});
