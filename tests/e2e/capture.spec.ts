import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { resetApiState } from "./test-helpers";

const receiptFixture = path.join(__dirname, "..", "fixtures", "receipt.jpg");
const invoiceFixture = path.join(__dirname, "..", "fixtures", "invoice.pdf");

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

test("capture page shows quick-add, drop-zone, drafts, and the evidence archive", async ({ page }) => {
  await page.goto("/capture");
  await expect(page.getByTestId("quick-add-grid")).toBeVisible();
  await expect(page.getByTestId("capture-dropzone")).toBeVisible();
  await expect(page.getByTestId("drafts-table")).toBeVisible();
  await expect(page.getByTestId("evidence-archive")).toBeVisible();
  await expect(page.getByText("Full implementation lands in Phase 5")).toHaveCount(0);
});

test("picked files become drafts with thumbnails and promote on retry", async ({ page }) => {
  await page.goto("/capture");
  // Block upload-init so the fire-and-forget promotion fails and the drafts stay
  // visible — this pins the thumbnail rendering AND the drafts-table retry path.
  await page.route("**/api/uploads/init", (route) => route.abort());
  await page.getByTestId("capture-file-input").setInputFiles([receiptFixture, invoiceFixture]);
  await expect(page.getByTestId("draft-row")).toHaveCount(2);
  // One <img> thumb for the JPEG, one FileText icon for the PDF.
  await expect(page.getByTestId("draft-thumb")).toHaveCount(2);

  await page.unroute("**/api/uploads/init");
  await page.getByTestId("draft-promote").first().click();
  await expect(page.getByTestId("draft-row")).toHaveCount(1);
  await page.getByTestId("draft-promote").first().click();
  await expect(page.getByTestId("draft-row")).toHaveCount(0);
  // Seeded evidence + the two promoted files.
  await expect(page.getByTestId("evidence-row")).toHaveCount(3);
});

test("a picked file auto-promotes into the evidence archive", async ({ page }) => {
  await page.goto("/capture");
  await page.getByTestId("capture-file-input").setInputFiles(receiptFixture);
  // Promotion is fire-and-forget: the draft clears itself once createEvidence lands,
  // and the archive gains a row (seeded evidence + the promoted file).
  await expect(page.getByTestId("evidence-row")).toHaveCount(2);
  await expect(page.getByTestId("draft-row")).toHaveCount(0);
});

test("an evidence row drills through to detail with the hash visible", async ({ page }) => {
  await page.goto("/capture");
  await expect(page.getByTestId("evidence-row").first()).toBeVisible();
  await page.getByTestId("evidence-open").first().click();
  await expect(page).toHaveURL(/\/capture\/evidence\//);
  await expect(page.getByTestId("evidence-hash")).toBeVisible();
});

// Intentionally skipped: driving navigator.clipboard.read() requires clipboard-read
// permission grants that are Chromium-CDP-only and flaky in CI, and Playwright cannot
// put an image onto the OS clipboard cross-platform. The paste tile and the document
// paste listener funnel through the same `captureFiles` pipeline the file-input specs
// above already exercise end-to-end.
test.skip("clipboard paste promotes a copied image", () => {});

test("capture has no serious accessibility violations", async ({ page }) => {
  await page.goto("/capture");
  await expect(page.getByTestId("quick-add-grid")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
});
