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
  await activateControl(editSheet.getByTestId("edit-submit"), isMobile);
  await expect(editSheet).toBeHidden();

  const workspaceResponse = await request.get(`${apiBaseUrl}/api/workspace`);
  expect(workspaceResponse.ok()).toBeTruthy();
  const workspace = (await workspaceResponse.json()) as {
    reviews: Array<{ id: string; status: string; voucherId: string }>;
  };
  const approvedReview = workspace.reviews.find((review) => review.status === "approved");
  expect(approvedReview).toBeDefined();

  const journalResponse = await request.get(`${apiBaseUrl}/api/reports/journal`);
  expect(journalResponse.ok()).toBeTruthy();
  const journal = (await journalResponse.json()) as Array<{
    voucherId: string;
    lineId?: string;
    debit: number;
    credit: number;
  }>;
  const expenseLine = journal.find(
    (line) => line.voucherId === approvedReview!.voucherId && line.lineId && line.debit > line.credit,
  );
  expect(expenseLine?.lineId).toMatch(/^ln_/);

  const prePostTripsResponse = await request.get(`${apiBaseUrl}/api/lists/trips`);
  expect(prePostTripsResponse.ok()).toBeTruthy();
  const prePostTrips = (await prePostTripsResponse.json()) as Array<{
    id: string;
    purpose: string;
    traveler: string;
    expenseTotal: number;
  }>;
  const prePostTrip = prePostTrips.find((row) => row.purpose === "Customer visit");
  expect(prePostTrip).toMatchObject({
    traveler: "Ada",
    expenseTotal: expenseLine!.debit - expenseLine!.credit,
  });
  expect(prePostTrip?.id).toMatch(/^trip_/);

  const postPostTrip = {
    tripId: prePostTrip!.id,
    purpose: "Customer visit",
    traveler: "Ada",
    startDate: "2026-08-01",
    endDate: "2026-08-03",
  };

  const proposalResponse = await request.post(`${apiBaseUrl}/api/enrichment-work-items`, {
    data: {
      targetKind: "line",
      targetId: expenseLine!.lineId,
      proposedChange: {
        kind: "line_enrichment_record",
        lineId: expenseLine!.lineId,
        enrichmentType: "trip",
        payload: postPostTrip,
      },
      source: "advisor",
      idempotencyKey: `e2e:trip:${postPostTrip.tripId}`,
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
  expect(trips.find((row) => row.id === postPostTrip.tripId)?.expenseTotal).toBe(
    expenseLine!.debit - expenseLine!.credit,
  );
  expect(trips.filter((row) => row.id === postPostTrip.tripId)).toHaveLength(1);

  const panel = page.getByTestId("trips-list-panel");
  await expect(panel).toBeVisible();
  const row = panel.getByTestId("trips-list-row").filter({ hasText: "Customer visit" });
  await expect(row).toContainText("Ada");
  await expect(row).toContainText(postPostTrip.tripId);
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
