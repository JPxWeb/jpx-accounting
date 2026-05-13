import { expect, test } from "@playwright/test";

import { resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

test("books default view is journal", async ({ page }) => {
  await page.goto("/books");
  await expect(page).toHaveURL(/\/books/);
  await expect(page.getByTestId("books-tabs")).toBeVisible();
  await expect(page.getByTestId("journal-view")).toBeVisible();
});

test("books period selector changes URL", async ({ page }) => {
  await page.goto("/books");
  await page.getByTestId("period-selector").click();
  // Click the second option (index 1) — the first option is the current month
  // which is the nuqs default and would be omitted from the URL.
  const option = page.getByRole("option").nth(1);
  await option.click();
  await expect(page).toHaveURL(/period=/);
});

test("trial balance row drills to general ledger", async ({ page }) => {
  await page.goto("/books?view=trial-balance");
  await page
    .getByRole("button", { name: /6540|6071/ })
    .first()
    .click();
  await expect(page).toHaveURL(/view=general-ledger/);
});
