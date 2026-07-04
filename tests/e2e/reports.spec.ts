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

  // Charts (Task 4.7): the lazy recharts chunks mount real SVG plots, and each
  // chart's a11y twin table toggles open via its aria-expanded button.
  await expect(page.getByTestId("monthly-bars").locator("svg").first()).toBeVisible();
  await expect(page.getByTestId("cash-bridge").locator("svg").first()).toBeVisible();
  const tableToggle = page.getByTestId("chart-table-toggle-monthly-bars");
  await expect(tableToggle).toHaveAttribute("aria-expanded", "false");
  await tableToggle.click();
  await expect(tableToggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("chart-table-monthly-bars")).toBeVisible();

  // Axe runs with the charts mounted, so the recharts a11y layer is covered.
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

test("statutory tax timeline renders dated, source-cited deadlines", async ({ page }) => {
  await page.goto("/reports");

  // Placed after the VAT return table (Task 5.10); also the anchor target of
  // the deadline-proximity observation (/reports#tax-timeline).
  const timeline = page.getByTestId("tax-timeline");
  await expect(timeline).toBeVisible();

  // The default profile (quarterly VAT, calendar fiscal year) always has
  // upcoming statutory deadlines inside the 120-day horizon.
  const rows = timeline.getByTestId("tax-timeline-row");
  expect(await rows.count()).toBeGreaterThan(0);
  await expect(rows.first()).toHaveAttribute("data-due", /^\d{4}-\d{2}-\d{2}$/);

  // Every deadline cites its verbatim statutory source.
  await expect(timeline.getByTestId("tax-timeline-source").first()).toContainText(/Skatteverket|Årsredovisningslagen/);
});

test("print media strips chrome and swaps chart SVGs for their data tables", async ({ page }) => {
  await page.goto("/reports");
  // Let the lazy chart chunks mount before switching media.
  await expect(page.getByTestId("cash-bridge").locator("svg").first()).toBeVisible();

  await page.emulateMedia({ media: "print" });

  // Shell chrome and interactive controls disappear from the printed pack.
  await expect(page.getByTestId("desktop-navigation")).toBeHidden();
  await expect(page.getByTestId("app-shell-header")).toBeHidden();
  await expect(page.getByTestId("mobile-dock")).toBeHidden();
  await expect(page.getByTestId("runtime-mode-banner")).toBeHidden();
  await expect(page.getByTestId("period-selector")).toBeHidden();
  await expect(page.getByTestId("export-sie")).toBeHidden();
  await expect(page.getByTestId("print-report")).toBeHidden();

  // The print header appears (with the hash-chain verdict chip — Task 5.10);
  // chart SVGs yield to their data-table twins.
  await expect(page.getByTestId("report-print-header")).toBeVisible();
  await expect(page.getByTestId("report-print-header").getByTestId("integrity-chip")).toBeVisible();
  await expect(page.getByTestId("monthly-bars").locator("svg").first()).toBeHidden();
  await expect(page.getByTestId("cash-bridge").locator("svg").first()).toBeHidden();
  await expect(page.getByTestId("chart-table-monthly-bars")).toBeVisible();
  await expect(page.getByTestId("chart-table-cash-bridge")).toBeVisible();

  // The statements themselves stay on paper.
  await expect(page.getByTestId("pnl-statement")).toBeVisible();
  await expect(page.getByTestId("balance-sheet")).toBeVisible();
  await expect(page.getByTestId("vat-preparation")).toBeVisible();
});

test("the print button calls window.print", async ({ page }) => {
  await page.addInitScript(() => {
    const flagged = window as Window & { __printCalls?: number };
    flagged.__printCalls = 0;
    window.print = () => {
      flagged.__printCalls = (flagged.__printCalls ?? 0) + 1;
    };
  });

  await page.goto("/reports");
  await page.getByTestId("print-report").click();

  await expect.poll(() => page.evaluate(() => (window as Window & { __printCalls?: number }).__printCalls)).toBe(1);
});
