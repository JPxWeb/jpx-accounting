import { expect, test } from "@playwright/test";

import { resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

test("navigation and share target flows stay reachable", async ({ page }) => {
  await page.goto("/today");

  if (test.info().project.name.includes("mobile")) {
    await expect(page.getByTestId("mobile-dock")).toBeVisible();
  } else {
    await expect(page.getByTestId("desktop-navigation")).toBeVisible();
  }

  await page.getByRole("link", { name: "Reports" }).first().click();
  await expect(page).toHaveURL(/\/reports/);

  await page.getByRole("link", { name: "Settings" }).first().click();
  await expect(page).toHaveURL(/\/settings/);

  await page.goto("/share?title=Taxi%20Receipt&text=Airport%20transfer&url=https%3A%2F%2Fexample.com%2Freceipt");
  await expect(page.getByTestId("share-target-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Taxi Receipt" })).toBeVisible();
  await expect(page.getByTestId("share-text")).toHaveText("Airport transfer");
  await expect(page.getByTestId("share-url")).toHaveText("https://example.com/receipt");
});

test("primary dock navigates between all five tabs", async ({ page }) => {
  // Verify all five shell tabs navigate correctly from within the shell
  await page.goto("/today");
  for (const [linkName, expectedUrl] of [
    [/capture/i, /\/capture/],
    [/books/i, /\/books/],
    [/reports/i, /\/reports/],
    [/settings/i, /\/settings\/company$/],
  ] as [RegExp, RegExp][]) {
    await page.getByRole("link", { name: linkName }).first().click();
    await expect(page).toHaveURL(expectedUrl);
  }
  // Navigate back to /today via the Today tab (completes the circuit)
  await page.getByRole("link", { name: /today/i }).first().click();
  await expect(page).toHaveURL(/\/today$/);
});

test("legacy / redirects to /today", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(page.url()).toMatch(/\/today$/);
});
