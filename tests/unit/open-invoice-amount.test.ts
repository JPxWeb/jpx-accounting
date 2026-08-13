import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveOpenInvoiceAmount } from "@jpx-accounting/domain";

test("partial payment reduces the matching invoice open amount", () => {
  const open = deriveOpenInvoiceAmount(
    [
      { invoiceId: "inv_1", signedAmount: 100 },
      { invoiceId: "inv_2", signedAmount: 300 },
    ],
    [
      { invoiceId: "inv_1", amount: 40 },
      { invoiceId: "inv_2", amount: 200 },
    ],
    "inv_1",
  );

  assert.equal(open, 60);
});

test("open invoice amount is rounded to two decimals", () => {
  assert.equal(
    deriveOpenInvoiceAmount(
      [{ invoiceId: "inv_1", signedAmount: 100.1 }],
      [{ invoiceId: "inv_1", amount: 40.2 }],
      "inv_1",
    ),
    59.9,
  );
});
