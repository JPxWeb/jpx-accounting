import assert from "node:assert/strict";
import test from "node:test";

import type { EvidenceCreateInput } from "@jpx-accounting/contracts";
import {
  buildExtractedFields,
  deriveDeterministicExtraction,
  deriveVoucherFields,
  fnv1a,
  today,
} from "@jpx-accounting/domain";

const legacyInput: EvidenceCreateInput = {
  organizationId: "org_jpx",
  workspaceId: "workspace_main",
  title: "OpenAI subscription invoice",
  originalFilename: "openai-march-2026.pdf",
  mimeType: "application/pdf",
  modalities: ["pdf", "upload"],
  extractedText: "OpenAI March 2026 subscription invoice",
};

test("fnv1a matches the 32-bit FNV-1a reference vectors", () => {
  assert.equal(fnv1a(""), 0x811c9dc5);
  assert.equal(fnv1a("a"), 0xe40c292c);
});

test("deriveDeterministicExtraction is stable: same seed → identical fields across calls", () => {
  const seed = { filename: "receipt.jpg", sizeBytes: 48211 };
  const first = deriveDeterministicExtraction(seed, "2026-07-04");
  const second = deriveDeterministicExtraction(seed, "2026-07-04");
  assert.deepEqual(first, second);
});

test("deriveDeterministicExtraction varies with the file size", () => {
  const first = deriveDeterministicExtraction({ filename: "receipt.jpg", sizeBytes: 48211 }, "2026-07-04");
  const second = deriveDeterministicExtraction({ filename: "receipt.jpg", sizeBytes: 48212 }, "2026-07-04");
  const gross = (fields: typeof first) => fields.find((field) => field.key === "grossAmount")?.value;
  assert.notEqual(gross(first), gross(second));
});

test("deriveDeterministicExtraction emits every rule-gate key with consistent amounts", () => {
  const fields = deriveDeterministicExtraction({ filename: "invoice.pdf", sizeBytes: 123456 }, "2026-07-04");
  const byKey = new Map(fields.map((field) => [field.key, field.value]));
  for (const key of [
    "supplierName",
    "receiptDate",
    "transactionDate",
    "grossAmount",
    "netAmount",
    "vatAmount",
    "vatRate",
    "invoiceNumber",
    "supplierVatNumber",
  ]) {
    assert.ok(byKey.has(key), `missing field ${key}`);
    assert.ok((byKey.get(key) ?? "").length > 0, `empty field ${key}`);
  }
  const gross = Number.parseFloat(byKey.get("grossAmount")!);
  const net = Number.parseFloat(byKey.get("netAmount")!);
  const vat = Number.parseFloat(byKey.get("vatAmount")!);
  assert.ok(Math.abs(net + vat - gross) <= 0.01, `net ${net} + vat ${vat} should equal gross ${gross}`);
  assert.equal(byKey.get("receiptDate"), "2026-07-04");
  assert.equal(byKey.get("transactionDate"), "2026-07-04");
});

test("buildExtractedFields without sizeBytes reproduces the legacy canned array byte-identically", () => {
  const fields = buildExtractedFields(legacyInput);
  const dateIso = today();
  assert.deepEqual(fields, [
    { key: "supplierName", label: "Supplier", value: "OpenAI Ireland", confidence: 0.71, required: true },
    { key: "receiptDate", label: "Receipt date", value: dateIso, confidence: 0.98, required: true },
    { key: "transactionDate", label: "Transaction date", value: dateIso, confidence: 0.85, required: false },
    { key: "grossAmount", label: "Gross amount", value: "1249.00", confidence: 0.84, required: true },
    {
      key: "invoiceNumber",
      label: "Invoice number",
      value: "openai-march-2026-pdf",
      confidence: 0.61,
      required: false,
    },
    { key: "supplierVatNumber", label: "VAT number", value: "SE556677889901", confidence: 0.51, required: false },
  ]);
});

test("buildExtractedFields with sizeBytes switches to the deterministic derivation", () => {
  const input: EvidenceCreateInput = { ...legacyInput, sizeBytes: 48211 };
  const fields = buildExtractedFields(input);
  assert.deepEqual(
    fields,
    deriveDeterministicExtraction({ filename: legacyInput.originalFilename, sizeBytes: 48211 }, today()),
  );
});

test("deriveVoucherFields legacy path reproduces the historical 1249/999.2/249.8/25 exactly", () => {
  const fields = buildExtractedFields(legacyInput);
  const voucherFields = deriveVoucherFields(fields, legacyInput);
  assert.equal(voucherFields.grossAmount, 1249);
  assert.equal(voucherFields.netAmount, 999.2);
  assert.equal(voucherFields.vatAmount, 249.8);
  assert.equal(voucherFields.vatRate, 25);
  assert.equal(voucherFields.currency, "SEK");
  assert.equal(voucherFields.description, legacyInput.title);
  assert.equal(voucherFields.supplierName, "OpenAI Ireland");
  assert.equal(voucherFields.supplierVatNumber, "SE556677889901");
});

test("deriveVoucherFields parses deterministic amounts from the extraction", () => {
  const fields = deriveDeterministicExtraction({ filename: "receipt.jpg", sizeBytes: 48211 }, "2026-07-04");
  const voucherFields = deriveVoucherFields(fields, { title: "Uploaded receipt" });
  const byKey = new Map(fields.map((field) => [field.key, field.value]));
  assert.equal(voucherFields.grossAmount, Number.parseFloat(byKey.get("grossAmount")!));
  assert.equal(voucherFields.netAmount, Number.parseFloat(byKey.get("netAmount")!));
  assert.equal(voucherFields.vatAmount, Number.parseFloat(byKey.get("vatAmount")!));
  assert.equal(voucherFields.vatRate, Number.parseFloat(byKey.get("vatRate")!));
  assert.equal(voucherFields.description, "Uploaded receipt");
});
