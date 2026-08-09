import { expect, test } from "@playwright/test";

import { installConsoleGuard } from "./console-guard";
import { activateControl, resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => resetApiState(request));

test("invoice workflow requires direction, counterparty, and due date", async ({ page, isMobile }) => {
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
  guard.assertClean();
});
