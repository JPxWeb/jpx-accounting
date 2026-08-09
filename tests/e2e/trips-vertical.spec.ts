import { expect, test } from "@playwright/test";

import { expectAccessible } from "./a11y-helpers";
import { installConsoleGuard } from "./console-guard";
import { activateControl, apiBaseUrl, resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => resetApiState(request));

test("trip workflow validates fields and Books shows confirmed posted-line expenses", async ({
  page,
  request,
  isMobile,
}) => {
  const guard = await installConsoleGuard(page);
  await page.goto("/today?view=queue");
  await activateControl(page.getByTestId("review-edit").first(), isMobile);

  const editSheet = page.getByTestId("review-edit-sheet");
  await editSheet.getByTestId("edit-workflow").selectOption("trip");
  await expect(editSheet.getByTestId("edit-submit")).toBeDisabled();
  await editSheet.getByTestId("trip-purpose").fill("Customer visit");
  await editSheet.getByTestId("trip-traveler").fill("Ada");
  await editSheet.getByTestId("trip-start-date").fill("2026-08-01");
  await editSheet.getByTestId("trip-end-date").fill("2026-08-03");
  await expect(editSheet.getByTestId("edit-submit")).toBeEnabled();
  await expectAccessible(page);
  await page.keyboard.press("Escape");

  const workspaceResponse = await request.get(`${apiBaseUrl}/api/workspace`);
  expect(workspaceResponse.ok()).toBeTruthy();
  const workspace = (await workspaceResponse.json()) as {
    reviews: Array<{ id: string; status: string; voucherId: string }>;
  };
  const pendingReview = workspace.reviews.find((review) => review.status === "needs-review");
  expect(pendingReview).toBeDefined();

  const approvalResponse = await request.post(`${apiBaseUrl}/api/reviews/${pendingReview!.id}/approve`, {
    data: {},
  });
  expect(approvalResponse.ok()).toBeTruthy();

  const journalResponse = await request.get(`${apiBaseUrl}/api/reports/journal`);
  expect(journalResponse.ok()).toBeTruthy();
  const journal = (await journalResponse.json()) as Array<{
    voucherId: string;
    lineId?: string;
    debit: number;
    credit: number;
  }>;
  const expenseLine = journal.find(
    (line) => line.voucherId === pendingReview!.voucherId && line.lineId && line.debit > line.credit,
  );
  expect(expenseLine?.lineId).toMatch(/^ln_/);

  const trip = {
    tripId: "trip_e2e_1",
    purpose: "Customer visit",
    traveler: "Ada",
    startDate: "2026-08-01",
    endDate: "2026-08-03",
  };
  const registrationResponse = await request.post(`${apiBaseUrl}/api/trips`, { data: trip });
  expect(registrationResponse.ok()).toBeTruthy();

  const proposalResponse = await request.post(`${apiBaseUrl}/api/enrichment-work-items`, {
    data: {
      targetKind: "line",
      targetId: expenseLine!.lineId,
      proposedChange: {
        kind: "line_enrichment_record",
        lineId: expenseLine!.lineId,
        enrichmentType: "trip",
        payload: trip,
      },
      source: "advisor",
      idempotencyKey: "e2e:trip:trip_e2e_1",
    },
  });
  const proposalBody = await proposalResponse.text();
  expect(proposalResponse.ok(), proposalBody).toBeTruthy();
  const workItem = JSON.parse(proposalBody) as { id: string };

  await page.goto(`/books?view=journal&workflow=trip&enrichmentWorkItem=${encodeURIComponent(workItem.id)}`);
  const confirmation = page.getByTestId("enrichment-confirm-shell");
  await expect(confirmation.getByTestId("enrichment-article-50-marker")).toBeVisible();
  await activateControl(confirmation.getByTestId("enrichment-confirm"), isMobile);
  await expect(confirmation.getByTestId("enrichment-status")).toHaveText(/Confirmed|Bekräftad/);
  await page.keyboard.press("Escape");

  const tripsResponse = await request.get(`${apiBaseUrl}/api/lists/trips`);
  expect(tripsResponse.ok()).toBeTruthy();
  const trips = (await tripsResponse.json()) as Array<{ id: string; expenseTotal: number }>;
  expect(trips.find((row) => row.id === trip.tripId)?.expenseTotal).toBe(expenseLine!.debit - expenseLine!.credit);

  const panel = page.getByTestId("trips-list-panel");
  await expect(panel).toBeVisible();
  const row = panel.getByTestId("trips-list-row").filter({ hasText: "Customer visit" });
  await expect(row).toContainText("Ada");
  await expect(row).toContainText("trip_e2e_1");
  await expectAccessible(page);
  guard.assertClean();
});

test("trip list has an honest empty state", async ({ page }) => {
  const guard = await installConsoleGuard(page);
  await page.goto("/books?view=journal&workflow=trip");
  await expect(page.getByTestId("trips-list-panel")).toBeVisible();
  await expect(page.getByTestId("trips-list-empty")).toHaveText("No trips registered yet.");
  guard.assertClean();
});
