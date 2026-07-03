import { expect, test } from "@playwright/test";

import { resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

const screensWithLongContent = [
  { path: "/reports", lastCardTestId: "vat-preparation" },
  { path: "/assistant", lastCardTestId: "policy-rules-studio" },
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
