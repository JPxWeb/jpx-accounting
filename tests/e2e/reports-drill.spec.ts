import { expect, test, type APIRequestContext } from "@playwright/test";

import { expectAccessible } from "./a11y-helpers";
import { activateControl, apiBaseUrl, resetApiState } from "./test-helpers";

// Drill controls (chart rows, drawer links) are activated via
// `activateControl`: pointer click on desktop, keyboard on mobile — see the
// helper's doc comment for the Pixel 7 visual-viewport emulation quirk.

/**
 * Drill grammar (advisory-pivot Phase 4, Task 4.8): report number → account
 * drawer → voucher chip → evidence, plus the general-ledger handoff that
 * carries the SAME period token. The voucher chip is honest (plan finding 4):
 * a real link only when voucher+packet+evidence resolve; SIE imports get an
 * "Imported" badge; anything else is plain text — never a dead link.
 */

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

/** Approve the seeded demo review so account 6540 has two journal lines (seed + posted voucher). */
async function approveSeededReview(request: APIRequestContext) {
  const workspace = await (await request.get(`${apiBaseUrl}/api/workspace`)).json();
  const review = workspace.reviews[0];
  expect(review).toBeTruthy();
  const approved = await request.post(`${apiBaseUrl}/api/reviews/${review.id}/approve`, {
    data: { actorId: "user_founder", notes: "Approved for drill E2E" },
  });
  expect(approved.ok()).toBeTruthy();
}

test("cash-bridge row drills to the account drawer, through the voucher link to evidence, and hands off to the GL", async ({
  page,
  request,
  isMobile,
}) => {
  await approveSeededReview(request);

  await page.goto("/reports");

  // The bridge chart is a lazy chunk — the table toggle appears with it.
  await activateControl(page.getByTestId("chart-table-toggle-cash-bridge"), isMobile);
  await activateControl(page.getByTestId("cash-bridge-row-6540"), isMobile);

  // Drawer opens on ?drill=6540 with both 6540 lines (seed + approved voucher).
  const drawer = page.getByTestId("account-drill-drawer");
  await expect(drawer).toBeVisible();
  await expect(page).toHaveURL(/drill=6540/);
  await expect(drawer.getByTestId("drill-line")).not.toHaveCount(0);
  expect(await drawer.getByTestId("drill-line").count()).toBeGreaterThanOrEqual(2);

  // The approved voucher resolves voucher→packet→evidence, the seed line
  // stays plain text — exactly one real link.
  await expect(drawer.getByTestId("drill-voucher-link")).toHaveCount(1);

  // Axe with the dialog open (focus trap, aria-modal, names).
  await expectAccessible(page);

  await activateControl(drawer.getByTestId("drill-voucher-link"), isMobile);
  await expect(page).toHaveURL(/\/capture\/evidence\//);
  await expect(page.getByTestId("evidence-preview")).toBeVisible();

  // Back-safe: the drawer state lives in the URL.
  await page.goBack();
  await expect(page.getByTestId("account-drill-drawer")).toBeVisible();

  // GL handoff carries BOTH the account and the same period token.
  await activateControl(page.getByTestId("drill-open-ledger"), isMobile);
  await expect(page).toHaveURL(/\/books\?/);
  await expect(page).toHaveURL(/view=general-ledger/);
  await expect(page).toHaveURL(/account=6540/);
  await expect(page).toHaveURL(/period=\d{4}-\d{2}/);
  await expect(page.getByTestId("ledger-account-filter")).toBeVisible();
});

test("SIE-imported lines show the Imported badge and never a dead link", async ({ page, request, isMobile }) => {
  // Pinned March fixture (plan finding 8): permanently outside the default period.
  const sieFixture = [
    "#FLAGGA 0",
    "#SIETYP 4",
    '#KONTO 6110 "Kontorsmateriel"',
    '#VER A 90 20260315 "March window fixture"',
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
  expect(await imported.json()).toMatchObject({ accepted: true, importedVouchers: 1 });

  await page.goto("/reports?period=2026-03");

  // Statement line → drawer for the imported account.
  await activateControl(page.locator('[data-testid="pnl-line"][data-account="6110"]'), isMobile);
  const drawer = page.getByTestId("account-drill-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId("drill-line")).toHaveCount(1);
  await expect(drawer.getByTestId("drill-imported-badge")).toBeVisible();
  await expect(drawer.getByTestId("drill-voucher-link")).toHaveCount(0);
});
