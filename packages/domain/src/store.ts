import type {
  AccountingSuggestion,
  AssistantSession,
  CompanySettings,
  ComplianceAlert,
  CloseRun,
  EvidenceComposeInput,
  EvidenceContext,
  EvidenceCreateInput,
  EvidenceCreateResult,
  EvidenceObject,
  EvidencePacket,
  ExtractedField,
  ExtractionResult,
  LedgerEvent,
  ReportBundle,
  ReportPack,
  ReviewDecisionEdit,
  ReviewDecisionInput,
  ReviewTask,
  SieImportResult,
  SimulationRequest,
  SimulationRun,
  Voucher,
  VoucherField,
  WorkspaceSnapshot,
} from "@jpx-accounting/contracts";
import { companySettingsSchema } from "@jpx-accounting/contracts";

import { buildAssistantScaffold } from "./assistant";
import { defaultCoaTemplate, findCoaAccount } from "./coa/registry";
import type { CoaTemplate } from "./coa/types";
import { detectComplianceIssues } from "./compliance";
import {
  buildExtractedFields,
  deriveVoucherFields,
  guessAccountingMethod,
  initialLedgerLines,
} from "./evidence-defaults";
import { assertBalancedPosting, postingImbalanceOre } from "./posting-invariants";
import { buildJournal, buildBalances, buildVat, filterLedgerLines } from "./projections";
import { buildReportPack } from "./reports/pack";
import { currentMonthToken } from "./reports/period";
import { buildDeterministicSuggestion, evaluateVoucherRules } from "./rules";
import { buildEventHash } from "./hash-chain";
import { createId, nowIso, today } from "./ids";
import type { ParsedSieFile } from "./sie/parse";
import { simulateApprovals } from "./simulation";

type LedgerLine = Parameters<typeof buildJournal>[0][number];
export type ReviewAction = "approve" | "reject" | "book-without-vat";

/**
 * Inclusive local-calendar day window (`YYYY-MM-DD` strings) for scoping the
 * report bundle. Omitted bounds are open; omitting the range entirely keeps
 * `getReports()` byte-identical to the historical unfiltered behavior.
 */
export type ReportRange = { from?: string; to?: string };

/**
 * Thrown when an API caller references review IDs that don't exist in the
 * scope. Distinguished from generic Error so the HTTP layer maps to 404
 * instead of catch-all 500 (CONVENTIONS Rule 16).
 */
export class ReviewNotFoundError extends Error {
  constructor(public readonly missingIds: string[]) {
    super(`Review(s) not found in this workspace: ${missingIds.join(", ")}`);
    this.name = "ReviewNotFoundError";
  }
}

/**
 * Thrown when a review decision carries an `edited` payload that fails the
 * amount-consistency validation. Mapped to HTTP 422 in `app.onError`
 * (CONVENTIONS Rule 16). Thrown before any mutation, so a rejected edit
 * leaves the store untouched.
 */
export class InvalidReviewEditError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid review edit: ${issues.join(" ")}`);
    this.name = "InvalidReviewEditError";
    this.issues = issues;
  }
}

/**
 * Validate a decision-time edit and derive the effective posting inputs.
 * Append-only by construction: the returned `effectiveVoucher` /
 * `effectiveSuggestion` are decision-time derivations for `buildPostingLines`
 * and the review read model — the stored voucher row is never rewritten.
 * Shared by MemoryLedgerStore and PostgresLedgerStore (CONVENTIONS Rule 11).
 */
export function resolveReviewDecisionEdit(
  voucher: Voucher,
  suggestion: AccountingSuggestion | undefined,
  edited: ReviewDecisionEdit,
): { effectiveSuggestion: AccountingSuggestion | undefined; effectiveVoucher: Voucher } {
  const issues: string[] = [];
  const anyAmountGiven =
    edited.grossAmount !== undefined || edited.netAmount !== undefined || edited.vatAmount !== undefined;
  if (anyAmountGiven) {
    if (edited.grossAmount === undefined || edited.netAmount === undefined || edited.vatAmount === undefined) {
      issues.push("Amount edits must provide grossAmount, netAmount, and vatAmount together.");
    } else if (Math.abs(edited.netAmount + edited.vatAmount - edited.grossAmount) > 0.01) {
      issues.push(
        `Edited amounts do not add up: net (${edited.netAmount}) + VAT (${edited.vatAmount}) must equal gross (${edited.grossAmount}) within 0.01.`,
      );
    }
  }
  if (issues.length > 0) {
    throw new InvalidReviewEditError(issues);
  }

  const effectiveSuggestion = suggestion
    ? {
        ...suggestion,
        accountNumber: edited.accountNumber,
        accountName: edited.accountName,
        vatCode: edited.vatCode,
      }
    : undefined;

  const amountOverrides: Partial<VoucherField> =
    edited.grossAmount !== undefined
      ? { grossAmount: edited.grossAmount, netAmount: edited.netAmount, vatAmount: edited.vatAmount }
      : {};
  const effectiveVoucher: Voucher = {
    ...voucher,
    voucherFields: { ...voucher.voucherFields, ...amountOverrides },
  };

  return { effectiveSuggestion, effectiveVoucher };
}

/**
 * Thrown when an SIE import exceeds the hard bounds (whole-file rejection).
 * Per-voucher problems (unbalanced, bad date) do NOT throw — they land in the
 * result's `skipped` list (CONVENTIONS Rule 21). Mapped to HTTP 422 in
 * `app.onError` (Rule 16).
 */
export class SieImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SieImportError";
  }
}

export const SIE_IMPORT_MAX_VOUCHERS = 500;
export const SIE_IMPORT_MAX_LINES_PER_VOUCHER = 100;

export type SieImportInput = { actorId: string; file: ParsedSieFile };

export type SiePlannedVoucher = {
  /** Idempotency key: `sie_<series>_<number>` checked against prior `VoucherImported` events. */
  aggregateId: string;
  /** Human-readable `"<series> <number>"` used in `skipped` entries. */
  reference: string;
  series: string;
  number: string;
  date: string;
  text: string | undefined;
  lines: LedgerLine[];
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Turn a parsed SIE file into per-voucher ledger-line plans. Shared by
 * MemoryLedgerStore and PostgresLedgerStore so validation, skipping, and line
 * derivation stay in lockstep (CONVENTIONS Rule 11). Bounds violations throw
 * `SieImportError`; per-voucher problems fill `skipped` and processing
 * continues (Rule 21). Duplicate detection against ALREADY-IMPORTED vouchers
 * is store-specific (event lookup) and happens in the caller.
 */
export function planSieImport(
  file: ParsedSieFile,
  coa: CoaTemplate = defaultCoaTemplate,
): { vouchers: SiePlannedVoucher[]; skipped: Array<{ reference: string; reason: string }> } {
  if (file.vouchers.length > SIE_IMPORT_MAX_VOUCHERS) {
    throw new SieImportError(
      `SIE import exceeds the ${SIE_IMPORT_MAX_VOUCHERS}-voucher bound (${file.vouchers.length} vouchers).`,
    );
  }
  const oversized = file.vouchers.find((voucher) => voucher.transactions.length > SIE_IMPORT_MAX_LINES_PER_VOUCHER);
  if (oversized) {
    throw new SieImportError(
      `SIE voucher ${oversized.series} ${oversized.number ?? ""} exceeds the ${SIE_IMPORT_MAX_LINES_PER_VOUCHER}-line bound (${oversized.transactions.length} lines).`,
    );
  }

  const vouchers: SiePlannedVoucher[] = [];
  const skipped: Array<{ reference: string; reason: string }> = [];
  const seenInFile = new Set<string>();

  file.vouchers.forEach((voucher, index) => {
    // Number is optional per spec; fall back to the file position so the
    // idempotency key stays deterministic across re-imports of the same file.
    const number = voucher.number ?? `pos${index + 1}`;
    const reference = `${voucher.series} ${number}`;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(voucher.date) || Number.isNaN(Date.parse(voucher.date))) {
      skipped.push({ reference, reason: "invalid date" });
      return;
    }
    if (voucher.transactions.length === 0) {
      skipped.push({ reference, reason: "no transactions" });
      return;
    }
    if (voucher.transactions.some((transaction) => !Number.isFinite(transaction.amount))) {
      skipped.push({ reference, reason: "invalid amount" });
      return;
    }
    const sum = voucher.transactions.reduce((acc, transaction) => acc + transaction.amount, 0);
    if (Math.abs(sum) > 0.005) {
      skipped.push({ reference, reason: "unbalanced" });
      return;
    }

    const aggregateId = `sie_${voucher.series}_${number}`;
    if (seenInFile.has(aggregateId)) {
      skipped.push({ reference, reason: "duplicate" });
      return;
    }
    seenInFile.add(aggregateId);

    const lines: LedgerLine[] = voucher.transactions.map((transaction) => ({
      voucherId: aggregateId,
      accountNumber: transaction.account,
      accountName:
        file.accounts[transaction.account] ??
        findCoaAccount(coa, transaction.account)?.name ??
        `Konto ${transaction.account}`,
      description: transaction.text ?? voucher.text ?? `SIE ${reference}`,
      debit: transaction.amount > 0 ? round2(transaction.amount) : 0,
      credit: transaction.amount < 0 ? round2(-transaction.amount) : 0,
      // v1 limitation (documented): the SIE 4 subset carries no VAT semantics,
      // so imported lines are VAT-neutral.
      vatCode: "NA",
      bookedAt: voucher.date,
      deductible: false,
    }));

    // Rounding-residue guard: the raw-sum check above tolerates |sum| ≤ 0.005,
    // but per-line round2 can still leave the ROUNDED lines öre-unbalanced
    // (e.g. +0.334 +0.334 −0.668 → 0.33 + 0.33 vs 0.67). Never import an
    // unbalanced entry; per-voucher skip, not throw (Rule 21).
    if (postingImbalanceOre(lines) !== 0) {
      skipped.push({ reference, reason: "unbalanced" });
      return;
    }

    vouchers.push({
      aggregateId,
      reference,
      series: voucher.series,
      number,
      date: voucher.date,
      text: voucher.text,
      lines,
    });
  });

  return { vouchers, skipped };
}

export interface LedgerStore {
  createEvidence(input: EvidenceCreateInput): Promise<EvidenceCreateResult>;
  composeEvidence(input: EvidenceComposeInput): Promise<EvidencePacket>;
  getEvidenceContext(
    evidenceId: string,
  ): Promise<{ evidence: EvidenceObject; packet?: EvidencePacket; voucher?: Voucher } | undefined>;
  /**
   * Persist a refreshed extraction (Document Intelligence or stub) against the
   * voucher linked to `evidenceId`. Append-only: refreshes merge fields by key,
   * regenerate the suggestion, and append `ExtractionRefreshed` +
   * `SuggestionGenerated` events — they never rewrite evidence rows or touch a
   * voucher whose review is already decided (guard returns the current context
   * unchanged). Returns `undefined` for unknown evidence.
   */
  updateEvidenceExtraction(evidenceId: string, extraction: ExtractionResult): Promise<EvidenceContext | undefined>;
  /**
   * Import a parsed SIE 4 file. Append-only: one `VoucherImported` event per
   * accepted voucher (payload carries the derived `lines` — replay truth);
   * re-imports skip duplicates via the `sie_<series>_<number>` aggregate id.
   * Imported vouchers are already booked, so no voucher/review rows are
   * created (documented v1 scope). Bounds violations throw `SieImportError`.
   */
  importSie(input: SieImportInput): Promise<SieImportResult>;
  findReviewByVoucher(voucherId: string): Promise<ReviewTask | undefined>;
  getReviewFeed(): Promise<ReviewTask[]>;
  getReports(range?: ReportRange): Promise<ReportBundle>;
  /**
   * Compose the full `ReportPack` for one period token (unified grammar —
   * `resolvePeriodToken`). Fiscal-year windows come from the workspace
   * profile's `fiscalYearStart` in company settings (default `01-01`).
   * Unknown tokens propagate `InvalidPeriodTokenError` (→ HTTP 422, Rule 16).
   */
  getReportPack(input: { period: string }): Promise<ReportPack>;
  getSnapshot(): Promise<WorkspaceSnapshot>;
  getEvents(): Promise<LedgerEvent[]>;
  suggestVoucher(voucherId: string): Promise<AccountingSuggestion | undefined>;
  applyReviewDecision(
    reviewId: string,
    action: ReviewAction,
    input: ReviewDecisionInput,
  ): Promise<ReviewTask | undefined>;
  answerAssistantQuestion(question: string): Promise<AssistantSession>;
  runSimulation(input: SimulationRequest): Promise<SimulationRun>;
  getCloseRun(): Promise<CloseRun>;
  refreshComplianceAlerts(): Promise<ComplianceAlert[]>;
  getCompanySettings(): Promise<CompanySettings | null>;
  putCompanySettings(input: CompanySettings): Promise<CompanySettings>;
}

const MEMORY_ALERT_CAP = 500;
const AUTO_DETECTED_KINDS = new Set(["stale-blocked", "missing-supplier-vat"]);

const defaultOrganizationId = "org_jpx";
const defaultWorkspaceId = "workspace_main";

export function buildPostingLines(
  voucher: Voucher,
  suggestion: AccountingSuggestion,
  action: "approve" | "book-without-vat",
  occurredAt: string,
  coa: CoaTemplate = defaultCoaTemplate,
): LedgerLine[] {
  const fields = voucher.voucherFields;
  // Non-deductible input VAT (book-without-vat) is part of the cost under
  // Swedish rules: claim 0 VAT and debit the full gross to the cost account.
  const vatAmount = action === "book-without-vat" ? 0 : (fields.vatAmount ?? 0);
  const grossAmount = fields.grossAmount ?? round2((fields.netAmount ?? 0) + vatAmount);
  // Derive net from gross − VAT instead of trusting fields.netAmount: extracted
  // triples can be öre-inconsistent, and resolveReviewDecisionEdit admits a
  // ±0.01 tolerance — deriving is what keeps Σdebit = Σcredit unconditionally.
  const netAmount = round2(grossAmount - vatAmount);
  const description = fields.description ?? "Reviewed voucher";
  const inputVatAccount = coa.roles.inputVat;
  const bankAccount = coa.roles.bank;

  const lines: LedgerLine[] = [
    {
      voucherId: voucher.id,
      accountNumber: suggestion.accountNumber,
      accountName: suggestion.accountName,
      description,
      debit: netAmount,
      credit: 0,
      vatCode: suggestion.vatCode,
      bookedAt: occurredAt,
      deductible: action !== "book-without-vat",
    },
    // Zero-amount for book-without-vat, kept for shape stability and so the
    // journal shows the explicit "no VAT claimed" decision. buildVat and box 48
    // read input VAT off this account's amounts, so 0 claims nothing.
    {
      voucherId: voucher.id,
      accountNumber: inputVatAccount,
      accountName: findCoaAccount(coa, inputVatAccount)?.name ?? inputVatAccount,
      description: `${description} VAT`,
      debit: vatAmount,
      credit: 0,
      vatCode: suggestion.vatCode,
      bookedAt: occurredAt,
      deductible: action !== "book-without-vat",
    },
    {
      voucherId: voucher.id,
      accountNumber: bankAccount,
      accountName: findCoaAccount(coa, bankAccount)?.name ?? bankAccount,
      description,
      debit: 0,
      credit: grossAmount,
      vatCode: "NA",
      bookedAt: occurredAt,
      deductible: false,
    },
  ];
  return assertBalancedPosting(lines, `voucher ${voucher.id}`);
}

/**
 * Merge extraction fields by key: refreshed values win, existing keys absent
 * from the refresh are retained (order-stable: existing order first, new keys
 * appended). Shared by MemoryLedgerStore and PostgresLedgerStore so the two
 * stay in lockstep (CONVENTIONS Rule 11).
 */
export function mergeExtractedFields(existing: ExtractedField[], refreshed: ExtractedField[]): ExtractedField[] {
  const refreshedByKey = new Map(refreshed.map((field) => [field.key, field]));
  const merged = existing.map((field) => refreshedByKey.get(field.key) ?? field);
  const existingKeys = new Set(existing.map((field) => field.key));
  for (const field of refreshed) {
    if (!existingKeys.has(field.key)) merged.push(field);
  }
  return merged;
}

/**
 * Recompute voucher-level fields from a merged extraction while preserving the
 * human-facing `description` and `currency` of the current voucher (extraction
 * refreshes must not rename what the user already sees). Shared across stores.
 */
export function recomputeVoucherFields(mergedFields: ExtractedField[], current: VoucherField): VoucherField {
  const derived = deriveVoucherFields(mergedFields, { title: current.description ?? "" });
  return {
    ...derived,
    description: current.description,
    currency: current.currency,
  };
}

export class MemoryLedgerStore implements LedgerStore {
  private readonly evidence = new Map<string, EvidenceObject>();
  private readonly evidencePackets = new Map<string, EvidencePacket>();
  private readonly vouchers = new Map<string, Voucher>();
  private readonly reviews = new Map<string, ReviewTask>();
  private readonly suggestions = new Map<string, AccountingSuggestion>();
  private readonly evidenceIdToPacketId = new Map<string, string>();
  private readonly packetIdToVoucherId = new Map<string, string>();
  private readonly voucherIdToReviewId = new Map<string, string>();
  private readonly events: LedgerEvent[] = [];
  private readonly ledgerLines: LedgerLine[] = assertBalancedPosting(initialLedgerLines(), "demo seed lines");
  private readonly assistantExamples: AssistantSession[] = [];
  private alerts: ComplianceAlert[] = [
    {
      id: "alert_vat_1",
      title: "Representation review queue",
      source: "Skatteverket / internal policy",
      detectedAt: nowIso(),
      impactSummary:
        "Two receipts look like representation and should be checked against attendee and VAT-limit rules.",
      kind: "representation-review",
      severity: "warning",
      status: "open",
    },
  ];
  private companySettings: CompanySettings | null = null;

  constructor() {
    const seededEvidence = this.createEvidenceSync({
      organizationId: defaultOrganizationId,
      workspaceId: defaultWorkspaceId,
      actorId: "user_founder",
      title: "OpenAI subscription invoice",
      originalFilename: "openai-march-2026.pdf",
      mimeType: "application/pdf",
      modalities: ["pdf", "upload"],
      extractedText: "OpenAI March 2026 subscription invoice",
    });

    const seededReviewId = this.voucherIdToReviewId.get(seededEvidence.voucherId);
    const review = seededReviewId ? this.reviews.get(seededReviewId) : undefined;
    if (review) {
      review.title = "Approve AI subscription posting";
    }

    this.assistantExamples.push({
      id: createId("assistant"),
      question: "Can we deduct VAT on this invoice right away?",
      answer:
        "The invoice looks deductible, but the system still requires a human approval because deductible VAT should only be posted after invoice requirements are confirmed.",
      status: "grounded",
      citations: review?.suggestion?.citations ?? [],
    });
  }

  private appendEvent(event: Omit<LedgerEvent, "id" | "eventHash" | "previousHash" | "digestDate">) {
    const previousHash = this.events.at(-1)?.eventHash ?? "GENESIS";
    const digestDate = new Date().toISOString().slice(0, 10);
    const payload = JSON.stringify(event.payload);

    const fullEvent: LedgerEvent = {
      ...event,
      id: createId("evt"),
      previousHash,
      eventHash: buildEventHash(previousHash, payload),
      digestDate,
    };

    this.events.push(fullEvent);
    return fullEvent;
  }

  async createEvidence(input: EvidenceCreateInput): Promise<EvidenceCreateResult> {
    return this.createEvidenceSync(input);
  }

  private createEvidenceSync(input: EvidenceCreateInput): EvidenceCreateResult {
    const createdAt = nowIso();
    const evidenceId = createId("evidence");
    const packetId = createId("packet");
    const voucherId = createId("voucher");

    const evidence: EvidenceObject = {
      id: evidenceId,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      createdAt,
      createdBy: input.actorId,
      title: input.title,
      modalities: input.modalities,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      // Honest upload metadata when the client went through init→PUT→create;
      // legacy synthetic path + derived hash preserved when no upload happened.
      blobPath: input.blobPath ?? `evidence/${evidenceId}/${input.originalFilename}`,
      hash: input.sha256 ?? buildEventHash("file", `${input.originalFilename}:${input.title}:${createdAt}`),
      sizeBytes: input.sizeBytes,
      trustLevel: "user-upload",
    };

    const packet: EvidencePacket = {
      id: packetId,
      evidenceIds: [evidenceId],
      note: input.note,
      voiceTranscript: input.extractedText,
    };

    const extractedFields = buildExtractedFields(input);
    const voucher: Voucher = {
      id: voucherId,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      evidencePacketId: packetId,
      voucherNumber: `V-${this.vouchers.size + 1001}`,
      status: "needs-review",
      accountingMethod: guessAccountingMethod(input),
      extractedFields,
      voucherFields: deriveVoucherFields(extractedFields, input),
      createdAt,
      createdBy: input.actorId,
    };

    const ruleHits = evaluateVoucherRules(voucher);
    const suggestion = buildDeterministicSuggestion(voucher, ruleHits);
    const review: ReviewTask = {
      id: createId("review"),
      voucherId,
      title: `Review ${voucher.voucherNumber}`,
      status: "needs-review",
      blockedReason: ruleHits.some((rule) => rule.severity === "blocking")
        ? "Mandatory bookkeeping or VAT data must be confirmed before deductible VAT can be approved."
        : undefined,
      suggestedAction: ruleHits.some((rule) => rule.severity === "blocking")
        ? "Request more evidence or post without VAT deduction."
        : "Approve the proposed posting.",
      suggestion,
      provenanceTimeline: [
        { id: createId("step"), label: "Evidence received", timestamp: createdAt, actor: input.actorId },
        { id: createId("step"), label: "Fields extracted", timestamp: createdAt, actor: "system-extractor" },
        { id: createId("step"), label: "Rules applied", timestamp: createdAt, actor: "system-rules" },
        { id: createId("step"), label: "Suggestion generated", timestamp: createdAt, actor: "system-ai" },
      ],
    };

    this.evidence.set(evidenceId, evidence);
    this.evidencePackets.set(packetId, packet);
    this.vouchers.set(voucherId, voucher);
    this.reviews.set(review.id, review);
    this.suggestions.set(voucherId, suggestion);
    this.evidenceIdToPacketId.set(evidenceId, packetId);
    this.packetIdToVoucherId.set(packetId, voucherId);
    this.voucherIdToReviewId.set(voucherId, review.id);

    this.appendEvent({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      aggregateType: "evidence",
      aggregateId: evidenceId,
      eventType: "EvidenceReceived",
      actorId: input.actorId,
      occurredAt: createdAt,
      payload: evidence,
    });

    this.appendEvent({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      aggregateType: "voucher",
      aggregateId: voucherId,
      eventType: "FieldsExtracted",
      actorId: "system-extractor",
      occurredAt: createdAt,
      payload: { extractedFields },
    });

    this.appendEvent({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      aggregateType: "voucher",
      aggregateId: voucherId,
      eventType: "VoucherCreated",
      actorId: input.actorId,
      occurredAt: createdAt,
      payload: voucher,
    });

    this.appendEvent({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      aggregateType: "review",
      aggregateId: review.id,
      eventType: "SuggestionGenerated",
      actorId: "system-ai",
      occurredAt: createdAt,
      payload: suggestion,
    });

    return { evidence, packet, voucher, review, voucherId };
  }

  async composeEvidence(input: EvidenceComposeInput): Promise<EvidencePacket> {
    const packet: EvidencePacket = {
      id: createId("packet"),
      evidenceIds: input.evidenceIds,
      note: input.note,
      voiceTranscript: input.voiceTranscript,
    };
    this.evidencePackets.set(packet.id, packet);

    let voucherIdToRelink: string | undefined;
    for (const eid of input.evidenceIds) {
      const previousPacketId = this.evidenceIdToPacketId.get(eid);
      if (previousPacketId) {
        const linkedVoucherId = this.packetIdToVoucherId.get(previousPacketId);
        if (linkedVoucherId && !voucherIdToRelink) {
          voucherIdToRelink = linkedVoucherId;
        }
      }
      this.evidenceIdToPacketId.set(eid, packet.id);
    }

    if (voucherIdToRelink) {
      this.packetIdToVoucherId.set(packet.id, voucherIdToRelink);
      const voucher = this.vouchers.get(voucherIdToRelink);
      if (voucher && voucher.evidencePacketId !== packet.id) {
        this.vouchers.set(voucherIdToRelink, { ...voucher, evidencePacketId: packet.id });
      }
    }

    return packet;
  }

  async getEvidenceContext(evidenceId: string): Promise<
    | {
        evidence: EvidenceObject;
        packet?: EvidencePacket;
        voucher?: Voucher;
      }
    | undefined
  > {
    const evidence = this.evidence.get(evidenceId);
    if (!evidence) return undefined;

    const packetId = this.evidenceIdToPacketId.get(evidenceId);
    const packet = packetId ? this.evidencePackets.get(packetId) : undefined;
    const voucherId = packetId ? this.packetIdToVoucherId.get(packetId) : undefined;
    const voucher = voucherId ? this.vouchers.get(voucherId) : undefined;

    return {
      evidence,
      ...(packet ? { packet } : {}),
      ...(voucher ? { voucher } : {}),
    };
  }

  async updateEvidenceExtraction(
    evidenceId: string,
    extraction: ExtractionResult,
  ): Promise<EvidenceContext | undefined> {
    // 1. Resolve evidence→packet→voucher via the existing join.
    const context = await this.getEvidenceContext(evidenceId);
    if (!context) return undefined;
    const { evidence, packet } = context;
    const voucher = context.voucher;
    if (!voucher) {
      return { evidence: { ...evidence }, ...(packet ? { packet: { ...packet } } : {}) };
    }

    const reviewId = this.voucherIdToReviewId.get(voucher.id);
    const review = reviewId ? this.reviews.get(reviewId) : undefined;

    // 2. Decided-voucher guard (append-only): a reviewed voucher is history —
    //    return the current context without any mutation or event.
    if (voucher.status !== "needs-review") {
      return {
        evidence: { ...evidence },
        ...(packet ? { packet: { ...packet } } : {}),
        voucher: { ...voucher },
        ...(review ? { review: { ...review } } : {}),
      };
    }

    const occurredAt = nowIso();

    // 3. Merge by key; 4. recompute voucher fields preserving description/currency.
    const mergedFields = mergeExtractedFields(voucher.extractedFields, extraction.fields);
    const voucherFields = recomputeVoucherFields(mergedFields, voucher.voucherFields);

    // 5. Immutable replace of the voucher read model (CONVENTIONS Rule 17).
    const updatedVoucher: Voucher = { ...voucher, extractedFields: mergedFields, voucherFields };
    this.vouchers.set(updatedVoucher.id, updatedVoucher);

    // 6. Re-run rules, regenerate the suggestion, update the review read model.
    const ruleHits = evaluateVoucherRules(updatedVoucher);
    const suggestion = buildDeterministicSuggestion(updatedVoucher, ruleHits);
    const blocked = ruleHits.some((rule) => rule.severity === "blocking");
    let updatedReview: ReviewTask | undefined;
    if (review) {
      updatedReview = {
        ...review,
        suggestion,
        suggestedAction: blocked
          ? "Request more evidence or post without VAT deduction."
          : "Approve the proposed posting.",
        provenanceTimeline: [
          ...review.provenanceTimeline,
          { id: createId("step"), label: "Fields re-extracted", timestamp: occurredAt, actor: "system-extractor" },
          { id: createId("step"), label: "Suggestion regenerated", timestamp: occurredAt, actor: "system-ai" },
        ],
      };
      if (blocked) {
        updatedReview.blockedReason =
          "Mandatory bookkeeping or VAT data must be confirmed before deductible VAT can be approved.";
      } else {
        delete updatedReview.blockedReason;
      }
      this.reviews.set(updatedReview.id, updatedReview);
      this.suggestions.set(updatedVoucher.id, suggestion);
    }

    // 7. Append the two hash-chained events (full snapshot payload, Rule 13).
    this.appendEvent({
      organizationId: updatedVoucher.organizationId,
      workspaceId: updatedVoucher.workspaceId,
      aggregateType: "voucher",
      aggregateId: updatedVoucher.id,
      eventType: "ExtractionRefreshed",
      actorId: "system-extractor",
      occurredAt,
      payload: {
        evidenceId,
        voucherId: updatedVoucher.id,
        modelId: extraction.modelId,
        extractedAt: extraction.extractedAt,
        fields: mergedFields,
        voucherFields,
      },
    });
    if (updatedReview) {
      this.appendEvent({
        organizationId: updatedVoucher.organizationId,
        workspaceId: updatedVoucher.workspaceId,
        aggregateType: "review",
        aggregateId: updatedReview.id,
        eventType: "SuggestionGenerated",
        actorId: "system-ai",
        occurredAt,
        payload: suggestion,
      });
    }

    // 8. Fresh copies for the caller.
    return {
      evidence: { ...evidence },
      ...(packet ? { packet: { ...packet } } : {}),
      voucher: { ...updatedVoucher },
      ...(updatedReview ? { review: { ...updatedReview } } : {}),
    };
  }

  async importSie(input: SieImportInput): Promise<SieImportResult> {
    const { vouchers, skipped } = planSieImport(input.file);
    const result: SieImportResult = {
      accepted: true,
      importedVouchers: 0,
      importedTransactions: 0,
      skipped: [...skipped],
    };

    // Idempotency: skip vouchers whose aggregate id was already imported.
    const alreadyImported = new Set(
      this.events.filter((event) => event.eventType === "VoucherImported").map((event) => event.aggregateId),
    );

    const occurredAt = nowIso();
    for (const planned of vouchers) {
      if (alreadyImported.has(planned.aggregateId)) {
        result.skipped.push({ reference: planned.reference, reason: "duplicate" });
        continue;
      }

      this.ledgerLines.push(...planned.lines);
      this.appendEvent({
        organizationId: defaultOrganizationId,
        workspaceId: defaultWorkspaceId,
        aggregateType: "ledger",
        aggregateId: planned.aggregateId,
        eventType: "VoucherImported",
        actorId: input.actorId,
        occurredAt,
        payload: {
          source: "sie",
          series: planned.series,
          number: planned.number,
          date: planned.date,
          text: planned.text,
          lines: planned.lines,
        },
      });

      result.importedVouchers += 1;
      result.importedTransactions += planned.lines.length;
    }

    return result;
  }

  async findReviewByVoucher(voucherId: string): Promise<ReviewTask | undefined> {
    const reviewId = this.voucherIdToReviewId.get(voucherId);
    return reviewId ? this.reviews.get(reviewId) : undefined;
  }

  async getReviewFeed(): Promise<ReviewTask[]> {
    // Newest-first: the reviews Map preserves creation order (an existing key
    // is never re-inserted, only `.set()`-updated in place), so reversing it
    // gives newest-first deterministically. Sorting by `review.id` (a random
    // UUID) here was arbitrary and diverged from PostgresLedgerStore's
    // `ORDER BY created_at DESC, id DESC` (CONVENTIONS Rule 11 / §A N12).
    return [...this.reviews.values()].reverse();
  }

  async getReports(range?: ReportRange): Promise<ReportBundle> {
    const lines = filterLedgerLines(this.ledgerLines, range);
    return {
      journal: buildJournal(lines),
      balances: buildBalances(lines),
      vat: buildVat(lines),
    };
  }

  async getReportPack(input: { period: string }): Promise<ReportPack> {
    const settings = await this.getCompanySettings();
    return buildReportPack(this.ledgerLines, {
      periodToken: input.period,
      fiscalYearStart: settings?.profile.fiscalYearStart ?? "01-01",
    });
  }

  async getSnapshot(): Promise<WorkspaceSnapshot> {
    // Defensive array copies (Rule 17): internal collections are mutated in place
    // (e.g. answerAssistantQuestion unshifts assistantExamples) — callers must not
    // share mutable refs with the store (§A N8).
    return {
      evidence: [...this.evidence.values()],
      vouchers: [...this.vouchers.values()],
      reviews: await this.getReviewFeed(),
      reports: await this.getReports(),
      assistantExamples: [...this.assistantExamples],
      closeRun: await this.getCloseRun(),
      alerts: [...this.alerts],
      packets: [...this.evidencePackets.values()],
    };
  }

  async getEvents(): Promise<LedgerEvent[]> {
    return [...this.events];
  }

  async suggestVoucher(voucherId: string): Promise<AccountingSuggestion | undefined> {
    const voucher = this.vouchers.get(voucherId);
    if (!voucher) return undefined;

    const ruleHits = evaluateVoucherRules(voucher);
    const suggestion = buildDeterministicSuggestion(voucher, ruleHits);
    this.suggestions.set(voucherId, suggestion);
    return suggestion;
  }

  async applyReviewDecision(
    reviewId: string,
    action: ReviewAction,
    input: ReviewDecisionInput,
  ): Promise<ReviewTask | undefined> {
    const review = this.reviews.get(reviewId);
    if (!review) return undefined;

    const voucher = this.vouchers.get(review.voucherId);
    if (!voucher) return undefined;
    // Review decisions are single-use mutations; replayed requests should not post duplicate ledger lines.
    if (review.status !== "needs-review") return { ...review };

    // Decision-time derivation for edited approvals: validates (throwing
    // InvalidReviewEditError BEFORE any mutation) and derives the effective
    // posting inputs. Append-only: the stored voucher row is NOT rewritten.
    const edited = action !== "reject" ? input.edited : undefined;
    let postingSuggestion = review.suggestion;
    let postingVoucher = voucher;
    if (edited) {
      const resolved = resolveReviewDecisionEdit(voucher, review.suggestion, edited);
      postingSuggestion = resolved.effectiveSuggestion;
      postingVoucher = resolved.effectiveVoucher;
    }

    const occurredAt = nowIso();
    const newStatus = action === "approve" ? "approved" : action === "reject" ? "rejected" : "booked-without-vat";
    const timelineStep = {
      id: createId("step"),
      label:
        action === "approve"
          ? edited
            ? "Approved with edits"
            : "Review approved"
          : action === "reject"
            ? "Review rejected"
            : edited
              ? "Booked without VAT deduction (edited)"
              : "Booked without VAT deduction",
      timestamp: occurredAt,
      actor: input.actorId,
    };

    // Clone-before-mutate (Rule 17): review/voucher may have been returned by
    // getSnapshot() — replace read models instead of mutating shared objects.
    let updatedReview: ReviewTask = {
      ...review,
      status: newStatus,
      provenanceTimeline: [...review.provenanceTimeline, timelineStep],
    };
    const updatedVoucher: Voucher = { ...voucher, status: newStatus };
    if (edited && postingSuggestion) {
      // Review read model reflects what was actually posted.
      updatedReview = { ...updatedReview, suggestion: postingSuggestion };
      this.suggestions.set(voucher.id, postingSuggestion);
    }
    this.reviews.set(reviewId, updatedReview);
    this.vouchers.set(voucher.id, updatedVoucher);

    this.appendEvent({
      organizationId: updatedVoucher.organizationId,
      workspaceId: updatedVoucher.workspaceId,
      aggregateType: "review",
      aggregateId: reviewId,
      eventType: action === "approve" ? "ReviewApproved" : "ReviewRejected",
      actorId: input.actorId,
      occurredAt,
      payload: { action, notes: input.notes, ...(edited ? { edited } : {}) },
    });

    if (action !== "reject" && postingSuggestion) {
      const lines = buildPostingLines(postingVoucher, postingSuggestion, action, occurredAt);
      this.ledgerLines.push(...lines);

      this.appendEvent({
        organizationId: updatedVoucher.organizationId,
        workspaceId: updatedVoucher.workspaceId,
        aggregateType: "ledger",
        aggregateId: updatedVoucher.id,
        eventType: "PostedToLedger",
        actorId: input.actorId,
        occurredAt,
        // `lines` in the payload keeps event-payload replay the truth in both
        // stores (fixes the Memory/Postgres parity gap — Phase 3 finding 13).
        payload: { action, suggestion: postingSuggestion, lines },
      });
    }

    return { ...updatedReview };
  }

  async answerAssistantQuestion(question: string): Promise<AssistantSession> {
    const answer = buildAssistantScaffold(question);
    this.assistantExamples.unshift(answer);
    return answer;
  }

  async runSimulation(input: SimulationRequest): Promise<SimulationRun> {
    // Dedup at boundary (Rule 23): Postgres .in() dedupes server-side; Memory
    // must match for parity (Rule 11).
    const reviewIds = [...new Set(input.reviewIds)];
    const requestedReviews = reviewIds.map((id) => this.reviews.get(id)).filter((r): r is ReviewTask => Boolean(r));
    if (requestedReviews.length !== reviewIds.length) {
      const found = new Set(requestedReviews.map((r) => r.id));
      throw new ReviewNotFoundError(reviewIds.filter((id) => !found.has(id)));
    }
    const requestedVouchers = requestedReviews
      .map((r) => this.vouchers.get(r.voucherId))
      .filter((v): v is Voucher => Boolean(v));
    const requestedSuggestions = requestedReviews
      .map((r) => r.suggestion)
      .filter((s): s is AccountingSuggestion => Boolean(s));

    const { balanceDelta, vatDelta, affectedAccounts } = simulateApprovals(
      requestedReviews,
      requestedSuggestions,
      requestedVouchers,
      input.action,
    );

    const result: SimulationRun = {
      id: createId("sim"),
      title: input.title,
      scenario: input.scenario,
      outcomeSummary: `Simulated ${requestedReviews.length} review(s); ${affectedAccounts.length} accounts affected. No production postings were changed.`,
      affectedAccounts,
      balanceDelta,
      vatDelta,
    };

    this.appendEvent({
      organizationId: defaultOrganizationId,
      workspaceId: defaultWorkspaceId,
      aggregateType: "simulation",
      aggregateId: result.id,
      eventType: "SimulationExecuted",
      actorId: input.actorId,
      occurredAt: nowIso(),
      payload: result,
    });

    return result;
  }

  async refreshComplianceAlerts(): Promise<ComplianceAlert[]> {
    const detected = detectComplianceIssues([...this.reviews.values()], [...this.vouchers.values()], today());
    const detectedById = new Map(detected.map((a) => [a.id, a]));

    // Immutable single-pass rebuild (CONVENTIONS Rules 17, 24): clone before
    // mutating so prior snapshot consumers don't observe spooky state flips.
    // Auto-detected alerts can transition open<->resolved; user states
    // (acknowledged, dismissed) and seeded non-auto kinds pass through unchanged.
    const rebuilt: ComplianceAlert[] = this.alerts.map((alert) => {
      if (!AUTO_DETECTED_KINDS.has(alert.kind)) return { ...alert };
      const stillDetected = detectedById.has(alert.id);
      if (alert.status === "open" && !stillDetected) return { ...alert, status: "resolved" };
      if (alert.status === "resolved" && stillDetected) return { ...alert, status: "open" };
      return { ...alert };
    });

    const existingIds = new Set(rebuilt.map((a) => a.id));
    for (const alert of detected) {
      if (!existingIds.has(alert.id)) rebuilt.push({ ...alert });
    }

    // Bound accumulation (Rule 25): cap auto-detected entries; seeded alerts pinned.
    const seeded = rebuilt.filter((a) => !AUTO_DETECTED_KINDS.has(a.kind));
    const auto = rebuilt.filter((a) => AUTO_DETECTED_KINDS.has(a.kind));
    const capRemaining = Math.max(0, MEMORY_ALERT_CAP - seeded.length);
    const trimmedAuto = auto.length > capRemaining ? auto.slice(-capRemaining) : auto;

    this.alerts = [...seeded, ...trimmedAuto];
    return [...this.alerts];
  }

  async getCompanySettings(): Promise<CompanySettings | null> {
    return this.companySettings ? { ...this.companySettings } : null;
  }

  async putCompanySettings(input: CompanySettings): Promise<CompanySettings> {
    // Normalize through the schema so legacy payloads (no profile) gain the
    // Sweden defaults exactly like the Postgres read path does (store parity).
    this.companySettings = companySettingsSchema.parse(input);
    return { ...this.companySettings };
  }

  async getCloseRun(): Promise<CloseRun> {
    // Period-close engine is not implemented yet — return an honest empty shell
    // instead of a synthetic checklist (Phase 3.5 / §A C2).
    return {
      id: "close_unavailable",
      period: currentMonthToken(),
      generatedAt: nowIso(),
      checklist: [],
    };
  }
}
