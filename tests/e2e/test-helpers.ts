import { expect, type APIRequestContext, type Locator } from "@playwright/test";

export const apiBaseUrl = process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:3201";

/**
 * Activate a button: pointer click on desktop, trusted keyboard (focus +
 * Enter) on the mobile project.
 *
 * Why not always click: on mobile-chromium (Pixel 7), Chromium's emulated
 * URL-bar/virtual-keyboard behavior gives the page a layout viewport (890px)
 * taller than the visual viewport (839px, the configured device height).
 * Focusing an editable near the bottom (e.g. `fill()` on the advisor
 * textarea) engages an extended-scroll state with
 * `visualViewport.offsetTop = 51` that nothing disengages (not blur, not
 * `window.scrollTo`). In that state Playwright's pointer pipeline hit-tests
 * every click point 51px above the target, so any control shorter than ~51px
 * fails actionability forever — the click log alternates between
 * "<p> …intercepts pointer events" (offset engaged) and "mobile-dock subtree
 * intercepts pointer events" (offset 0, target bottom-aligned under the fixed
 * dock) until the test times out. `locator.tap()` rides the same pipeline and
 * fails identically. Keyboard activation is coordinate-free real input — what
 * a keyboard user does — so it is immune. Pointer reachability on mobile
 * stays covered by `mobile-bottom-clearance.spec.ts`.
 */
export async function activateControl(locator: Locator, isMobile: boolean) {
  if (!isMobile) {
    await locator.click();
    return;
  }
  // Mirror click()'s auto-wait: a disabled button is not focusable, so Enter
  // would silently land on <body> during e.g. the advisor's `busy` window.
  await expect(locator).toBeEnabled();
  await locator.focus();
  await locator.press("Enter");
}

export const createEvidencePayload = {
  organizationId: "org_jpx",
  workspaceId: "workspace_main",
  actorId: "user_founder",
  title: "Playwright evidence sample",
  originalFilename: "playwright-receipt.jpg",
  mimeType: "image/jpeg",
  modalities: ["camera", "screenshot"] as const,
  extractedText: "Receipt captured during browser test coverage",
};

export async function resetApiState(request: APIRequestContext) {
  const response = await request.post(`${apiBaseUrl}/api/testing/reset`);

  if (!response.ok()) {
    throw new Error(`Failed to reset test API state: ${response.status()} ${response.statusText()}`);
  }
}
