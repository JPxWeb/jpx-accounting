import { expect, test } from "@playwright/test";

import { installConsoleGuard } from "./console-guard";
import { activateControl, apiBaseUrl, resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
  const response = await request.post(`${apiBaseUrl}/api/projects`, {
    data: { projectId: "proj_1", name: "Bridge retrofit" },
  });
  expect(response.ok()).toBe(true);

  const workspaceResponse = await request.get(`${apiBaseUrl}/api/workspace`);
  expect(workspaceResponse.ok()).toBe(true);
  const workspace = (await workspaceResponse.json()) as { reviews: Array<{ id: string }> };
  const review = workspace.reviews[0];
  expect(review).toBeDefined();

  const intentResponse = await request.post(`${apiBaseUrl}/api/reviews/${review!.id}/enrichment-intents`, {
    data: {
      reviewId: review!.id,
      proposals: [{ kind: "project_assignment", projectId: "proj_1" }],
    },
  });
  expect(intentResponse.ok()).toBe(true);
  const intent = (await intentResponse.json()) as { version: string };

  // Approval must name the intent it consumes; omitting the version is
  // fail-closed and would post the voucher without the project assignment.
  const approvalResponse = await request.post(`${apiBaseUrl}/api/reviews/${review!.id}/approve`, {
    data: { enrichmentIntent: { mode: "consume", version: intent.version } },
  });
  expect(approvalResponse.ok()).toBe(true);
});

test("books projects list and workflow filter", async ({ page, isMobile }) => {
  const guard = await installConsoleGuard(page);
  await page.goto("/books?view=journal&workflow=project");

  await expect(page.getByTestId("projects-list-panel")).toBeVisible();
  await expect(page.getByTestId("ledger-voucher-toggle")).toHaveCount(1);
  await activateControl(page.getByTestId("projects-list-row").first(), isMobile);
  await expect(page.getByTestId("ledger-voucher-detail")).toBeVisible();
  guard.assertClean();
});
