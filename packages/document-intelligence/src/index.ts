import DocumentIntelligence, { getLongRunningPoller, isUnexpected } from "@azure-rest/ai-document-intelligence";
import { AzureKeyCredential } from "@azure/core-auth";

import type { ExtractedField } from "@jpx-accounting/contracts";
import { deriveDeterministicExtraction, today } from "@jpx-accounting/domain";

// Document Intelligence adapter. Per Azure docs as of 2024-11-30 GA:
// - Package is `@azure-rest/ai-document-intelligence` (REST client). The older `@azure/ai-form-recognizer`
//   is deprecated; the package literally named `@azure/ai-document-intelligence` is not published.
// - Swedish *fakturor* are covered by `prebuilt-invoice`. `prebuilt-receipt` is for till receipts only.
// - All requests run through `getLongRunningPoller(initial).pollUntilDone()` even on small docs so the
//   contract stays the same as throughput grows.

export type DocumentIntelligenceModel = "prebuilt-invoice" | "prebuilt-receipt";

export interface DocumentExtractionResult {
  modelId: DocumentIntelligenceModel;
  fields: ExtractedField[];
  /** Raw Document Intelligence "documents[0].fields" object — kept for audit and downstream rules. */
  rawFields: Record<string, unknown>;
}

export interface DocumentIntelligenceClient {
  /** Run extraction over a remote URL or raw bytes. Throws if the service returns a non-2xx. */
  extract(input: ExtractInput): Promise<DocumentExtractionResult>;
}

export type ExtractInput = {
  modelId: DocumentIntelligenceModel;
  /**
   * Optional file provenance. The stub client seeds its deterministic
   * extraction from these so create-time fields and refreshed fields agree
   * (idempotent refresh); the Azure client ignores them.
   */
  hints?: { filename: string; sizeBytes?: number | undefined };
} & ({ urlSource: string } | { base64Source: string });

export class DocumentIntelligenceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentIntelligenceUnavailableError";
  }
}

/** Heuristic: prefer `prebuilt-invoice` unless filename or hint suggests a till receipt. */
export function pickModelForDocument(input: { filename?: string; mimeType?: string }): DocumentIntelligenceModel {
  const haystack = `${input.filename ?? ""} ${input.mimeType ?? ""}`.toLowerCase();
  // Common till-receipt signals — Swedish + English. Anything else (PDFs, supplier invoices) → invoice.
  if (/(receipt|kvitto|kassakvitto|cashregister|till)/.test(haystack)) {
    return "prebuilt-receipt";
  }
  return "prebuilt-invoice";
}

class StubDocumentIntelligenceClient implements DocumentIntelligenceClient {
  // Returned in demo mode and when DocIntel env vars are unset. Derives the same
  // deterministic file-seeded fields as `createEvidence` (shared derivation in
  // @jpx-accounting/domain), so an extraction refresh over freshly-created
  // evidence is a stable no-op on values.
  async extract(input: ExtractInput): Promise<DocumentExtractionResult> {
    const fields = deriveDeterministicExtraction(
      { filename: input.hints?.filename ?? "unknown", sizeBytes: input.hints?.sizeBytes ?? 0 },
      today(),
    );
    return {
      modelId: input.modelId,
      fields,
      rawFields: { _stub: true },
    };
  }
}

export type AzureDocumentIntelligenceConfig = {
  endpoint: string;
  apiKey: string;
};

class AzureDocumentIntelligenceClient implements DocumentIntelligenceClient {
  private readonly client: ReturnType<typeof DocumentIntelligence>;

  constructor(config: AzureDocumentIntelligenceConfig) {
    this.client = DocumentIntelligence(config.endpoint, new AzureKeyCredential(config.apiKey));
  }

  async extract(input: ExtractInput): Promise<DocumentExtractionResult> {
    const body = "urlSource" in input ? { urlSource: input.urlSource } : { base64Source: input.base64Source };
    const initial = await this.client
      .path("/documentModels/{modelId}:analyze", input.modelId)
      .post({ contentType: "application/json", body });

    if (isUnexpected(initial)) {
      throw new DocumentIntelligenceUnavailableError(
        `Document Intelligence rejected analyze request: ${initial.status} ${JSON.stringify(initial.body)}`,
      );
    }

    const poller = getLongRunningPoller(this.client, initial);
    const result = (await poller.pollUntilDone()).body as {
      analyzeResult?: {
        documents?: Array<{ fields?: Record<string, unknown> }>;
      };
    };

    const rawFields = result.analyzeResult?.documents?.[0]?.fields ?? {};
    return {
      modelId: input.modelId,
      fields: mapFieldsToContract(rawFields, input.modelId),
      rawFields,
    };
  }
}

// Map a small subset of Document Intelligence's field schema into the lean ExtractedField[]
// shape the domain uses. Both `prebuilt-invoice` and `prebuilt-receipt` carry the keys used
// here, just with different confidences. Unmapped fields stay in `rawFields` for the audit trail.
// Exported for unit tests (tests/unit/document-intelligence.test.ts): the only other route to
// this pure mapping runs through the live Azure REST client.
export function mapFieldsToContract(
  rawFields: Record<string, unknown>,
  modelId: DocumentIntelligenceModel,
): ExtractedField[] {
  const get = (...keys: string[]): { value: unknown; confidence: number | undefined } => {
    for (const key of keys) {
      const candidate = rawFields[key] as { content?: unknown; valueString?: unknown; confidence?: number } | undefined;
      if (candidate) {
        return { value: candidate.content ?? candidate.valueString, confidence: candidate.confidence };
      }
    }
    return { value: undefined, confidence: undefined };
  };

  const supplier = get("VendorName", "MerchantName");
  const total = get("InvoiceTotal", "Total");
  const date = get("InvoiceDate", "TransactionDate");
  const number = get("InvoiceId");
  const vatNumber = get("VendorTaxId", "MerchantTaxId");

  const fields: ExtractedField[] = [];
  if (supplier.value !== undefined) {
    fields.push({
      key: "supplierName",
      label: "Supplier",
      value: String(supplier.value),
      confidence: supplier.confidence ?? 0.5,
      required: true,
    });
  }
  if (total.value !== undefined) {
    fields.push({
      key: "grossAmount",
      label: "Gross amount",
      value: String(total.value),
      confidence: total.confidence ?? 0.5,
      required: true,
    });
  }
  if (date.value !== undefined) {
    fields.push({
      key: modelId === "prebuilt-invoice" ? "transactionDate" : "receiptDate",
      label: modelId === "prebuilt-invoice" ? "Transaction date" : "Receipt date",
      value: String(date.value),
      confidence: date.confidence ?? 0.5,
      required: true,
    });
  }
  if (number.value !== undefined) {
    fields.push({
      key: "invoiceNumber",
      label: "Invoice number",
      value: String(number.value),
      confidence: number.confidence ?? 0.5,
      required: false,
    });
  }
  if (vatNumber.value !== undefined) {
    fields.push({
      key: "supplierVatNumber",
      label: "VAT number",
      value: String(vatNumber.value),
      confidence: vatNumber.confidence ?? 0.5,
      required: false,
    });
  }
  return fields;
}

export type DocumentIntelligenceConfig = {
  endpoint?: string | undefined;
  apiKey?: string | undefined;
};

export function createDocumentIntelligenceClient(config: DocumentIntelligenceConfig): DocumentIntelligenceClient {
  if (config.endpoint && config.apiKey) {
    return new AzureDocumentIntelligenceClient({ endpoint: config.endpoint, apiKey: config.apiKey });
  }
  return new StubDocumentIntelligenceClient();
}
