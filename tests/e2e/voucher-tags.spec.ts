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

test("add a registry tag with confirmation then filter the journal by tag", async ({ page, request, isMobile }) => {
  const guard = await installConsoleGuard(page);
  const voucherId = await approvePendingVoucher(request);

  await page.goto(`/books?view=journal&ledgerMode=inline&voucher=${encodeURIComponent(voucherId)}`);
  await activateControl(page.getByTestId("tag-add"), isMobile);
  await activateControl(page.getByTestId("tag-option-tag_travel"), isMobile);
  await activateControl(page.getByTestId("tag-confirm"), isMobile);
  await expect(page.getByTestId("tag-chip-tag_travel")).toBeVisible();

  await activateControl(page.getByTestId("tag-filter-link-tag_travel"), isMobile);
  await expect(page).toHaveURL(/(?:\?|&)tag=tag_travel(?:&|$)/);
  await expect(page.getByTestId("tag-filter-chip")).toBeVisible();
  await expect(page.getByTestId("ledger-voucher-toggle")).toHaveCount(1);

  await activateControl(page.getByRole("button", { name: /Clear tag filter|Rensa taggfiltret/ }), isMobile);
  await activateControl(page.getByTestId("ledger-voucher-toggle").first(), isMobile);
  const removeTag = page.getByTestId("tag-remove-tag_travel");
  await activateControl(removeTag, isMobile);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tag-dialog")).toHaveCount(0);
  await expect(removeTag).toBeFocused();

  await activateControl(removeTag, isMobile);
  await activateControl(page.getByTestId("tag-confirm"), isMobile);
  await expect(page.getByTestId("tag-chip-tag_travel")).toHaveCount(0);
  await expect(page.getByTestId("tag-empty")).toBeVisible();
  guard.assertClean();
});

test("MCP tag proposal waits for human confirmation and refreshes the voucher tags", async ({
  page,
  request,
  isMobile,
}) => {
  const guard = await installConsoleGuard(page);
  const voucherId = await approvePendingVoucher(request);
  const proposalResponse = await request.post(`${apiBaseUrl}/api/enrichment-work-items`, {
    data: {
      targetKind: "voucher",
      targetId: voucherId,
      proposedChange: { kind: "voucher_tags_add", tagIds: ["tag_travel"] },
      source: "mcp",
      idempotencyKey: `e2e:voucher-tags:${voucherId}`,
    },
  });
  const proposalBody = await proposalResponse.text();
  expect(proposalResponse.ok(), proposalBody).toBeTruthy();
  const workItem = JSON.parse(proposalBody) as { id: string };

  await page.goto(
    `/books?view=journal&ledgerMode=inline&voucher=${encodeURIComponent(voucherId)}&enrichmentWorkItem=${encodeURIComponent(workItem.id)}`,
  );
  const shell = page.getByTestId("enrichment-confirm-shell");
  await expect(shell.getByTestId("enrichment-article-50-marker")).toBeVisible();
  await expect(shell.getByTestId("enrichment-proposal")).toContainText(/Travel|Resa/);
  await expect(page.getByTestId("tag-chip-tag_travel")).toHaveCount(0);

  await activateControl(shell.getByTestId("enrichment-confirm"), isMobile);
  await expect(shell.getByTestId("enrichment-status")).toHaveText(/Confirmed|Bekräftad/);
  await activateControl(shell.getByTestId("enrichment-confirm-close"), isMobile);
  await expect(page.getByTestId("tag-chip-tag_travel")).toBeVisible();
  guard.assertClean();
});
