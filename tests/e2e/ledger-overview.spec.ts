import { expect, test } from "@playwright/test";

import { installConsoleGuard } from "./console-guard";
import { activateControl, resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

test("journal Mode A expands voucher inline", async ({ page, isMobile }) => {
  const guard = await installConsoleGuard(page);
  await page.goto("/books?view=journal&ledgerMode=inline");
  const firstToggle = page.getByTestId("ledger-voucher-toggle").first();
  await activateControl(firstToggle, isMobile);
  await expect(page.getByTestId("ledger-voucher-detail")).toBeVisible();
  await expect(firstToggle).toHaveAttribute("aria-expanded", "true");
  guard.assertClean();
});

test("journal Mode B opens drawer and Escape closes", async ({ page, isMobile }) => {
  const guard = await installConsoleGuard(page);
  await page.goto("/books?view=journal&ledgerMode=drawer");
  const firstToggle = page.getByTestId("ledger-voucher-toggle").first();
  await activateControl(firstToggle, isMobile);
  await expect(page.getByTestId("ledger-voucher-drawer")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("ledger-voucher-drawer")).toHaveCount(0);
  guard.assertClean();
});
