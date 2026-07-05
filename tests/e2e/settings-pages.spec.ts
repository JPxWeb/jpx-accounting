import { expect, type Page, test } from "@playwright/test";

import { expectAccessible } from "./a11y-helpers";
import { apiBaseUrl, resetApiState } from "./test-helpers";

/**
 * Settings depth (Phase 6 Task 6.2): the five formerly header-only sub-pages
 * render REAL content on the existing API surface — fiscal-year is a
 * persisted form, compliance reads `GET /api/integrity`, integrations reads
 * `GET /api/runtime-info`, retention/team are honest policy/state pages.
 * Every page passes the axe WCAG 2.2 AA check.
 */

// The fiscal-year form persists through the company-settings record, so seed
// a valid one through the ordinary settings endpoint (same as ai-posture).
const baselineCompanySettings = {
  organizationId: "org_jpx",
  organizationName: "Jpx Konsult AB",
  organizationNumber: "556677-8899",
  addressLine1: "Storgatan 1",
  postalCode: "111 22",
  city: "Stockholm",
  contactEmail: "kontakt@jpx.nu",
};

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
  const saved = await request.put(`${apiBaseUrl}/api/settings/company`, { data: baselineCompanySettings });
  expect(saved.ok()).toBeTruthy();
});

async function pickSelectOption(page: Page, testId: string, optionLabel: string) {
  await page.getByTestId(testId).click();
  await page.getByRole("option", { name: optionLabel }).click();
}

test("fiscal-year: real form previews the fiscal window and next årsredovisning", async ({ page }) => {
  await page.goto("/settings/fiscal-year");
  await expect(page.getByTestId("company-fiscal-year-form")).toBeVisible();

  // Contract default is 01-01 — the select shows January (en catalog).
  await expect(page.getByTestId("fiscal-year-start-select")).toContainText("January");

  // Derived values are real: a dated fiscal window and a dated statutory
  // deadline from the domain tax calendar, plus the verbatim ÅRL source.
  await expect(page.getByTestId("fiscal-year-window")).toContainText(/\d{4}.*–.*\d{4}/);
  await expect(page.getByTestId("fiscal-year-arsredovisning")).toContainText(/\d{4}/);
  await expect(page.getByTestId("company-fiscal-year-form")).toContainText("Årsredovisningslagen");

  // The VAT cadence is displayed here but edited on the company form.
  await expect(page.getByTestId("fiscal-year-vat-period")).toContainText("Quarterly");
  await expect(page.getByRole("link", { name: "Open company settings" })).toHaveAttribute("href", "/settings/company");

  await expectAccessible(page);
});

test("fiscal-year: start month persists through the company-settings path", async ({ page }) => {
  await page.goto("/settings/fiscal-year");
  await expect(page.getByTestId("company-fiscal-year-form")).toBeVisible();

  await pickSelectOption(page, "fiscal-year-start-select", "July");
  await page.getByTestId("fiscal-year-save").click();
  await expect(page.getByText("Fiscal year saved.")).toBeVisible();

  // The demo API keeps MemoryLedgerStore state for the run, so the saved
  // start month must survive a reload — and the company form sees it too.
  await page.reload();
  await expect(page.getByTestId("fiscal-year-start-select")).toContainText("July");

  await page.goto("/settings/company");
  await expect(page.getByTestId("company-profile-fiscal-year-start")).toContainText("July");
});

test("compliance: integrity panel renders the chain verdict, recent events, and the retention source", async ({
  page,
}) => {
  await page.goto("/settings/compliance");

  const panel = page.getByTestId("compliance-integrity-panel");
  await expect(panel).toBeVisible();

  // The shared chip: hash-chain verdict + BAS template + event count.
  await expect(panel.getByTestId("integrity-chip")).toContainText("hash chain intact");
  await expect(panel.getByTestId("integrity-chip")).toContainText("BAS");

  // The recent-event tail is real ledger data with actor attribution
  // (seeded evidence events carry the founder actor).
  await expect(panel.getByTestId("integrity-recent-event").first()).toBeVisible();
  await expect(panel.getByTestId("integrity-recent-event").filter({ hasText: "user_founder" }).first()).toBeVisible();

  // Bokföringslagen retention statement with the verbatim source line.
  await expect(page.getByTestId("compliance-retention-statement")).toContainText(
    "Bokföringslagen (1999:1078) 7 kap. 2 §",
  );

  await expectAccessible(page);
});

test("retention: honest policy page states the statute and where records live", async ({ page }) => {
  await page.goto("/settings/retention");

  await expect(page.getByTestId("retention-policy")).toBeVisible();
  await expect(page.getByTestId("retention-statute")).toContainText("Bokföringslagen (1999:1078) 7 kap. 2 §");
  await expect(page.getByTestId("retention-storage")).toContainText("Supabase Postgres");

  // Honest roadmap, no fake toggles: the page has no switches at all.
  await expect(page.getByTestId("retention-roadmap")).toBeVisible();
  await expect(page.getByTestId("retention-policy").getByRole("switch")).toHaveCount(0);

  await expectAccessible(page);
});

test("team: honest single-user state with live actor attribution", async ({ page }) => {
  await page.goto("/settings/team");

  await expect(page.getByTestId("team-overview")).toBeVisible();
  await expect(page.getByTestId("team-current-actor")).toContainText("user_founder");

  // Attribution rows come from the integrity summary's recent-event tail.
  await expect(page.getByTestId("team-actor-row").first()).toBeVisible();
  await expect(page.getByTestId("team-actor-row").filter({ hasText: "user_founder" }).first()).toBeVisible();

  // The accountant seat is a labeled plan — and there is no invite form.
  await expect(page.getByTestId("team-accountant-seat")).toContainText("Planned");
  await expect(page.getByTestId("team-invite-note")).toContainText("not built");
  await expect(page.getByTestId("team-overview").locator("form")).toHaveCount(0);

  await expectAccessible(page);
});

test("integrations: real posture — SIE links, AI runtime info, honest stub and roadmap cards", async ({ page }) => {
  await page.goto("/settings/integrations");

  await expect(page.getByTestId("integrations-posture")).toBeVisible();

  // Web + API runtime modes reported from real signals (demo test servers).
  await expect(page.getByTestId("integrations-mode-line")).toContainText("API: Demo");

  // SIE exists today: links point at the real surfaces.
  const sie = page.getByTestId("integration-sie");
  await expect(sie).toContainText("Available");
  await expect(sie.getByRole("link", { name: "Import on Capture" })).toHaveAttribute("href", "/capture");
  await expect(sie.getByRole("link", { name: "Export on Reports" })).toHaveAttribute("href", "/reports");

  // AI card reads GET /api/runtime-info — demo is honestly labeled local.
  const ai = page.getByTestId("integration-ai");
  await expect(ai).toContainText("Operational");
  await expect(ai).toContainText("Local demo runtime");

  // Blob + OCR are explicit demo stubs, not fake green checkmarks.
  await expect(page.getByTestId("integration-blob")).toContainText("Demo stub");
  await expect(page.getByTestId("integration-ocr")).toContainText("Demo stub");

  // Peppol readiness: advisory card with an honest "transport not built".
  const peppol = page.getByTestId("peppol-readiness");
  await expect(peppol).toContainText("Peppol");
  await expect(peppol).toContainText("Transport is not implemented");

  await expect(page.getByTestId("integration-email-intake")).toContainText("Not built yet");

  await expectAccessible(page);
});
