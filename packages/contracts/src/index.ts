import { z } from "zod";

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
  "VoucherCreated",
  "RuleSetApplied",
  "SuggestionGenerated",
  "ReviewApproved",
  "ReviewRejected",
  "PostedToLedger",
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

export const reviewDecisionInputSchema = z.object({
  actorId: z.string(),
  notes: z.string().optional(),
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

export const companySettingsSchema = z.object({
  organizationId: z.string(),
  organizationName: z.string().min(1),
  organizationNumber: z.string().regex(/^\d{6}-\d{4}$/, "Swedish org number format is XXXXXX-XXXX"),
  addressLine1: z.string().min(1),
  addressLine2: z.string().optional(),
  postalCode: z.string().regex(/^\d{3}\s?\d{2}$/, "Swedish postal code format is XXX XX"),
  city: z.string().min(1),
  contactEmail: z.email(),
  contactPhone: z.string().optional(),
  bankIban: z.string().optional(),
  bankBic: z.string().optional(),
});

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
