import assert from "node:assert/strict";
import { test } from "node:test";

import { extractedFieldSchema } from "@jpx-accounting/contracts";
import {
  createDocumentIntelligenceClient,
  mapFieldsToContract,
  pickModelForDocument,
} from "@jpx-accounting/document-intelligence";
import { deriveDeterministicExtraction, today } from "@jpx-accounting/domain";

// ---------------------------------------------------------------------------
// pickModelForDocument — the fakturor/kvitto routing heuristic (CLAUDE.md:
// Swedish fakturor → prebuilt-invoice, till receipts → prebuilt-receipt).
// ---------------------------------------------------------------------------

test("pickModelForDocument routes invoices to prebuilt-invoice and till receipts to prebuilt-receipt", () => {
  const cases: Array<{ input: { filename?: string; mimeType?: string }; expected: string }> = [
    // Swedish fakturor and generic documents default to the invoice model.
    { input: { filename: "faktura_2026-001.pdf", mimeType: "application/pdf" }, expected: "prebuilt-invoice" },
    { input: { filename: "leverantorsfaktura-42.pdf" }, expected: "prebuilt-invoice" },
    { input: { filename: "IMG_1234.jpg", mimeType: "image/jpeg" }, expected: "prebuilt-invoice" },
    { input: {}, expected: "prebuilt-invoice" },
    // Till-receipt signals — Swedish + English, filename or mime hint, case-insensitive.
    { input: { filename: "kvitto-ica.jpg" }, expected: "prebuilt-receipt" },
    { input: { filename: "Kassakvitto 2026-07-01.png" }, expected: "prebuilt-receipt" },
    { input: { filename: "RECEIPT-taxi.PDF" }, expected: "prebuilt-receipt" },
    { input: { filename: "cashregister-slip.png" }, expected: "prebuilt-receipt" },
    { input: { mimeType: "image/kvitto" }, expected: "prebuilt-receipt" },
  ];

  for (const { input, expected } of cases) {
    assert.equal(pickModelForDocument(input), expected, `pickModelForDocument(${JSON.stringify(input)})`);
  }
});

// ---------------------------------------------------------------------------
// mapFieldsToContract — pure mapping from raw Document Intelligence fields to
// the lean ExtractedField[] contract shape.
// ---------------------------------------------------------------------------

test("mapFieldsToContract maps prebuilt-invoice fields onto contract keys", () => {
  const fields = mapFieldsToContract(
    {
      VendorName: { content: "Kontorsgiganten AB", confidence: 0.97 },
      InvoiceTotal: { content: "1 250,00 kr", confidence: 0.92 },
      InvoiceDate: { valueString: "2026-06-30" }, // valueString fallback + missing confidence
      InvoiceId: { content: "INV-12345", confidence: 0.81 },
      VendorTaxId: { content: "SE556677889901", confidence: 0.66 },
      SubTotal: { content: "1 000,00 kr", confidence: 0.9 }, // unmapped → stays in rawFields only
    },
    "prebuilt-invoice",
  );

  // Every mapped field satisfies the shared contract.
  for (const field of fields) {
    extractedFieldSchema.parse(field);
  }

  assert.deepEqual(
    fields.map((field) => field.key),
    ["supplierName", "grossAmount", "transactionDate", "invoiceNumber", "supplierVatNumber"],
  );

  const byKey = new Map(fields.map((field) => [field.key, field]));
  assert.deepEqual(byKey.get("supplierName"), {
    key: "supplierName",
    label: "Supplier",
    value: "Kontorsgiganten AB",
    confidence: 0.97,
    required: true,
  });
  assert.equal(byKey.get("grossAmount")?.value, "1 250,00 kr");
  assert.equal(byKey.get("grossAmount")?.required, true);
  // The invoice model books on transactionDate (not receiptDate).
  assert.equal(byKey.get("transactionDate")?.label, "Transaction date");
  assert.equal(byKey.get("transactionDate")?.value, "2026-06-30");
  // Missing confidence falls back to the 0.5 mid-band, never undefined.
  assert.equal(byKey.get("transactionDate")?.confidence, 0.5);
  assert.equal(byKey.get("invoiceNumber")?.required, false);
  assert.equal(byKey.get("supplierVatNumber")?.required, false);
});

test("mapFieldsToContract maps prebuilt-receipt fields with the receiptDate key", () => {
  const fields = mapFieldsToContract(
    {
      MerchantName: { content: "Kaffekompaniet Stockholm AB", confidence: 0.9 },
      Total: { content: "89.00", confidence: 0.95 },
      TransactionDate: { content: "2026-07-01", confidence: 0.88 },
      MerchantTaxId: { content: "SE000000000101", confidence: 0.7 },
    },
    "prebuilt-receipt",
  );

  const byKey = new Map(fields.map((field) => [field.key, field]));
  assert.equal(byKey.get("supplierName")?.value, "Kaffekompaniet Stockholm AB");
  assert.equal(byKey.get("receiptDate")?.label, "Receipt date");
  assert.equal(byKey.get("receiptDate")?.value, "2026-07-01");
  assert.equal(byKey.has("transactionDate"), false);
  // Receipts carry no InvoiceId — the field is simply absent, not defaulted.
  assert.equal(byKey.has("invoiceNumber"), false);
});

test("mapFieldsToContract prefers the invoice alias and content over valueString", () => {
  const fields = mapFieldsToContract(
    {
      // Alias precedence: VendorName (first key) wins over MerchantName.
      VendorName: { content: "Vendor AB", confidence: 0.9 },
      MerchantName: { content: "Merchant AB", confidence: 0.99 },
      // content wins over valueString when both are present.
      InvoiceTotal: { content: "500,00", valueString: "999,99", confidence: 0.8 },
    },
    "prebuilt-invoice",
  );

  const byKey = new Map(fields.map((field) => [field.key, field]));
  assert.equal(byKey.get("supplierName")?.value, "Vendor AB");
  assert.equal(byKey.get("supplierName")?.confidence, 0.9);
  assert.equal(byKey.get("grossAmount")?.value, "500,00");
});

test("mapFieldsToContract returns [] for an empty analysis", () => {
  assert.deepEqual(mapFieldsToContract({}, "prebuilt-invoice"), []);
});

// ---------------------------------------------------------------------------
// createDocumentIntelligenceClient — factory selection + stub determinism.
// ---------------------------------------------------------------------------

test("factory returns the stub client unless BOTH endpoint and apiKey are configured", () => {
  assert.notEqual(createDocumentIntelligenceClient({}).constructor.name, "AzureDocumentIntelligenceClient");
  assert.notEqual(
    createDocumentIntelligenceClient({ endpoint: "https://di.example.test" }).constructor.name,
    "AzureDocumentIntelligenceClient",
  );
  assert.notEqual(
    createDocumentIntelligenceClient({ apiKey: "secret" }).constructor.name,
    "AzureDocumentIntelligenceClient",
  );
  assert.equal(
    createDocumentIntelligenceClient({ endpoint: "https://di.example.test", apiKey: "secret" }).constructor.name,
    "AzureDocumentIntelligenceClient",
  );
});

test("stub extraction is deterministic per file seed and matches the shared domain derivation", async () => {
  const client = createDocumentIntelligenceClient({});
  const result = await client.extract({
    modelId: "prebuilt-receipt",
    hints: { filename: "kvitto-ica.jpg", sizeBytes: 4321 },
    urlSource: "https://example.test/kvitto-ica.jpg",
  });

  // Echoes the requested model and flags itself as the stub in rawFields.
  assert.equal(result.modelId, "prebuilt-receipt");
  assert.deepEqual(result.rawFields, { _stub: true });

  // Same derivation as createEvidence (idempotent refresh over fresh evidence).
  assert.deepEqual(
    result.fields,
    deriveDeterministicExtraction({ filename: "kvitto-ica.jpg", sizeBytes: 4321 }, today()),
  );

  const again = await client.extract({
    modelId: "prebuilt-receipt",
    hints: { filename: "kvitto-ica.jpg", sizeBytes: 4321 },
    base64Source: "aGVq",
  });
  assert.deepEqual(again.fields, result.fields, "same seed must extract identically regardless of source kind");
});

test("stub extraction without hints falls back to the unknown/0 seed", async () => {
  const client = createDocumentIntelligenceClient({});
  const result = await client.extract({ modelId: "prebuilt-invoice", urlSource: "https://example.test/doc.pdf" });
  assert.deepEqual(result.fields, deriveDeterministicExtraction({ filename: "unknown", sizeBytes: 0 }, today()));
});
