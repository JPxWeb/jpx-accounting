import { expect, test } from "@playwright/test";

import { resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

test("navigation and share target flows stay reachable", async ({ page }) => {
  await page.goto("/");

  if (test.info().project.name.includes("mobile")) {
    await expect(page.getByTestId("mobile-dock")).toBeVisible();
  } else {
    await expect(page.getByTestId("desktop-navigation")).toBeVisible();
  }

  await page.getByRole("link", { name: "Reports" }).click();
  await expect(page).toHaveURL(/\/reports$/);

  await page.getByRole("link", { name: "Control" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByTestId("settings-hero")).toContainText("Control Plane");
  await expect(page.getByTestId("deployment-posture")).toContainText("Sweden Central");
  await expect(page.getByTestId("audit-spine")).toContainText("Append-only events");

  await page.goto("/share?title=Taxi%20Receipt&text=Airport%20transfer&url=https%3A%2F%2Fexample.com%2Freceipt");
  await expect(page.getByTestId("share-target-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Taxi Receipt" })).toBeVisible();
  await expect(page.getByTestId("share-text")).toHaveText("Airport transfer");
  await expect(page.getByTestId("share-url")).toHaveText("https://example.com/receipt");
});
