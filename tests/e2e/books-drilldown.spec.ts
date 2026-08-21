import { expect, test } from "@playwright/test";

import { activateControl, apiBaseUrl, resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

test("trial balance row drills into the general ledger with an account filter chip", async ({ page, isMobile }) => {
  await page.goto("/books?view=trial-balance");
  const firstRow = page.getByTestId("trial-balance-row").first();
  await expect(firstRow).toBeVisible();
  await activateControl(firstRow, isMobile);

  await expect(page).toHaveURL(/view=general-ledger/);
  await expect(page).toHaveURL(/account=/);
  await expect(page.getByTestId("ledger-account-filter")).toBeVisible();

  await activateControl(page.getByTestId("ledger-account-filter-clear"), isMobile);
  await expect(page).not.toHaveURL(/account=/);
  await expect(page.getByTestId("ledger-account-filter")).toHaveCount(0);
});

test("supplier row drills into the journal with a supplier filter chip", async ({ page, isMobile }) => {
  await page.goto("/books?view=suppliers");
  const firstRow = page.getByTestId("supplier-open-journal").first();
  await expect(firstRow).toBeVisible();
  await activateControl(firstRow, isMobile);

  // "journal" is the default view, so nuqs clears view= from the URL
  // (clearOnDefault). Landing on the journal is proven by the filter chip,
  // which only the journal view renders.
  await expect(page).not.toHaveURL(/view=suppliers/);
  await expect(page).toHaveURL(/supplier=/);
  await expect(page.getByTestId("journal-supplier-filter")).toBeVisible();

  await activateControl(page.getByTestId("journal-supplier-filter-clear"), isMobile);
  await expect(page).not.toHaveURL(/supplier=/);
  await expect(page.getByTestId("journal-supplier-filter")).toHaveCount(0);
});

test("?period= filters the journal server-side (month and fiscal quarter windows)", async ({ page, request }) => {
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

  // Default period (current month): the seeded journal renders, March's 6110 does not.
  await page.goto("/books");
  const journalView = page.getByTestId("journal-view");
  await expect(journalView.locator("table tbody tr")).not.toHaveCount(0);
  await expect(journalView).not.toContainText("6110");

  // Explicit March month token → the imported voucher's lines appear.
  await page.goto("/books?period=2026-03");
  await expect(journalView).toContainText("6110");

  // Fiscal quarter token (Q1 of the fiscal year starting 2026 = Jan–Mar with
  // the default 01-01 fiscal year start) → March is inside the window.
  await page.goto("/books?period=2026-Q1");
  await expect(journalView).toContainText("6110");
});

// Print (KFR Task E.6): the same contract reports.spec.ts pins for the report
// pack — `emulateMedia` proves the CSS/markup contract without ever calling
// `window.print()`, which Playwright cannot drive.
test("print media on the journal view strips chrome and shows the print header", async ({ page }) => {
  await page.goto("/books");
  await expect(page.getByTestId("journal-view")).toBeVisible();

  await page.emulateMedia({ media: "print" });

  await expect(page.getByTestId("desktop-navigation")).toBeHidden();
  await expect(page.getByTestId("mobile-dock")).toBeHidden();
  await expect(page.getByTestId("books-print")).toBeHidden();
  await expect(page.getByTestId("books-new-manual-entry")).toBeHidden();
  await expect(page.getByTestId("period-selector")).toBeHidden();
  await expect(page.getByTestId("report-print-header")).toBeVisible();

  // Every posting row is unbreakable, so a printed grundbok never splits one
  // booking across a page boundary.
  const row = page.getByTestId("journal-view").locator("table tbody tr").first();
  await expect(row).toBeVisible();
  expect(await row.evaluate((el) => getComputedStyle(el).breakInside)).toBe("avoid");
});

test("print media on the general-ledger view expands and keeps account groups whole", async ({ page }) => {
  await page.goto("/books?view=general-ledger");
  const group = page.getByTestId("general-ledger-view").locator("details").first();
  await expect(group).toBeVisible();
  // On screen the postings stay behind the collapsed summary.
  await expect(group.locator("li").first()).toBeHidden();

  await page.emulateMedia({ media: "print" });

  await expect(page.getByTestId("report-print-header")).toBeVisible();
  await expect(page.getByTestId("books-print")).toBeHidden();
  await expect(page.getByTestId("period-selector")).toBeHidden();

  // A huvudbok without its postings is not a huvudbok: every account group
  // opens on paper, and never splits across a page boundary.
  await expect(group.locator("li").first()).toBeVisible();
  expect(await group.evaluate((el) => getComputedStyle(el).breakInside)).toBe("avoid");
});

test("the print button only appears on the journal and general-ledger views", async ({ page }) => {
  await page.goto("/books?view=trial-balance");
  await expect(page.getByTestId("trial-balance-row").first()).toBeVisible();
  await expect(page.getByTestId("books-print")).toHaveCount(0);

  await page.goto("/books?view=general-ledger");
  await expect(page.getByTestId("books-print")).toBeVisible();
});
