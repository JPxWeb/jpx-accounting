import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

test("capture page shows quick-add, drafts, and the evidence archive", async ({ page }) => {
  await page.goto("/capture");
  await expect(page.getByTestId("quick-add-grid")).toBeVisible();
  await expect(page.getByTestId("drafts-table")).toBeVisible();
  await expect(page.getByTestId("evidence-archive")).toBeVisible();
  await expect(page.getByText("Full implementation lands in Phase 5")).toHaveCount(0);
});

test("a quick-add draft appears in the drafts table and can be promoted", async ({ page }) => {
  await page.goto("/capture");
  await page.getByTestId("quick-add-upload").click();
  await expect(page.getByTestId("draft-row").first()).toBeVisible();
  await page.getByTestId("draft-promote").first().click();
  await expect(page.getByTestId("evidence-row").first()).toBeVisible();
});

test("an evidence row drills through to detail with the hash visible", async ({ page }) => {
  await page.goto("/capture");
  await expect(page.getByTestId("evidence-row").first()).toBeVisible();
  await page.getByTestId("evidence-open").first().click();
  await expect(page).toHaveURL(/\/capture\/evidence\//);
  await expect(page.getByTestId("evidence-hash")).toBeVisible();
});

test("capture has no serious accessibility violations", async ({ page }) => {
  await page.goto("/capture");
  await expect(page.getByTestId("quick-add-grid")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
});
