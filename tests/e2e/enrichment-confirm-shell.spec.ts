import { expect, test, type APIRequestContext } from "@playwright/test";

import { expectAccessible } from "./a11y-helpers";
import { installConsoleGuard } from "./console-guard";
import { activateControl, apiBaseUrl, resetApiState } from "./test-helpers";

type WorkItem = {
  id: string;
  status: "pending_confirmation" | "confirmed" | "rejected" | "superseded";
};

async function createPendingWorkItem(request: APIRequestContext, source: "advisor" | "mcp" = "advisor") {
  const description = `Enrichment shell ${source}`;
  const importResponse = await request.post(`${apiBaseUrl}/api/imports/sie`, {
    headers: { "content-type": "text/plain" },
    data: [
      "#FLAGGA 0",
      "#SIETYP 4",
      '#KONTO 6110 "Kontorsmateriel"',
      `#VER E ${source === "advisor" ? "828" : "829"} 20260809 "${description}"`,
      "{",
      "#TRANS 6110 {} 100.00",
      "#TRANS 1930 {} -100.00",
      "}",
    ].join("\n"),
  });
  expect(importResponse.ok()).toBeTruthy();

  const journalResponse = await request.get(`${apiBaseUrl}/api/reports/journal`);
  expect(journalResponse.ok()).toBeTruthy();
  const journal = (await journalResponse.json()) as Array<{ voucherId: string; description: string }>;
  const importedLine = journal.find((line) => line.description === description);
  expect(importedLine).toBeDefined();

  const proposalResponse = await request.post(`${apiBaseUrl}/api/enrichment-work-items`, {
    data: {
      targetKind: "voucher",
      targetId: importedLine!.voucherId,
      proposedChange: { kind: "noop" },
      source,
      idempotencyKey: `e2e:${source}:${Date.now()}`,
    },
  });
  const proposalBody = await proposalResponse.text();
  expect(proposalResponse.ok(), proposalBody).toBeTruthy();
  return JSON.parse(proposalBody) as WorkItem;
}

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

test("deep-linked enrichment requires explicit human confirmation", async ({ page, request, isMobile }) => {
  const guard = await installConsoleGuard(page);
  const workItem = await createPendingWorkItem(request);

  await page.goto(`/books?view=journal&enrichmentWorkItem=${encodeURIComponent(workItem.id)}`);

  const shell = page.getByTestId("enrichment-confirm-shell");
  await expect(shell).toBeVisible();
  await expect(shell.getByTestId("enrichment-article-50-marker")).toBeVisible();
  await expect(shell.getByTestId("enrichment-status")).toHaveText(/Pending|Väntar/);
  await expect(shell.getByTestId("enrichment-confirm-close")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(shell.getByTestId("enrichment-confirm")).toBeFocused();
  await expectAccessible(page);

  const beforeConfirmation = (await (
    await request.get(`${apiBaseUrl}/api/enrichment-work-items/${encodeURIComponent(workItem.id)}`)
  ).json()) as WorkItem;
  expect(beforeConfirmation.status).toBe("pending_confirmation");

  await activateControl(shell.getByTestId("enrichment-confirm"), isMobile);
  await expect(shell.getByTestId("enrichment-status")).toHaveText(/Confirmed|Bekräftad/);

  const afterConfirmation = (await (
    await request.get(`${apiBaseUrl}/api/enrichment-work-items/${encodeURIComponent(workItem.id)}`)
  ).json()) as WorkItem;
  expect(afterConfirmation.status).toBe("confirmed");
  guard.assertClean();
});

test("deep-linked enrichment can be rejected and Escape closes the controlled overlay", async ({
  page,
  request,
  isMobile,
}) => {
  const guard = await installConsoleGuard(page);
  const workItem = await createPendingWorkItem(request, "mcp");

  await page.goto(`/books?view=journal&enrichmentWorkItem=${encodeURIComponent(workItem.id)}`);
  const shell = page.getByTestId("enrichment-confirm-shell");
  await expect(shell).toBeVisible();
  await expect(shell.getByTestId("enrichment-article-50-marker")).toBeVisible();

  await activateControl(shell.getByTestId("enrichment-reject"), isMobile);
  await expect(shell.getByTestId("enrichment-status")).toHaveText(/Rejected|Avvisad/);

  await page.keyboard.press("Escape");
  await expect(shell).toHaveCount(0);
  await expect(page).not.toHaveURL(/enrichmentWorkItem=/);
  guard.assertClean();
});
