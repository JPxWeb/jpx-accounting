import { expect, test } from "@playwright/test";

import { activateControl, apiBaseUrl, resetApiState } from "./test-helpers";

// The posture switches are plain <button role="switch"> elements, so
// `activateControl` (pointer on desktop, focus+Enter on mobile) applies —
// see the helper's doc comment for the Pixel 7 visual-viewport quirk.

/**
 * AI posture trust surfaces (Task 5.10): About-this-AI transparency panel,
 * EU AI Act Article 50 statement, and the per-surface toggles persisted on
 * `companySettings.aiPosture`. The toggles gate AI surfaces only — human
 * review actions stay fully operable when suggestions are off, and the
 * advisor screen shows an honest disabled panel when the advisor is off.
 */

// AI posture rides on the org company settings; the demo store starts with
// none saved, so seed a valid record through the ordinary settings endpoint.
const baselineCompanySettings = {
  organizationId: "org_jpx",
  organizationName: "Jpx Konsult AB",
  organizationNumber: "556677-8899",
  addressLine1: "Storgatan 1",
  postalCode: "111 22",
  city: "Stockholm",
  contactEmail: "kontakt@jpx.nu",
};

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
  const saved = await request.put(`${apiBaseUrl}/api/settings/company`, { data: baselineCompanySettings });
  expect(saved.ok()).toBeTruthy();
});

test("About-this-AI renders the runtime provider and the Article 50 statement", async ({ page }) => {
  await page.goto("/settings/ai-posture");

  // Demo mode is honestly labeled: local deterministic runtime, no external
  // AI service (and therefore no model/host rows to render).
  const about = page.getByTestId("about-this-ai");
  await expect(about).toBeVisible();
  await expect(about).toContainText("Demo");
  await expect(about).toContainText("Local demo runtime");
  await expect(about).toContainText("never posts");

  await expect(page.getByTestId("ai-article-50")).toContainText("Article 50");

  // Both toggles render checked (contract default: everything enabled).
  await expect(page.getByTestId("ai-toggle-advisor")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("ai-toggle-suggestions")).toHaveAttribute("aria-checked", "true");
});

test("posture toggles persist across reload", async ({ page, isMobile }) => {
  await page.goto("/settings/ai-posture");

  await activateControl(page.getByTestId("ai-toggle-suggestions"), isMobile);
  await expect(page.getByText("AI posture saved.")).toBeVisible();
  await expect(page.getByTestId("ai-toggle-suggestions")).toHaveAttribute("aria-checked", "false");

  // The demo API keeps MemoryLedgerStore state for the run, so the saved
  // posture must survive a reload — and the advisor toggle stays untouched.
  await page.reload();
  await expect(page.getByTestId("ai-toggle-suggestions")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("ai-toggle-advisor")).toHaveAttribute("aria-checked", "true");
});

test("suggestions off hides the AI block on queue cards but keeps human actions operable", async ({
  page,
  isMobile,
}) => {
  await page.goto("/settings/ai-posture");
  await activateControl(page.getByTestId("ai-toggle-suggestions"), isMobile);
  await expect(page.getByText("AI posture saved.")).toBeVisible();

  // Scope to actionable cards so the accept assertion is deterministic.
  await page.goto("/today?view=queue&status=needs-review");
  const firstCard = page.getByTestId("review-card").first();
  await expect(firstCard).toBeVisible();

  // The AI surface is hidden behind an honest notice — no confidence bands.
  await expect(firstCard.getByTestId("suggestions-disabled-notice")).toBeVisible();
  await expect(page.getByTestId("confidence-band")).toHaveCount(0);

  // Human actions stay fully operable: approving still goes through the
  // ordinary review gate, so the card leaves the needs-review filter.
  const pendingBefore = await page.getByTestId("review-card").count();
  const accept = firstCard.getByTestId("review-accept");
  await expect(accept).toBeEnabled();
  await activateControl(accept, isMobile);
  await expect(page.getByTestId("review-card")).toHaveCount(pendingBefore - 1);
});

test("advisor off shows the honest disabled panel on /assistant", async ({ page, isMobile }) => {
  await page.goto("/settings/ai-posture");
  await activateControl(page.getByTestId("ai-toggle-advisor"), isMobile);
  await expect(page.getByText("AI posture saved.")).toBeVisible();
  await expect(page.getByTestId("ai-toggle-advisor")).toHaveAttribute("aria-checked", "false");

  await page.goto("/assistant");
  await expect(page.getByTestId("advisor-disabled-panel")).toBeVisible();
  await expect(page.getByTestId("assistant-panel")).toHaveCount(0);
});
