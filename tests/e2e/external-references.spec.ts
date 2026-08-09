import { expect, test } from "@playwright/test";

import { installConsoleGuard } from "./console-guard";
import { activateControl, apiBaseUrl, resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

test("link https external reference on posted voucher then unlink", async ({ page, request, isMobile }) => {
  const guard = await installConsoleGuard(page);
  const workspaceResponse = await request.get(`${apiBaseUrl}/api/workspace`);
  expect(workspaceResponse.ok()).toBeTruthy();
  const workspace = (await workspaceResponse.json()) as {
    reviews: Array<{ id: string; status: string }>;
  };
  const pendingReview = workspace.reviews.find((review) => review.status === "needs-review");
  expect(pendingReview).toBeTruthy();
  const approvalResponse = await request.post(`${apiBaseUrl}/api/reviews/${pendingReview!.id}/approve`, {
    data: {},
  });
  expect(approvalResponse.ok()).toBeTruthy();

  await page.goto("/books?view=journal&ledgerMode=inline");
  await activateControl(page.getByTestId("ledger-voucher-toggle").first(), isMobile);
  await activateControl(page.getByTestId("external-ref-add"), isMobile);
  await page.getByTestId("external-ref-url").fill("https://example.com/doc");
  await activateControl(page.getByTestId("external-ref-confirm"), isMobile);

  await expect(page.getByTestId("external-ref-row")).toContainText("example.com");
  await activateControl(page.getByTestId("external-ref-unlink").first(), isMobile);
  await activateControl(page.getByTestId("external-ref-unlink-confirm"), isMobile);
  await expect(page.getByTestId("external-ref-row")).toHaveCount(0);
  guard.assertClean();
});
