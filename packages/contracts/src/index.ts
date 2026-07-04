import { z } from "zod";

import { countryCodeSchema, countryValidationRegistry } from "./countries";

export * from "./countries";

export const roleSchema = z.enum(["Preparer", "Approver", "Accountant", "Admin", "Auditor", "Advisor"]);

export const accountingMethodSchema = z.enum(["invoice", "cash"]);
export const runtimeModeSchema = z.enum(["normal", "demo"]);
export const evidenceModalitySchema = z.enum([
  "camera",
  "upload",
  "paste",
  "pdf",
  "screenshot",
  "voice-note",
  "share",
  "email-forward",
]);
export const reviewDecisionSchema = z.enum([
  "approve",
  "reject",
  "book-without-vat",
  "request-more-evidence",
  "split-posting",
]);
export const suggestionKindSchema = z.enum(["explanation", "recommendation", "automation-request"]);
export const reviewStatusSchema = z.enum(["needs-review", "approved", "rejected", "booked-without-vat"]);
export const trustLevelSchema = z.enum(["official", "internal", "user-upload"]);
export const eventTypeSchema = z.enum([
  "EvidenceReceived",
  "EvidenceClassified",
  "FieldsExtracted",
  "ExtractionRefreshed",
  "VoucherCreated",
  "RuleSetApplied",
  "SuggestionGenerated",
  "ReviewApproved",
  "ReviewRejected",
  "PostedToLedger",
  "VoucherImported",
  "CorrectionPosted",
  "PeriodLocked",
  "PolicyVersionActivated",
  "SimulationExecuted",
  "CloseRunGenerated",
  "ExportGenerated",
]);
export const ruleSeveritySchema = z.enum(["info", "warning", "blocking"]);
export const assistantAnswerStatusSchema = z.enum(["grounded", "insufficient-basis"]);

export const citationSchema = z.object({
  id: z.string(),
  title: z.string(),
  sourceType: trustLevelSchema,
  url: z.string().url().optional(),
  excerpt: z.string(),
  effectiveDate: z.string().optional(),
});

export const ruleHitSchema = z.object({
  id: z.string(),
  code: z.string(),
  title: z.string(),
  severity: ruleSeveritySchema,
  message: z.string(),
  sourceIds: z.array(z.string()).default([]),
});

export const extractedFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.string(),
  confidence: z.number().min(0).max(1),
  required: z.boolean().default(false),
});

export const voucherFieldSchema = z.object({
  supplierName: z.string().optional(),
  supplierVatNumber: z.string().optional(),
  invoiceNumber: z.string().optional(),
  receiptDate: z.string().optional(),
  transactionDate: z.string().optional(),
  description: z.string().optional(),
  grossAmount: z.number().optional(),
  netAmount: z.number().optional(),
  vatAmount: z.number().optional(),
  vatRate: z.number().optional(),
  currency: z.string().length(3).default("SEK"),
});

export const evidenceObjectSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  workspaceId: z.string(),
  createdAt: z.string(),
  createdBy: z.string(),
  title: z.string(),
  modalities: z.array(evidenceModalitySchema),
  originalFilename: z.string(),
  mimeType: z.string(),
  blobPath: z.string(),
  hash: z.string(),
  /** File size in bytes. Optional so pre-Phase-3 rows/payloads keep parsing unchanged. */
  sizeBytes: z.number().int().nonnegative().optional(),
  trustLevel: trustLevelSchema.default("user-upload"),
});

export const evidencePacketSchema = z.object({
  id: z.string(),
  evidenceIds: z.array(z.string()),
  note: z.string().optional(),
  voiceTranscript: z.string().optional(),
});

export const voucherSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  workspaceId: z.string(),
  evidencePacketId: z.string(),
  voucherNumber: z.string(),
  status: reviewStatusSchema,
  accountingMethod: accountingMethodSchema,
  extractedFields: z.array(extractedFieldSchema),
  voucherFields: voucherFieldSchema,
  createdAt: z.string(),
  createdBy: z.string(),
});

export const accountingSuggestionSchema = z.object({
  id: z.string(),
  voucherId: z.string(),
  accountNumber: z.string(),
  accountName: z.string(),
  vatCode: z.string(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  kind: suggestionKindSchema.default("recommendation"),
  citations: z.array(citationSchema),
  ruleHits: z.array(ruleHitSchema),
});

export const reviewTaskSchema = z.object({
  id: z.string(),
  voucherId: z.string(),
  title: z.string(),
  status: reviewStatusSchema,
  blockedReason: z.string().optional(),
  suggestedAction: z.string(),
  suggestion: accountingSuggestionSchema.optional(),
  provenanceTimeline: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      timestamp: z.string(),
      actor: z.string(),
    }),
  ),
});

export const ledgerEventSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  workspaceId: z.string(),
  aggregateType: z.enum(["evidence", "voucher", "review", "ledger", "policy", "simulation", "export"]),
  aggregateId: z.string(),
  eventType: eventTypeSchema,
  actorId: z.string(),
  occurredAt: z.string(),
  payload: z.record(z.string(), z.unknown()),
  previousHash: z.string(),
  eventHash: z.string(),
  digestDate: z.string(),
});

export const journalEntryProjectionSchema = z.object({
  id: z.string(),
  voucherId: z.string(),
  accountNumber: z.string(),
  accountName: z.string(),
  description: z.string(),
  debit: z.number(),
  credit: z.number(),
  bookedAt: z.string(),
});

export const accountBalanceProjectionSchema = z.object({
  accountNumber: z.string(),
  accountName: z.string(),
  debit: z.number(),
  credit: z.number(),
  balance: z.number(),
});

export const vatProjectionSchema = z.object({
  vatCode: z.string(),
  baseAmount: z.number(),
  vatAmount: z.number(),
  deductible: z.boolean(),
});

export const assistantSessionSchema = z.object({
  id: z.string(),
  question: z.string(),
  answer: z.string(),
  status: assistantAnswerStatusSchema,
  citations: z.array(citationSchema),
});

export const simulationRunSchema = z.object({
  id: z.string(),
  title: z.string(),
  scenario: z.string(),
  outcomeSummary: z.string(),
  affectedAccounts: z.array(z.string()),
  balanceDelta: z.array(
    z.object({
      accountNumber: z.string(),
      accountName: z.string(),
      deltaDebit: z.number(),
      deltaCredit: z.number(),
    }),
  ),
  vatDelta: z.array(
    z.object({
      vatCode: z.string(),
      deltaBase: z.number(),
      deltaAmount: z.number(),
    }),
  ),
});

export const closeRunSchema = z.object({
  id: z.string(),
  period: z.string(),
  generatedAt: z.string(),
  checklist: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      status: z.enum(["open", "ready", "blocked"]),
    }),
  ),
});

export const complianceAlertSchema = z.object({
  id: z.string(),
  title: z.string(),
  source: z.string(),
  detectedAt: z.string(),
  impactSummary: z.string(),
  kind: z.string(),
  severity: z.enum(["info", "warning", "critical"]),
  status: z.enum(["open", "acknowledged", "resolved", "dismissed"]),
  targetId: z.string().optional(),
  body: z.string().optional(),
});

export const reportBundleSchema = z.object({
  journal: z.array(journalEntryProjectionSchema),
  balances: z.array(accountBalanceProjectionSchema),
  vat: z.array(vatProjectionSchema),
});

export const evidenceCreateResultSchema = z.object({
  evidence: evidenceObjectSchema,
  packet: evidencePacketSchema,
  voucher: voucherSchema,
  review: reviewTaskSchema,
  voucherId: z.string(),
});

/** Result of one Document Intelligence (or stub) extraction run, as persisted by `updateEvidenceExtraction`. */
export const extractionResultSchema = z.object({
  modelId: z.string(),
  fields: z.array(extractedFieldSchema).min(1),
  extractedAt: z.string(),
});
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

/** Evidence joined to its packet/voucher/review — shape of `GET /api/evidence/:id`. */
export const evidenceContextSchema = z.object({
  evidence: evidenceObjectSchema,
  packet: evidencePacketSchema.optional(),
  voucher: voucherSchema.optional(),
  review: reviewTaskSchema.optional(),
});
export type EvidenceContext = z.infer<typeof evidenceContextSchema>;

export const evidenceCreateInputSchema = z.object({
  organizationId: z.string(),
  workspaceId: z.string(),
  actorId: z.string(),
  title: z.string(),
  originalFilename: z.string(),
  mimeType: z.string(),
  modalities: z.array(evidenceModalitySchema),
  note: z.string().optional(),
  extractedText: z.string().optional(),
  /** Real file size in bytes. Presence gates deterministic file-seeded extraction (absent → legacy canned fields). */
  sizeBytes: z.number().int().nonnegative().optional(),
  /** Client-computed SHA-256 of the uploaded bytes (Web Crypto), lowercase hex. */
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  /** The uploadId minted by POST /api/uploads/init that this evidence registers. */
  uploadId: z.string().optional(),
  /** Canonical blob path echoed from uploadInitResult. Schema-level guard: clients cannot point at arbitrary paths. */
  blobPath: z
    .string()
    .regex(/^evidence-uploads\/[A-Za-z0-9-]+\/[^/]{1,200}$/)
    .optional(),
});

export const evidenceComposeInputSchema = z.object({
  organizationId: z.string(),
  workspaceId: z.string(),
  actorId: z.string(),
  evidenceIds: z.array(z.string()).min(1),
  note: z.string().optional(),
  voiceTranscript: z.string().optional(),
});

export const suggestionRequestSchema = z.object({
  actorId: z.string(),
});

/**
 * Reviewer corrections applied at decision time (advisory pivot Phase 3).
 * Append-only: the stored voucher/suggestion rows are never rewritten — the
 * edit only shapes the posted lines and the review read model. Amounts are
 * all-or-nothing: when any of gross/net/VAT is given, all three must be
 * present and net + VAT must equal gross (±0.01) — enforced by the stores via
 * `InvalidReviewEditError` (HTTP 422).
 */
export const reviewDecisionEditSchema = z.object({
  accountNumber: z.string().min(1),
  accountName: z.string().min(1),
  vatCode: z.string().min(1),
  grossAmount: z.number().positive().optional(),
  netAmount: z.number().nonnegative().optional(),
  vatAmount: z.number().nonnegative().optional(),
});
export type ReviewDecisionEdit = z.infer<typeof reviewDecisionEditSchema>;

export const reviewDecisionInputSchema = z.object({
  actorId: z.string(),
  notes: z.string().optional(),
  edited: reviewDecisionEditSchema.optional(),
});

export const assistantRequestSchema = z.object({
  actorId: z.string(),
  question: z.string(),
  contextVoucherId: z.string().optional(),
});

export const knowledgeQuerySchema = z.object({
  actorId: z.string(),
  query: z.string(),
});

export const simulationRequestSchema = z.object({
  actorId: z.string(),
  title: z.string(),
  scenario: z.string(),
  reviewIds: z.array(z.string()).min(1).max(50),
  action: z.enum(["approve", "book-without-vat"]),
});

/**
 * Workspace profile — country/locale/currency/fiscal-year seam for the
 * European abstractions (advisory pivot Phase 2). Lives on the org-level
 * company settings until multi-workspace lands.
 */
export const workspaceProfileSchema = z.object({
  country: countryCodeSchema.default("SE"),
  /** BCP-47; drives Intl formatting + the message catalog. */
  locale: z.string().min(2).default("sv-SE"),
  /** ISO-4217 display currency. Voucher-level multi-currency is out of scope. */
  currency: z.string().length(3).default("SEK"),
  /** MM-DD start of the fiscal year. */
  fiscalYearStart: z
    .string()
    .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
    .default("01-01"),
});
export type WorkspaceProfile = z.infer<typeof workspaceProfileSchema>;
export const DEFAULT_WORKSPACE_PROFILE: WorkspaceProfile = workspaceProfileSchema.parse({});

export const companySettingsSchema = z
  .object({
    organizationId: z.string(),
    organizationName: z.string().min(1),
    organizationNumber: z.string().min(1),
    addressLine1: z.string().min(1),
    addressLine2: z.string().optional(),
    postalCode: z.string().min(1),
    city: z.string().min(1),
    contactEmail: z.email(),
    contactPhone: z.string().optional(),
    bankIban: z.string().optional(),
    bankBic: z.string().optional(),
    profile: workspaceProfileSchema.default(DEFAULT_WORKSPACE_PROFILE),
  })
  .superRefine((value, ctx) => {
    // Validation is looked up per country — Sweden is a registry entry, not a hardcode.
    const rules = countryValidationRegistry[value.profile.country];
    if (!rules.organizationNumber.pattern.test(value.organizationNumber)) {
      ctx.addIssue({ code: "custom", message: rules.organizationNumber.message, path: ["organizationNumber"] });
    }
    if (!rules.postalCode.pattern.test(value.postalCode)) {
      ctx.addIssue({ code: "custom", message: rules.postalCode.message, path: ["postalCode"] });
    }
  });

/**
 * Result of `POST /api/imports/sie` / `LedgerStore.importSie`. Per-voucher
 * isolation: invalid vouchers land in `skipped` with a reason instead of
 * failing the whole import; re-imports skip duplicates as `"duplicate"`.
 */
export const sieImportResultSchema = z.object({
  accepted: z.boolean(),
  importedVouchers: z.number().int().nonnegative(),
  importedTransactions: z.number().int().nonnegative(),
  skipped: z.array(z.object({ reference: z.string(), reason: z.string() })).default([]),
});
export type SieImportResult = z.infer<typeof sieImportResultSchema>;

export const uploadInitSchema = z.object({
  filename: z.string(),
  mimeType: z.string(),
  size: z.number().nonnegative(),
});

// Response of POST /api/uploads/init. The client receives a short-lived URL it can PUT directly
// to (Azure Blob with a User-Delegation SAS in normal mode, or a stub URL in demo). After the PUT
// completes the client calls POST /api/evidence with `uploadId` so the API can register the blob.
export const uploadInitResultSchema = z.object({
  uploadId: z.string(),
  filename: z.string(),
  /** Server-minted canonical path (`evidence-uploads/{uploadId}/{sanitizedFilename}`) the client echoes back at create time. */
  blobPath: z.string(),
  /** Absolute URL for the PUT. In normal mode the SAS query string is already appended. */
  uploadUrl: z.string(),
  /** PUT request must echo this Content-Type to match what the SAS was minted for. */
  requiredContentType: z.string(),
  /** Required Azure Blob header for new uploads ("BlockBlob") — clients should pass it through verbatim. */
  requiredBlobType: z.literal("BlockBlob"),
  expiresInSeconds: z.number().int().positive(),
});

export const workspaceSnapshotSchema = z.object({
  evidence: z.array(evidenceObjectSchema),
  vouchers: z.array(voucherSchema),
  reviews: z.array(reviewTaskSchema),
  reports: reportBundleSchema,
  assistantExamples: z.array(assistantSessionSchema),
  closeRun: closeRunSchema,
  alerts: z.array(complianceAlertSchema),
});

export type Role = z.infer<typeof roleSchema>;
export type AccountingMethod = z.infer<typeof accountingMethodSchema>;
export type RuntimeMode = z.infer<typeof runtimeModeSchema>;
export type EvidenceModality = z.infer<typeof evidenceModalitySchema>;
export type Citation = z.infer<typeof citationSchema>;
export type RuleHit = z.infer<typeof ruleHitSchema>;
export type ExtractedField = z.infer<typeof extractedFieldSchema>;
export type VoucherField = z.infer<typeof voucherFieldSchema>;
export type EvidenceObject = z.infer<typeof evidenceObjectSchema>;
export type EvidencePacket = z.infer<typeof evidencePacketSchema>;
export type Voucher = z.infer<typeof voucherSchema>;
export type AccountingSuggestion = z.infer<typeof accountingSuggestionSchema>;
export type ReviewTask = z.infer<typeof reviewTaskSchema>;
export type LedgerEvent = z.infer<typeof ledgerEventSchema>;
export type JournalEntryProjection = z.infer<typeof journalEntryProjectionSchema>;
export type AccountBalanceProjection = z.infer<typeof accountBalanceProjectionSchema>;
export type VatProjection = z.infer<typeof vatProjectionSchema>;
export type AssistantSession = z.infer<typeof assistantSessionSchema>;
export type SimulationRun = z.infer<typeof simulationRunSchema>;
export type CloseRun = z.infer<typeof closeRunSchema>;
export type ComplianceAlert = z.infer<typeof complianceAlertSchema>;
export type ReportBundle = z.infer<typeof reportBundleSchema>;
export type EvidenceCreateResult = z.infer<typeof evidenceCreateResultSchema>;
export type WorkspaceSnapshot = z.infer<typeof workspaceSnapshotSchema>;
export type EvidenceCreateInput = z.infer<typeof evidenceCreateInputSchema>;
export type EvidenceComposeInput = z.infer<typeof evidenceComposeInputSchema>;
export type ReviewDecisionInput = z.infer<typeof reviewDecisionInputSchema>;
export type AssistantRequest = z.infer<typeof assistantRequestSchema>;
export type KnowledgeQuery = z.infer<typeof knowledgeQuerySchema>;
export type SimulationRequest = z.infer<typeof simulationRequestSchema>;
export type SuggestionRequest = z.infer<typeof suggestionRequestSchema>;
export type UploadInit = z.infer<typeof uploadInitSchema>;
export type UploadInitResult = z.infer<typeof uploadInitResultSchema>;
export type CompanySettings = z.infer<typeof companySettingsSchema>;

export type { ApiJsonErrorBody, ApiJsonErrorRuntimeMode, ApiValidationIssue } from "./api-errors";
