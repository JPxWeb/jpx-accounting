import { expect, test } from "@playwright/test";

import { expectAccessible } from "./a11y-helpers";
import { apiBaseUrl, resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

test("reports screen renders the narrative-first pack surfaces", async ({ page }) => {
  await page.goto("/reports");

  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  await expect(page.getByTestId("period-selector")).toBeVisible();
  await expect(page.getByTestId("kpi-result")).toBeVisible();
  await expect(page.getByTestId("kpi-cash")).toBeVisible();
  await expect(page.getByTestId("kpi-revenue")).toBeVisible();
  await expect(page.getByTestId("kpi-vat")).toBeVisible();
  await expect(page.getByTestId("narrative-card")).toBeVisible();
  await expect(page.getByTestId("pnl-statement")).toBeVisible();
  await expect(page.getByTestId("balance-sheet")).toBeVisible();
  await expect(page.getByTestId("bs-balanced")).toBeVisible();
  await expect(page.getByTestId("vat-preparation")).toBeVisible();
  await expect(page.getByTestId("vat-box-49")).toBeVisible();
  await expect(page.getByTestId("alerts-panel")).toContainText("Compliance watch");
  await expect(page.getByTestId("export-sie")).toBeVisible();

  await expectAccessible(page);
});

test("narrative prose reconciles with the income statement (one pack by construction)", async ({ page }) => {
  await page.goto("/reports");

  const narrativeValue = page.getByTestId("narrative-value-period-result");
  const statementValue = page.getByTestId("pnl-period-result");
  await expect(narrativeValue).toBeVisible();
  await expect(statementValue).toBeVisible();

  // The tripwire for the "one source object" invariant: the prose number and
  // the statement number must be the SAME rendered text, byte for byte.
  expect(await narrativeValue.textContent()).toBe(await statementValue.textContent());
});

test("?period= filters the statements server-side", async ({ page, request }) => {
  // Seed lines are booked "now" (current month), so a pinned 2026-03-15 SIE
  // voucher is a permanent out-of-default-period fixture (plan finding 8).
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
  expect(await imported.json()).toMatchObject({ accepted: true, importedVouchers: 1 });

  // Default period (current month): the March account is absent from the P&L.
  await page.goto("/reports");
  await expect(page.getByTestId("pnl-statement")).toBeVisible();
  await expect(page.locator('[data-testid="pnl-line"][data-account="6110"]')).toHaveCount(0);

  // March window: the imported voucher's expense line renders in the P&L.
  await page.goto("/reports?period=2026-03");
  await expect(page.locator('[data-testid="pnl-line"][data-account="6110"]')).toBeVisible();
});
