import { expect, test, type APIRequestContext } from "@playwright/test";

import { installConsoleGuard } from "./console-guard";
import { activateControl, apiBaseUrl, resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

async function approvePendingVoucher(request: APIRequestContext): Promise<string> {
  const workspaceResponse = await request.get(`${apiBaseUrl}/api/workspace`);
  expect(workspaceResponse.ok()).toBeTruthy();
  const workspace = (await workspaceResponse.json()) as {
    reviews: Array<{ id: string; status: string; voucherId: string }>;
  };
  const pendingReview = workspace.reviews.find((review) => review.status === "needs-review");
  expect(pendingReview).toBeTruthy();

  const approvalResponse = await request.post(`${apiBaseUrl}/api/reviews/${pendingReview!.id}/approve`, {
    data: {},
  });
  expect(approvalResponse.ok()).toBeTruthy();
  return pendingReview!.voucherId;
}

test("posted lines expose stable targets and VAT while seed rows remain untargetable", async ({
  page,
  request,
  isMobile,
}) => {
  const guard = await installConsoleGuard(page);

  await page.goto("/books?view=journal&ledgerMode=inline");
  await activateControl(page.getByTestId("ledger-voucher-toggle").first(), isMobile);
  await expect(page.getByTestId("ledger-slot-lineId-disabled")).toBeVisible();
  await expect(page.getByTestId("ledger-line-target")).toHaveCount(0);

  const voucherId = await approvePendingVoucher(request);
  await page.goto(`/books?view=journal&ledgerMode=inline&voucher=${encodeURIComponent(voucherId)}`);
  const detail = page.getByTestId("ledger-voucher-detail");
  await expect(detail).toBeVisible();
  await expect(detail.getByTestId("ledger-slot-lineId-disabled")).toHaveCount(0);
  await expect(detail.getByTestId("ledger-slot-vatDeductibility-disabled")).toHaveCount(0);

  const targets = detail.getByTestId("ledger-line-target");
  await expect(targets).toHaveCount(3);
  for (const target of await targets.all()) {
    await expect(target).toHaveAttribute("data-line-id", /^(ln|legacy)_/);
    await expect(target).not.toContainText("journal_");
  }
  await expect(detail.getByTestId("ledger-line-vat")).toHaveCount(3);
  await expect(detail.getByTestId("ledger-line-deductibility")).toHaveCount(3);

  guard.assertClean();
});
