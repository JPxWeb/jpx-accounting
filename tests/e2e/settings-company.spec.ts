import { expect, type Page, test } from "@playwright/test";

import { activateControl, pickSelectOption, resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

// Selects and submits go through `pickSelectOption`/`activateControl`:
// pointer on desktop, trusted keyboard on mobile — see the helpers' doc
// comments for the Pixel 7 visual-viewport emulation quirk.

async function fillCompanyBasics(page: Page, overrides: { organizationNumber?: string } = {}) {
  await page.getByLabel("Organization name").fill("Jpx Konsult AB");
  await page.getByLabel("Organization number").fill(overrides.organizationNumber ?? "556677-8899");
  await page.getByLabel("Address").fill("Storgatan 1");
  await page.getByLabel("Postal code").fill("111 22");
  await page.getByLabel("City").fill("Stockholm");
  await page.getByLabel("Contact email").fill("kontakt@jpx.nu");
}

test("saves the workspace profile and persists it across reload", async ({ page, isMobile }) => {
  await page.goto("/settings/company");
  await expect(page.getByTestId("company-form")).toBeVisible();

  await fillCompanyBasics(page);
  await pickSelectOption(page, "company-profile-currency", "EUR", isMobile);
  await pickSelectOption(page, "company-profile-locale", "English", isMobile);

  await activateControl(page.getByTestId("company-form-submit"), isMobile);
  await expect(page.getByText("Company settings saved.")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("company-form")).toBeVisible();

  // The demo API server keeps MemoryLedgerStore state for the run, so the
  // saved profile must survive a reload.
  await expect(page.getByTestId("company-profile-currency")).toContainText("EUR");
  await expect(page.getByTestId("company-profile-locale")).toContainText("English");
  await expect(page.getByLabel("Organization name")).toHaveValue("Jpx Konsult AB");

  // Exit-gate proof: the currency/locale change reflects in rendered amounts.
  await page.goto("/today?view=queue");
  await expect(page.getByTestId("review-card").first()).toContainText(/EUR/);

  await page.goto("/books?view=trial-balance");
  await expect(page.getByTestId("trial-balance-row").first()).toContainText(/EUR/);
});

test("saves the VAT period and persists it across reload", async ({ page, isMobile }) => {
  await page.goto("/settings/company");
  await expect(page.getByTestId("company-form")).toBeVisible();

  // Quarterly is the Swedish SMB default from the contracts schema.
  await expect(page.getByTestId("company-vat-period")).toContainText("Quarterly");

  await fillCompanyBasics(page);
  await pickSelectOption(page, "company-profile-locale", "English", isMobile);
  await pickSelectOption(page, "company-vat-period", "Monthly", isMobile);

  await activateControl(page.getByTestId("company-form-submit"), isMobile);
  await expect(page.getByText("Company settings saved.")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("company-form")).toBeVisible();
  await expect(page.getByTestId("company-vat-period")).toContainText("Monthly");
});

test("saving a Swedish locale flips html lang and the shell copy", async ({ page, isMobile }) => {
  await page.goto("/settings/company");
  await expect(page.getByTestId("company-form")).toBeVisible();

  // Fresh contexts have no NEXT_LOCALE cookie, so the shell starts English.
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await fillCompanyBasics(page);
  await pickSelectOption(page, "company-profile-locale", "Svenska", isMobile);

  await activateControl(page.getByTestId("company-form-submit"), isMobile);
  await expect(page.getByText("Company settings saved.")).toBeVisible();

  // The save writes the NEXT_LOCALE cookie and refreshes the router, which
  // re-renders server components with the sv catalog + dynamic html lang.
  await expect(page.locator("html")).toHaveAttribute("lang", "sv");
  await expect(page.getByRole("link", { name: /Böcker/ }).first()).toBeVisible();
});

test("rejects an invalid Swedish organization number with the registry message", async ({ page, isMobile }) => {
  await page.goto("/settings/company");
  await expect(page.getByTestId("company-form")).toBeVisible();

  await fillCompanyBasics(page, { organizationNumber: "12345" });
  await activateControl(page.getByTestId("company-form-submit"), isMobile);

  await expect(page.getByText("Swedish org number format is XXXXXX-XXXX")).toBeVisible();
});
