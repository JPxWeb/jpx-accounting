import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

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
 *
 * `key` defaults to Enter (buttons, links). Pass "Space" for controls whose
 * ARIA pattern activates on Space instead — use `checkControl` below for
 * checkboxes rather than passing "Space" here directly.
 */
export async function activateControl(locator: Locator, isMobile: boolean, key: "Enter" | "Space" = "Enter") {
  if (!isMobile) {
    await locator.click();
    return;
  }
  // Mirror click()'s auto-wait: a disabled button is not focusable, so Enter
  // would silently land on <body> during e.g. the advisor's `busy` window.
  await expect(locator).toBeEnabled();
  await locator.focus();
  await locator.press(key);
}

/**
 * Check a checkbox: `check()` on desktop, trusted keyboard (focus + Space) on
 * mobile — same visual-viewport rationale as `activateControl`. Space, not
 * Enter: a native `<input type="checkbox">` (and the ARIA checkbox pattern)
 * toggles on Space only. Mirrors `check()`'s semantics: no-op when already
 * checked, and verifies the resulting checked state.
 */
export async function checkControl(locator: Locator, isMobile: boolean) {
  if (!isMobile) {
    await locator.check();
    return;
  }
  await expect(locator).toBeEnabled();
  if (await locator.isChecked()) {
    return;
  }
  await locator.focus();
  await locator.press("Space");
  await expect(locator).toBeChecked();
}

/**
 * Pick an option from a Radix-style Select (shadcn `ui/select`): pointer
 * clicks on desktop, trusted keyboard on mobile — same visual-viewport
 * rationale as `activateControl`. The keyboard path mirrors the ARIA
 * combobox/listbox pattern: Enter opens the listbox, type-ahead highlights
 * the option, Enter commits. `optionLabel` must not contain spaces (Space
 * commits the currently highlighted item in Radix Select mid-type-ahead).
 * Verifies the trigger renders the picked label, mirroring what a click-based
 * pick guarantees.
 */
export async function pickSelectOption(page: Page, testId: string, optionLabel: string, isMobile: boolean) {
  const trigger = page.getByTestId(testId);
  if (!isMobile) {
    await trigger.click();
    await page.getByRole("option", { name: optionLabel }).click();
    return;
  }
  await expect(trigger).toBeEnabled();
  await trigger.focus();
  await trigger.press("Enter");
  await expect(page.getByRole("option", { name: optionLabel })).toBeVisible();
  await page.keyboard.type(optionLabel);
  await page.keyboard.press("Enter");
  await expect(trigger).toContainText(optionLabel);
}

export const createEvidencePayload = {
  organizationId: "org_jpx",
  workspaceId: "workspace_main",

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
