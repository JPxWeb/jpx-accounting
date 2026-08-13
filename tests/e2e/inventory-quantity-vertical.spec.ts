import { expect, test } from "@playwright/test";

import { installConsoleGuard } from "./console-guard";
import { activateControl, resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => resetApiState(request));

test("quantity inventory review requires quantity-only fields", async ({ page, isMobile }) => {
  const guard = await installConsoleGuard(page);
  await page.goto("/today?view=queue");
  await activateControl(page.getByTestId("review-edit").first(), isMobile);

  await page.getByTestId("edit-workflow").selectOption("quantity_inventory");
  await expect(page.getByTestId("edit-submit")).toBeDisabled();
  await expect(page.getByTestId("inventory-sku-error")).toHaveText("Enter a SKU.");
  await expect(page.getByTestId("inventory-quantity-error")).toHaveText("Enter a positive quantity.");
  await expect(page.getByTestId("inventory-uom-error")).toHaveText("Enter a unit of measure.");
  await expect(page.getByTestId("inventory-direction-error")).toHaveText("Choose stock in or stock out.");
  await expect(page.getByTestId("inventory-unit-cost")).toHaveCount(0);
  await expect(page.getByTestId("inventory-currency")).toHaveCount(0);

  await page.getByTestId("inventory-sku").fill("sku_e2e_1");
  await page.getByTestId("inventory-quantity").fill("3");
  await page.getByTestId("inventory-uom").fill("st");
  await page.getByTestId("inventory-direction").selectOption("out");
  await expect(page.getByTestId("edit-submit")).toBeEnabled();
  await activateControl(page.getByTestId("edit-submit"), isMobile);
  await expect(page.getByTestId("review-edit-sheet")).toHaveCount(0);

  await page.goto("/books?view=journal&workflow=quantity_inventory");
  await expect(page.getByTestId("sku-movements-panel")).toBeVisible();
  const row = page.getByTestId("sku-movement-row").filter({ hasText: "sku_e2e_1" });
  await expect(row).toContainText("3");
  await expect(row).toContainText("st");
  await expect(row).toContainText("Stock out");
  await expect(row).toContainText("-3");
  await expect(page.getByTestId("valued-unit-cost-column")).toHaveCount(0);
  await expect(page.getByTestId("valued-extended-amount-column")).toHaveCount(0);
  guard.assertClean();
});

test("quantity inventory panel renders an honest empty state", async ({ page }) => {
  const guard = await installConsoleGuard(page);
  await page.goto("/books?view=journal&workflow=quantity_inventory");

  await expect(page.getByTestId("sku-movements-panel")).toBeVisible();
  await expect(page.getByTestId("sku-movements-empty")).toHaveText("No inventory movements.");
  await expect(page.getByTestId("valued-unit-cost-column")).toHaveCount(0);
  await expect(page.getByTestId("valued-extended-amount-column")).toHaveCount(0);
  guard.assertClean();
});
