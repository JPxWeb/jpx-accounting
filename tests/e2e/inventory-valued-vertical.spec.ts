import { expect, test } from "@playwright/test";

import { installConsoleGuard } from "./console-guard";
import { resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => resetApiState(request));

test("valued columns hidden when flag unset", async ({ page }) => {
  const guard = await installConsoleGuard(page);
  await page.goto("/books?view=journal&workflow=quantity_inventory");

  await expect(page.getByTestId("sku-movements-panel")).toBeVisible();
  await expect(page.getByTestId("valued-movements-panel")).toHaveCount(0);
  await expect(page.getByTestId("valued-unit-cost-column")).toHaveCount(0);
  await expect(page.getByTestId("valued-extended-amount-column")).toHaveCount(0);
  guard.assertClean();
});

test("valued columns visible when NEXT_PUBLIC_VALUED_INVENTORY=true", async ({ page }) => {
  test.skip(process.env.NEXT_PUBLIC_VALUED_INVENTORY !== "true", "flag off");
  const guard = await installConsoleGuard(page);
  await page.goto("/books?view=journal&workflow=valued_inventory");

  await expect(page.getByTestId("valued-movements-panel")).toBeVisible();
  await expect(page.getByTestId("valued-unit-cost-column")).toHaveText("Unit cost");
  await expect(page.getByTestId("valued-extended-amount-column")).toHaveText("Total value");
  await expect(page.getByTestId("valued-movements-empty")).toHaveText("No valued inventory movements.");
  guard.assertClean();
});
