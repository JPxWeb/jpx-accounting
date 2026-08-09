import { expect, test } from "@playwright/test";

import { installConsoleGuard } from "./console-guard";
import { apiBaseUrl, resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => resetApiState(request));

test("invoice view renders honest empty AR/AP and payment panels", async ({ page }) => {
  const guard = await installConsoleGuard(page);
  await page.goto("/books?view=journal&workflow=invoice");

  await expect(page.getByTestId("open-invoices-panel")).toBeVisible();
  await expect(page.getByTestId("open-invoices-empty")).toHaveText("No open invoices.");
  await expect(page.getByTestId("payment-history-panel")).toBeVisible();
  await expect(page.getByTestId("payment-history-empty")).toHaveText("No payments recorded.");
  guard.assertClean();
});

test("invoice view renders contract-validated invoice and payment identities", async ({ page, request }) => {
  const invoiceResponse = await request.post(`${apiBaseUrl}/api/invoices`, {
    data: {
      invoiceId: "inv_e2e_1",
      direction: "ap",
      counterparty: "Acme AB",
      dueDate: "2026-09-01",
      currency: "EUR",
      originalAmount: 125,
    },
  });
  expect(invoiceResponse.ok()).toBe(true);

  const paymentResponse = await request.post(`${apiBaseUrl}/api/payments/allocations`, {
    data: {
      paymentId: "pay_e2e_1",
      invoiceId: "inv_e2e_1",
      amount: 25,
      currency: "EUR",
      allocatedAt: "2026-08-15T10:00:00.000Z",
    },
  });
  expect(paymentResponse.ok()).toBe(true);

  await page.goto("/books?view=journal&workflow=invoice");
  const invoice = page.getByTestId("open-invoice-row").filter({ hasText: "inv_e2e_1" });
  await expect(invoice).toContainText("Acme AB");
  await expect(invoice).toContainText("EUR");
  await expect(invoice).toContainText("100");

  const payment = page.getByTestId("payment-history-row").filter({ hasText: "pay_e2e_1" });
  await expect(payment).toContainText("inv_e2e_1");
  await expect(payment).toContainText("EUR");
  await expect(payment).toContainText("25");
});
