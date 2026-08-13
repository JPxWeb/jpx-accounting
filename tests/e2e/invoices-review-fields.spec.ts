import { expect, test } from "@playwright/test";

import { installConsoleGuard } from "./console-guard";
import { activateControl, apiBaseUrl, resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => resetApiState(request));

test("invoice workflow persists review fields through one atomic approval", async ({ page, request, isMobile }) => {
  const guard = await installConsoleGuard(page);
  await page.goto("/today?view=queue");
  await activateControl(page.getByTestId("review-edit").first(), isMobile);

  await page.getByTestId("edit-workflow").selectOption("invoice");
  await expect(page.getByTestId("edit-submit")).toBeDisabled();
  await expect(page.getByTestId("invoice-direction-error")).toHaveText("Choose receivable or payable.");
  await expect(page.getByTestId("invoice-counterparty-error")).toHaveText("Enter a counterparty.");
  await expect(page.getByTestId("invoice-due-date-error")).toHaveText("Enter a due date.");

  await page.getByTestId("invoice-direction").selectOption("ap");
  await page.getByTestId("invoice-counterparty").fill("Acme AB");
  await page.getByTestId("invoice-due-date").fill("2026-09-01");
  await expect(page.getByTestId("edit-submit")).toBeEnabled();
  await activateControl(page.getByTestId("edit-submit"), isMobile);
  await expect(page.getByTestId("edit-submit")).toBeHidden();

  const response = await request.get(`${apiBaseUrl}/api/lists/open-invoices`);
  expect(response.ok()).toBe(true);
  const invoices = (await response.json()) as Array<Record<string, unknown>>;
  expect(invoices).toHaveLength(1);
  expect(invoices[0]).toMatchObject({
    direction: "ap",
    counterparty: "Acme AB",
    dueDate: "2026-09-01",
    currency: "SEK",
  });
  expect(invoices[0]?.id).toMatch(/^inv_/);
  expect(Number(invoices[0]?.originalAmount)).toBe(1249);

  await page.goto("/books?view=journal&workflow=invoice");
  await expect(page.getByTestId("open-invoice-row").filter({ hasText: "Acme AB" })).toHaveCount(1);
  guard.assertClean();
});

test("submitting workflow none clears a stale invoice intent before approval", async ({ page, request, isMobile }) => {
  const workspaceResponse = await request.get(`${apiBaseUrl}/api/workspace`);
  expect(workspaceResponse.ok()).toBe(true);
  const workspace = (await workspaceResponse.json()) as { reviews: Array<{ id: string; status: string }> };
  const review = workspace.reviews.find((candidate) => candidate.status === "needs-review");
  expect(review).toBeTruthy();

  const intentResponse = await request.post(`${apiBaseUrl}/api/reviews/${review?.id}/enrichment-intents`, {
    data: {
      reviewId: review?.id,
      proposals: [
        {
          kind: "invoice_registration",
          direction: "ap",
          counterparty: "Stale supplier",
          dueDate: "2026-09-01",
        },
      ],
    },
  });
  expect(intentResponse.ok()).toBe(true);

  await page.goto("/today?view=queue");
  await activateControl(page.getByTestId("review-edit").first(), isMobile);
  await expect(page.getByTestId("edit-workflow")).toHaveValue("none");
  await activateControl(page.getByTestId("edit-submit"), isMobile);
  await expect(page.getByTestId("edit-submit")).toBeHidden();

  const invoicesResponse = await request.get(`${apiBaseUrl}/api/lists/open-invoices`);
  expect(invoicesResponse.ok()).toBe(true);
  expect(await invoicesResponse.json()).toEqual([]);
});

test("plain queue approval clears an unseen invoice intent", async ({ page, request, isMobile }) => {
  const workspace = (await (await request.get(`${apiBaseUrl}/api/workspace`)).json()) as {
    reviews: Array<{ id: string; status: string }>;
  };
  const review = workspace.reviews.find((candidate) => candidate.status === "needs-review");
  expect(review).toBeTruthy();
  expect(
    (
      await request.post(`${apiBaseUrl}/api/reviews/${review?.id}/enrichment-intents`, {
        data: {
          reviewId: review?.id,
          proposals: [
            {
              kind: "invoice_registration",
              direction: "ap",
              counterparty: "Unseen supplier",
              dueDate: "2026-09-01",
            },
          ],
        },
      })
    ).ok(),
  ).toBe(true);

  await page.goto("/today?view=queue");
  await activateControl(page.getByTestId("review-accept").first(), isMobile);
  await expect
    .poll(async () => {
      const current = (await (await request.get(`${apiBaseUrl}/api/workspace`)).json()) as {
        reviews: Array<{ id: string; status: string }>;
      };
      return current.reviews.find((candidate) => candidate.id === review?.id)?.status;
    })
    .toBe("approved");

  const invoicesResponse = await request.get(`${apiBaseUrl}/api/lists/open-invoices`);
  expect(invoicesResponse.ok()).toBe(true);
  expect(await invoicesResponse.json()).toEqual([]);
});

test("closing the review sheet clears an unapproved invoice intent", async ({ page, request, isMobile }) => {
  const workspace = (await (await request.get(`${apiBaseUrl}/api/workspace`)).json()) as {
    reviews: Array<{ id: string; status: string }>;
  };
  const review = workspace.reviews.find((candidate) => candidate.status === "needs-review");
  expect(review).toBeTruthy();
  await request.post(`${apiBaseUrl}/api/reviews/${review?.id}/enrichment-intents`, {
    data: {
      reviewId: review?.id,
      proposals: [
        {
          kind: "invoice_registration",
          direction: "ap",
          counterparty: "Cancelled supplier",
          dueDate: "2026-09-01",
        },
      ],
    },
  });

  await page.goto("/today?view=queue");
  await activateControl(page.getByTestId("review-edit").first(), isMobile);
  await activateControl(page.getByTestId("review-edit-close"), isMobile);
  await expect(page.getByTestId("review-edit-sheet")).toBeHidden();

  const intentResponse = await request.get(`${apiBaseUrl}/api/reviews/${review?.id}/enrichment-intents`);
  expect(intentResponse.ok()).toBe(true);
  const intent = (await intentResponse.json()) as { proposals: Array<{ kind: string }> };
  expect(intent.proposals).toEqual([{ kind: "noop" }]);
});
