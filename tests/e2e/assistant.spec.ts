import { expect, test } from "@playwright/test";

import { activateControl, resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

// The advisor buttons (Send, approve, reject) are activated via
// `activateControl`: pointer click on desktop, keyboard on mobile — see the
// helper's doc comment for the Pixel 7 visual-viewport emulation quirk that
// makes pointer clicks on these small controls hang until the test timeout.

test("advisor streams a grounded, Article 50-labeled answer with provenance", async ({ page, isMobile }) => {
  await page.goto("/assistant");

  // Persistent Article 50 label + the suggested-prompt trio on the empty state
  // (observation-derived keys topped up from the static fallback trio).
  await expect(page.getByTestId("ai-assistant-label")).toBeVisible();
  await expect(page.getByTestId("advisor-suggested-prompt")).toHaveCount(3);

  // "moms" is a guaranteed corpus token (BM25 keyword retrieval has no
  // stemming), so this cash/VAT question always yields sourced passages.
  await page.getByTestId("assistant-question").fill("Hur ser kassan ut just nu, och vad gäller för moms?");
  await activateControl(page.getByTestId("assistant-submit"), isMobile);

  const answer = page.getByTestId("advisor-message").last();
  // Streamed text embeds the grounding block — numbers copied from the report
  // pack, including the cash line.
  await expect(answer).toContainText("Kassa (19xx)");
  // Every assistant message carries the per-message AI marker (Article 50).
  await expect(answer.getByTestId("ai-generated-marker")).toBeVisible();
  // The data-provenance part renders sourced chips citing official sources.
  await expect(answer.getByTestId("provenance-chip").first()).toBeVisible();
  await expect(answer.getByTestId("provenance-chip").first()).toContainText(/Skatteverket|Bokföringslagen|BAS/);
});

test("a drafted review approval executes only after explicit human approval", async ({ page, isMobile }) => {
  await page.goto("/assistant");

  // A review-action question with the seeded pending review present makes the
  // advisor stream a proposeReviewAction tool part in the approval-requested
  // state — a draft, not an action.
  await page.getByTestId("assistant-question").fill("godkänn granskningen");
  await activateControl(page.getByTestId("assistant-submit"), isMobile);

  const approvalCard = page.getByTestId("advisor-approval-card");
  await expect(approvalCard).toBeVisible();
  await expect(approvalCard).toContainText("Draft by AI — awaiting your approval");
  await expect(approvalCard).toContainText("Approve AI subscription posting");

  // Explicit human approval → the turn re-sends and the server executes the
  // ordinary applyReviewDecision through the review gate.
  await activateControl(approvalCard.getByTestId("advisor-approve-tool"), isMobile);

  const toolResult = page.getByTestId("advisor-tool-result");
  await expect(toolResult).toBeVisible();
  await expect(toolResult).toHaveAttribute("data-approved", "true");
  await expect(toolResult).toContainText("godkändes via granskningskön");

  // The review gate did the posting: the queue shows the item approved.
  await page.goto("/today?view=queue");
  await expect(page.getByTestId("review-status").filter({ hasText: "approved" })).toHaveCount(1);
});

test("rejecting a drafted approval posts nothing", async ({ page, isMobile }) => {
  await page.goto("/assistant");

  await page.getByTestId("assistant-question").fill("godkänn granskningen");
  await activateControl(page.getByTestId("assistant-submit"), isMobile);

  const approvalCard = page.getByTestId("advisor-approval-card");
  await expect(approvalCard).toBeVisible();
  await activateControl(approvalCard.getByTestId("advisor-reject-tool"), isMobile);

  const toolResult = page.getByTestId("advisor-tool-result");
  await expect(toolResult).toBeVisible();
  await expect(toolResult).toHaveAttribute("data-approved", "false");

  // Denial leaves the queue untouched: the seeded review still needs review.
  await page.goto("/today?view=queue");
  await expect(page.getByTestId("review-status").filter({ hasText: "needs-review" })).toHaveCount(1);
});

test("desktop rail Advisor link navigates to the assistant", async ({ page, isMobile }) => {
  test.skip(isMobile, "The Advisor entry is rail-only; the mobile dock keeps its 5 tabs.");

  await page.goto("/today");

  const railAdvisorLink = page.getByTestId("desktop-navigation").getByRole("link", { name: /Advisor/ });
  await expect(railAdvisorLink).toBeVisible();
  await railAdvisorLink.click();

  await expect(page).toHaveURL(/\/assistant/);
  await expect(page.getByTestId("assistant-panel")).toBeVisible();
  await expect(railAdvisorLink).toHaveAttribute("aria-current", "page");
});

test("the mobile dock keeps five tabs without an Advisor entry", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Dock composition only applies to the mobile project.");

  await page.goto("/today");

  const dock = page.getByTestId("mobile-dock");
  await expect(dock.getByRole("link")).toHaveCount(5);
  await expect(dock.getByRole("link", { name: /Advisor/ })).toHaveCount(0);
});

// Runs on both projects: on mobile the palette is the only Advisor entry point.
test("the command palette 'Ask advisor' action opens the assistant", async ({ page }) => {
  await page.goto("/today?view=queue");
  // The review card is client-rendered, so its presence proves the shell is
  // hydrated and the global Ctrl/Cmd+K listener is attached.
  await expect(page.getByTestId("review-card").first()).toBeVisible();

  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("command-palette")).toBeVisible();

  await page.getByTestId("palette-ask-advisor").click();

  await expect(page).toHaveURL(/\/assistant/);
  await expect(page.getByTestId("assistant-panel")).toBeVisible();
});
