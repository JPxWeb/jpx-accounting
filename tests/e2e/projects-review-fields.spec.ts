import { expect, test } from "@playwright/test";

import { installConsoleGuard } from "./console-guard";
import { activateControl, resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => resetApiState(request));

test("project workflow requires projectId before review submit", async ({ page, isMobile }) => {
  const guard = await installConsoleGuard(page);
  await page.goto("/today?view=queue");
  await activateControl(page.getByTestId("review-edit").first(), isMobile);

  await page.getByTestId("edit-workflow").selectOption("project");
  await expect(page.getByTestId("edit-submit")).toBeDisabled();
  await expect(page.getByTestId("project-required-error")).toHaveText("Choose a project.");

  await page.getByTestId("edit-project-id").fill("proj_1");
  await expect(page.getByTestId("edit-submit")).toBeEnabled();
  guard.assertClean();
});
