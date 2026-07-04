import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { resetApiState } from "./test-helpers";

const receiptFixture = path.join(__dirname, "..", "fixtures", "receipt.jpg");

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

  await page.getByRole("link", { name: "Settings" }).click();
  // /settings redirects to the first sub-page (PR-D2 settings layout).
  await expect(page).toHaveURL(/\/settings\/company$/);

  // The build/deployment posture moved to /settings/about in the PR-D2 split.
  await page.goto("/settings/about");
  await expect(page.getByTestId("settings-hero")).toContainText("About this build");
  await expect(page.getByTestId("deployment-posture")).toContainText("Sweden Central");
  await expect(page.getByTestId("audit-spine")).toContainText("Append-only events");

  // PWA share target is an intake-only endpoint that redirects to /capture so the user lands
  // on the same surface whether content arrived via the in-app capture button or via the
  // operating-system share sheet.
  await page.goto("/share?title=Taxi%20Receipt&text=Airport%20transfer&url=https%3A%2F%2Fexample.com%2Freceipt");
  await expect(page).toHaveURL(/\/capture/);
  await expect(page.getByTestId("quick-add-grid")).toBeVisible();

  // Param-only shares are consumed for real: ONE share-mode draft with the shared title
  // appears in the drafts table, and the params are cleared so a refresh cannot duplicate it.
  await expect(page.getByTestId("draft-row").filter({ hasText: "Taxi Receipt" })).toBeVisible();
});

test("shared files are promoted server-side through the real pipeline", async ({ page, request }) => {
  // The forwarding runs server-side in the share route handler — device-independent,
  // so one desktop run covers it.
  test.skip(test.info().project.name.includes("mobile"), "server-side forwarding is device-independent");

  await page.goto("/capture");
  await expect(page.getByTestId("evidence-archive")).toBeVisible();
  // Wait for the archive to hydrate (the reset seed always has exactly one
  // evidence row) before taking the baseline — a bare count() races hydration.
  await expect(page.getByTestId("evidence-row")).toHaveCount(1);
  const rowsBefore = 1;

  // POST multipart to /share exactly like an OS share sheet would; Playwright follows the
  // 303 redirect, so the final URL carries the promoted count.
  const response = await request.post("/share", {
    multipart: {
      title: "Shared lunch receipt",
      files: {
        name: "receipt.jpg",
        mimeType: "image/jpeg",
        buffer: fs.readFileSync(receiptFixture),
      },
    },
  });
  expect(response.ok()).toBeTruthy();
  expect(response.url()).toContain("promoted=1");

  // The shared file went through initUpload → PUT → createEvidence server-side, so the
  // archive gains a row.
  await page.reload();
  await expect(page.getByTestId("evidence-row")).toHaveCount(rowsBefore + 1);
});
