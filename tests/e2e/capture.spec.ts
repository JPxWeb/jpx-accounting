import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { installConsoleGuard } from "./console-guard";
import { activateControl, apiBaseUrl, createEvidencePayload, resetApiState } from "./test-helpers";

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

test("/capture renders with a clean console: no console.error, no pageerror", async ({ page }) => {
  const guard = await installConsoleGuard(page);

  await page.goto("/capture");
  await expect(page.getByTestId("quick-add-grid")).toBeVisible();
  await expect(page.getByTestId("evidence-archive")).toBeVisible();
  guard.assertClean();
});

// Small row controls (draft-promote, evidence-open) are activated via
// `activateControl`: pointer click on desktop, keyboard on mobile — see the
// helper's doc comment for the Pixel 7 visual-viewport emulation quirk.

test("picked files become drafts with thumbnails and promote on retry", async ({ page, isMobile }) => {
  await page.goto("/capture");
  // Block upload-init so the fire-and-forget promotion fails and the drafts stay
  // visible — this pins the thumbnail rendering AND the drafts-table retry path.
  let abortedInitCalls = 0;
  await page.route("**/api/uploads/init", (route) => {
    abortedInitCalls += 1;
    return route.abort();
  });
  await page.getByTestId("capture-file-input").setInputFiles([receiptFixture, invoiceFixture]);
  await expect(page.getByTestId("draft-row")).toHaveCount(2);
  // One <img> thumb for the JPEG, one FileText icon for the PDF.
  await expect(page.getByTestId("draft-thumb")).toHaveCount(2);

  // Draft rows render BEFORE the fire-and-forget promotions reach the network,
  // so unrouting on the row count alone races them: on the slower mobile
  // emulation both auto-promote initUploads can fire after the unroute,
  // succeed, and clear the drafts with no button press. Wait until both
  // auto-promotions have consumed their (aborted) attempt first.
  await expect.poll(() => abortedInitCalls).toBe(2);
  await page.unroute("**/api/uploads/init");
  await activateControl(page.getByTestId("draft-promote").first(), isMobile);
  await expect(page.getByTestId("draft-row")).toHaveCount(1);
  await activateControl(page.getByTestId("draft-promote").first(), isMobile);
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

test("an evidence row drills through to detail with the hash visible", async ({ page, isMobile }) => {
  await page.goto("/capture");
  await expect(page.getByTestId("evidence-row").first()).toBeVisible();
  await activateControl(page.getByTestId("evidence-open").first(), isMobile);
  await expect(page).toHaveURL(/\/capture\/evidence\//);
  await expect(page.getByTestId("evidence-hash")).toBeVisible();
});

// Intentionally skipped: driving navigator.clipboard.read() requires clipboard-read
// permission grants that are Chromium-CDP-only and flaky in CI, and Playwright cannot
// put an image onto the OS clipboard cross-platform. The paste tile and the document
// paste listener funnel through the same `captureFiles` pipeline the file-input specs
// above already exercise end-to-end.
test.skip("clipboard paste promotes a copied image", () => {});

/** Narrow view of `GET /api/workspace` — only what the attach specs assert on. */
type AttachSnapshot = {
  reviews: { id: string; status: string }[];
  vouchers: { id: string; voucherNumber: string }[];
  reports: { journal: unknown[] };
};

async function readSnapshot(request: APIRequestContext): Promise<AttachSnapshot> {
  const response = await request.get(`${apiBaseUrl}/api/workspace`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as AttachSnapshot;
}

/** Open the SEEDED evidence ("OpenAI subscription invoice", still needs-review) from the archive. */
async function openSeededEvidence(page: Page, isMobile: boolean) {
  await page.goto("/capture");
  await page.getByTestId("evidence-search").fill("OpenAI subscription invoice");
  await activateControl(page.getByTestId("evidence-open").first(), isMobile);
  await expect(page.getByTestId("evidence-attach-picker")).toBeVisible();
}

test("evidence detail can attach a receipt to a different, already-posted voucher", async ({
  page,
  isMobile,
  request,
}) => {
  // Create a SECOND evidence+voucher+review directly (setup, not the flow under
  // test) and approve it so it carries a real V-number — attaching to an
  // "Utkast" target would be visually ambiguous (two drafts both render Draft).
  const created = await request.post(`${apiBaseUrl}/api/evidence`, {
    data: { ...createEvidencePayload, title: "Second receipt for attach test" },
  });
  expect(created.ok()).toBeTruthy();
  const { review } = (await created.json()) as { review: { id: string } };
  const approved = await request.post(`${apiBaseUrl}/api/reviews/${review.id}/approve`, { data: {} });
  expect(approved.ok()).toBeTruthy();
  const before = await readSnapshot(request);

  await openSeededEvidence(page, isMobile);

  const picker = page.getByTestId("evidence-attach-picker");
  // The evidence's own draft voucher is never a target for its own evidence.
  await expect(picker.getByRole("listitem")).toHaveCount(1);
  await expect(picker).not.toContainText("OpenAI subscription invoice");

  await picker.getByTestId("evidence-attach-search").fill("Second receipt");
  const candidate = picker.getByRole("listitem").first();
  await expect(candidate).toContainText("V-1001");
  await activateControl(candidate.getByRole("button"), isMobile);

  // The evidence now hangs off the posted voucher, not its own draft.
  await expect(page.getByTestId("evidence-review-links")).toContainText("V-1001");

  // Controller addition: the evidence's OWN auto-created draft must not linger
  // as a double-booking trap. It is rejected — which posts no lines and burns
  // no V-number, since KFR E.1 mints numbers at posting time only.
  const after = await readSnapshot(request);
  expect(after.reviews.filter((r) => r.status === "needs-review")).toHaveLength(0);
  expect(after.vouchers.filter((v) => v.voucherNumber.startsWith("V-"))).toHaveLength(1);
  // Neither the relink nor the discard posts anything: the journal is unmoved.
  expect(after.reports.journal).toEqual(before.reports.journal);
});

test("evidence detail can attach a receipt to imported SIE history", async ({ page, isMobile, request }) => {
  // The migration story this picker exists for: an imported voucher starts with
  // `evidencePacketId: null`, so `targetVoucherId` is the ONLY way to give it
  // its receipt — there is no packet breadcrumb to auto-detect from.
  const sieFixture = [
    "#FLAGGA 0",
    "#SIETYP 4",
    '#KONTO 6110 "Kontorsmateriel"',
    '#VER A 77 20260315 "SIE import via Playwright"',
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

  await openSeededEvidence(page, isMobile);
  const picker = page.getByTestId("evidence-attach-picker");
  await picker.getByTestId("evidence-attach-search").fill("A 77");
  const candidate = picker.getByRole("listitem").first();
  // Migrated history keeps its real "<series> <number>" and says where it came from.
  await expect(candidate).toContainText("A 77");
  await expect(candidate).toContainText("Imported");
  await activateControl(candidate.getByRole("button"), isMobile);

  // An imported voucher carries no review, so the links section shows the
  // number alone — and the receipt's own draft is still discarded.
  await expect(page.getByTestId("evidence-review-links")).toContainText("A 77");
  const snapshot = await readSnapshot(request);
  expect(snapshot.reviews.filter((r) => r.status === "needs-review")).toHaveLength(0);
});

test("a failed attach surfaces an error and leaves the evidence's own draft intact", async ({
  page,
  isMobile,
  request,
}) => {
  // A second (undecided) evidence just so the picker has a candidate to click.
  const created = await request.post(`${apiBaseUrl}/api/evidence`, {
    data: { ...createEvidencePayload, title: "Stale attach target" },
  });
  expect(created.ok()).toBeTruthy();

  // Simulate the only real 404 path: a snapshot that has gone stale under the
  // picker (the target voucher no longer exists server-side).
  await page.route("**/api-proxy/api/evidence/compose", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ code: "voucher_not_found", message: "Voucher not found", requestId: "test" }),
    }),
  );

  await openSeededEvidence(page, isMobile);
  const picker = page.getByTestId("evidence-attach-picker");
  await picker.getByTestId("evidence-attach-search").fill("Stale attach target");
  await activateControl(picker.getByRole("listitem").first().getByRole("button"), isMobile);

  await expect(page.getByTestId("evidence-attach-error")).toBeVisible();
  // Attach-then-discard ordering: a failed attach must never destroy the draft.
  const snapshot = await readSnapshot(request);
  expect(snapshot.reviews.filter((r) => r.status === "needs-review")).toHaveLength(2);
});

test("capture has no serious accessibility violations", async ({ page }) => {
  await page.goto("/capture");
  await expect(page.getByTestId("quick-add-grid")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
});
