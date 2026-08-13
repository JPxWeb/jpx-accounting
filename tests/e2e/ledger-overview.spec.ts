import { expect, test } from "@playwright/test";

import { installConsoleGuard } from "./console-guard";
import { activateControl, apiBaseUrl, resetApiState } from "./test-helpers";

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

test("journal search filters voucher groups", async ({ page, request }) => {
  const guard = await installConsoleGuard(page);
  const sieFixture = [
    "#FLAGGA 0",
    "#SIETYP 4",
    '#KONTO 6110 "Kontorsmateriel"',
    '#VER A 90 20260315 "March window fixture"',
    "{",
    "#TRANS 6110 {} 100.00",
    "#TRANS 1930 {} -100.00",
    "}",
  ].join("\n");
  const imported = await request.post(`${apiBaseUrl}/api/imports/sie`, {
    headers: { "content-type": "text/plain" },
    data: sieFixture,
  });
  expect(imported.ok()).toBeTruthy();

  await page.goto("/books?period=2026-03&q=March");
  await expect(page.getByTestId("ledger-voucher-toggle")).toHaveCount(1);
  guard.assertClean();
});
