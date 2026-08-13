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

test("link https external reference on posted voucher then unlink", async ({ page, request, isMobile }) => {
  const guard = await installConsoleGuard(page);
  const voucherId = await approvePendingVoucher(request);

  await page.goto(`/books?view=journal&ledgerMode=inline&voucher=${encodeURIComponent(voucherId)}`);
  await activateControl(page.getByTestId("external-ref-add"), isMobile);
  await page.getByTestId("external-ref-url").fill("http://example.com/insecure");
  await expect(page.getByText(/valid HTTPS URL|giltig HTTPS-URL/)).toBeVisible();
  await expect(page.getByTestId("external-ref-confirm")).toBeDisabled();
  await page.getByTestId("external-ref-url").fill("https://example.com/doc");
  await activateControl(page.getByTestId("external-ref-confirm"), isMobile);

  await expect(page.getByTestId("external-ref-row")).toContainText("example.com");
  await activateControl(page.getByTestId("external-ref-unlink").first(), isMobile);
  await activateControl(page.getByTestId("external-ref-unlink-confirm"), isMobile);
  await expect(page.getByTestId("external-ref-row")).toHaveCount(0);
  guard.assertClean();
});

test("MCP external reference proposal waits for human confirmation and refreshes the snapshot", async ({
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
      proposedChange: {
        kind: "external_reference_link",
        url: "https://example.com/mcp-document",
        label: "MCP document",
      },
      source: "mcp",
      idempotencyKey: `e2e:external-reference:${voucherId}`,
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
  await expect(shell.getByTestId("enrichment-proposal")).toContainText("https://example.com/mcp-document");
  await expect(page.getByTestId("external-ref-row")).toHaveCount(0);

  await activateControl(shell.getByTestId("enrichment-confirm"), isMobile);
  await expect(shell.getByTestId("enrichment-status")).toHaveText(/Confirmed|Bekräftad/);
  await activateControl(shell.getByTestId("enrichment-confirm-close"), isMobile);

  await expect(page.getByTestId("external-ref-row")).toContainText("MCP document");
  guard.assertClean();
});

test("nested external-reference dialog closes without dismissing the voucher drawer", async ({
  page,
  request,
  isMobile,
}) => {
  const guard = await installConsoleGuard(page);
  await approvePendingVoucher(request);

  await page.goto("/books?view=journal&ledgerMode=drawer");
  await activateControl(page.getByTestId("ledger-voucher-toggle").first(), isMobile);
  const drawer = page.getByTestId("ledger-voucher-drawer");
  await activateControl(drawer.getByTestId("external-ref-add"), isMobile);
  await expect(page.getByTestId("external-ref-dialog")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("external-ref-dialog")).toHaveCount(0);
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId("external-ref-add")).toBeFocused();
  guard.assertClean();
});
