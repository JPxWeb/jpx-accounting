import { expect, test } from "@playwright/test";

import { resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

const screensWithLongContent = [
  // `vat-preparation` used to stand in for "last card on /reports", but it never
  // was one: `TaxTimelineRow` and the compliance-watch panel both render after
  // the VAT table (see `reports-screen.tsx`). While the VAT card was short
  // enough the substitution went unnoticed, because Playwright's
  // `scrollIntoViewIfNeeded` centres a card that fits the viewport and a short
  // card centres clear of the dock. KFR Phase C added the statutory boxes 39
  // and 40 (11 rows -> 13, +74 px), the centred card sank 37 px, and the
  // assertion started failing on a card that is not the one this spec is about.
  // Target the real last card — the canvas bottom padding is what's under test.
  { path: "/reports", lastCardTestId: "alerts-panel" },
  // Task 5.9 rebuilt /assistant: the chat panel is taller than the mobile
  // viewport, so target its bottom-most interactive element instead — the
  // Send button still lands under the dock if the canvas padding regresses.
  { path: "/assistant", lastCardTestId: "assistant-submit" },
  // /settings redirects to /settings/company (PR-D2); the long About page keeps billing-card last.
  { path: "/settings/about", lastCardTestId: "billing-card" },
];

for (const { path, lastCardTestId } of screensWithLongContent) {
  test(`mobile dock does not overlap last card on ${path}`, async ({ page }) => {
    test.skip(!test.info().project.name.includes("mobile"), "mobile-only");

    await page.goto(path);

    const lastCard = page.getByTestId(lastCardTestId);
    await lastCard.scrollIntoViewIfNeeded();
    const cardBox = await lastCard.boundingBox();
    expect(cardBox).not.toBeNull();

    const dock = page.getByTestId("mobile-dock");
    const dockBox = await dock.boundingBox();
    expect(dockBox).not.toBeNull();

    // The bottom of the last card must clear the top of the fixed dock.
    expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(dockBox!.y);
  });
}

test("the VAT return card still fits in the dock-free viewport band", async ({ page }) => {
  test.skip(!test.info().project.name.includes("mobile"), "mobile-only");

  // The real invariant Phase C's two extra VAT boxes threatened. Every route
  // into this card top-aligns it — the `vat-status` widget drill and the
  // vat-position narrative both link `/reports#vat-preparation` — so the whole
  // momsdeklaration is readable in one screen only while the card is no taller
  // than the band above the dock. Each statutory box costs ~37 px of that
  // budget; when this fails, restructure the card (split the table, collapse
  // the zero rows), do not shrink the dock or the canvas padding.
  await page.goto("/reports");

  const card = page.getByTestId("vat-preparation");
  await card.scrollIntoViewIfNeeded();
  const cardBox = await card.boundingBox();
  expect(cardBox).not.toBeNull();

  const dockBox = await page.getByTestId("mobile-dock").boundingBox();
  expect(dockBox).not.toBeNull();

  expect(cardBox!.height).toBeLessThanOrEqual(dockBox!.y);
});
