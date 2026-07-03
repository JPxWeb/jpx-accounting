import { expect, test } from "@playwright/test";

import { resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

test("trial balance row drills into the general ledger with an account filter chip", async ({ page }) => {
  await page.goto("/books?view=trial-balance");
  const firstRow = page.getByTestId("trial-balance-row").first();
  await expect(firstRow).toBeVisible();
  await firstRow.click();

  await expect(page).toHaveURL(/view=general-ledger/);
  await expect(page).toHaveURL(/account=/);
  await expect(page.getByTestId("ledger-account-filter")).toBeVisible();

  await page.getByTestId("ledger-account-filter-clear").click();
  await expect(page).not.toHaveURL(/account=/);
  await expect(page.getByTestId("ledger-account-filter")).toHaveCount(0);
});

test("supplier row drills into the journal with a supplier filter chip", async ({ page }) => {
  await page.goto("/books?view=suppliers");
  const firstRow = page.getByTestId("supplier-open-journal").first();
  await expect(firstRow).toBeVisible();
  await firstRow.click();

  // "journal" is the default view, so nuqs clears view= from the URL
  // (clearOnDefault). Landing on the journal is proven by the filter chip,
  // which only the journal view renders.
  await expect(page).not.toHaveURL(/view=suppliers/);
  await expect(page).toHaveURL(/supplier=/);
  await expect(page.getByTestId("journal-supplier-filter")).toBeVisible();

  await page.getByTestId("journal-supplier-filter-clear").click();
  await expect(page).not.toHaveURL(/supplier=/);
  await expect(page.getByTestId("journal-supplier-filter")).toHaveCount(0);
});
