import { expect, test } from "@playwright/test";

import { resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

test("assistant page returns a grounded advisory answer", async ({ page }) => {
  await page.goto("/assistant");

  await page.getByTestId("assistant-question").fill("What should we confirm before deducting VAT on a supplier invoice?");
  await page.getByTestId("assistant-submit").click();

  await expect(page.getByTestId("assistant-response").first()).toContainText(
    "What should we confirm before deducting VAT on a supplier invoice?",
  );
  await expect(page.getByTestId("assistant-response").first()).toContainText(
    /Internal architecture policy|Bokf[öÃ¶]ringslagen|Skatteverket/i,
  );
});
