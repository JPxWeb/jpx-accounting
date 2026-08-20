import type {
  AccountingSuggestion,
  CompanySettings,
  ComplianceAlert,
  CloseRun,
  EvidenceComposeInput,
  EvidenceContext,
  EvidenceCreateInput,
  EvidenceCreateResult,
  EvidenceObject,
  EvidencePacket,
  ExtractionResult,
  LedgerEvent,
  ManualVoucherInput,
  ManualVoucherResult,
  ReportBundle,
  ReportPack,
  ReviewDecisionInput,
  ReviewTask,
  SieImportResult,
  SimulationRequest,
  SimulationRun,
  Voucher,
  WorkspaceSnapshot,
} from "@jpx-accounting/contracts";
import { companySettingsSchema } from "@jpx-accounting/contracts";

import { defaultCoaTemplate, findCoaAccount } from "./coa/registry";
import type { CoaTemplate } from "./coa/types";
import { detectComplianceIssues } from "./compliance";
import { initialLedgerLines } from "./evidence-defaults";
import { assertBalancedPosting, postingImbalanceOre } from "./posting-invariants";
import {
  buildJournal,
  buildBalances,
  buildVat,
  collectLedgerLinesFromEvents,
  filterLedgerLines,
  type LedgerLine,
} from "./projections";
import { buildReportPack } from "./reports/pack";
import { currentMonthToken } from "./reports/period";
import { buildDeterministicSuggestion, evaluateVoucherRules } from "./rules";
import { buildEventHash } from "./hash-chain";
import { createId, nowIso, today } from "./ids";
import type { ParsedSieFile } from "./sie/parse";
import { simulateApprovals } from "./simulation";
import {
  AUTO_DETECTED_ALERT_KINDS,
  planComplianceMerge,
  planEvidenceCreate,
  planExtractionRefresh,
  planManualVoucher,
  planReviewDecision,
} from "./store-planning";
import {
  DEMO_ACTOR_ID,
  InvalidReviewEditError,
  ReviewBlockedError,
  buildPostingLines,
  deriveBookedAt,
  isValidCalendarDay,
  localDayOfTimestamp,
  mergeExtractedFields,
  recomputeVoucherFields,
  resolveReviewDecisionEdit,
  round2,
  validEditVatCodes,
  type ActorAttribution,
  type ApprovalGate,
  type ReviewAction,
} from "./store-shared";

// Re-export shared helpers for `@jpx-accounting/domain/store` consumers that
// prefer one import. The public `"."` barrel exports `./store-shared` only —
// never this module — so browser clients cannot pull MemoryLedgerStore via the
// fat path. Do NOT add `import "server-only"` here while api-client still
// statically constructs MemoryLedgerStore for the demo fallback (P1 stretch).
export {
  DEMO_ACTOR_ID,
  InvalidReviewEditError,
  ReviewBlockedError,
  buildPostingLines,
  deriveBookedAt,
  isValidCalendarDay,
  localDayOfTimestamp,
  mergeExtractedFields,
  recomputeVoucherFields,
  resolveReviewDecisionEdit,
  round2,
  validEditVatCodes,
};
export type { ActorAttribution, ApprovalGate, ReviewAction };

import { DEFAULT_TENANT_SCOPE, type TenantScope } from "./tenant";

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
 * Thrown when `composeEvidence` is given a `targetVoucherId` that doesn't
 * exist in scope. Distinguished from generic Error so the HTTP layer maps to
 * 404 instead of catch-all 500 (CONVENTIONS Rule 16) — same pattern as
 * `ReviewNotFoundError`. Thrown BEFORE any mutation, so a miss leaves zero
 * state behind in either store.
 */
export class VoucherNotFoundError extends Error {
  constructor(public readonly voucherId: string) {
    super(`Voucher not found in this workspace: ${voucherId}`);
    this.name = "VoucherNotFoundError";
  }
}

/**
 * Content-dedupe predicate for idempotent `createEvidence` (WS-D R19). A create
 * is a duplicate of an EXISTING evidence row only when the caller supplied BOTH
 * `sha256` and `sizeBytes` (legacy/metadata-only callers never dedupe) and the
 * existing row carries the identical (hash, sizeBytes) tuple. Tenant scoping is
 * the store's job before candidates reach this predicate (constructor /
 * DEFAULT_TENANT_SCOPE) — request inputs no longer carry organizationId /
 * workspaceId. Shared by MemoryLedgerStore and PostgresLedgerStore so both
 * stores answer "is this the same file?" identically (CONVENTIONS Rule 11).
 */
export function isDuplicateEvidence(existing: EvidenceObject, input: EvidenceCreateInput): boolean {
  return (
    input.sha256 !== undefined &&
    input.sizeBytes !== undefined &&
    existing.hash === input.sha256 &&
    existing.sizeBytes === input.sizeBytes
  );
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

/** Max parse warnings threaded into a `SieImportResult` before summarizing. */
export const SIE_IMPORT_MAX_RESULT_WARNINGS = 50;

/**
 * Thread `ParsedSieFile.warnings` into the import result under a hard cap
 * (CONVENTIONS Rule 25 — bounded accumulation). `parseSie` emits one warning
 * per ignored line, so a pathological 32 MiB upload (the API's SIE body limit)
 * of junk lines would otherwise serialize millions of strings back to the
 * browser. Real files stay far under the cap; when they don't, the tail is
 * replaced by a single count line so the reader still learns nothing was
 * hidden. Shared by both stores so the field can't drift (Rule 11 parity).
 */
export function summarizeSieWarnings(warnings: readonly string[]): string[] {
  if (warnings.length <= SIE_IMPORT_MAX_RESULT_WARNINGS) return [...warnings];
  return [
    ...warnings.slice(0, SIE_IMPORT_MAX_RESULT_WARNINGS),
    `… and ${warnings.length - SIE_IMPORT_MAX_RESULT_WARNINGS} more parse warnings (not shown).`,
  ];
}

export type SieImportInput = ActorAttribution & { file: ParsedSieFile };

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

/**
 * Build the lightweight, already-posted Voucher row materialized for a SIE
 * import (KFR Phase D / Task 1, readiness G3 — imported history was previously
 * invisible to evidence attach). Shared by MemoryLedgerStore and
 * PostgresLedgerStore so the shape can't drift (CONVENTIONS Rule 11 store
 * parity). `voucherNumber` reuses `planned.reference` ("<series> <number>")
 * verbatim — the same string the journal/reports already display for `sie_*`
 * ids, and unique per workspace because `aggregateId` is derived from the same
 * series+number pair (`ledger_vouchers_number_idx`).
 *
 * `status: "posted"` — NOT "approved": the entry arrived already booked and
 * never passed a review decision, so it carries no ReviewTask. It stays out of
 * the review feed for exactly that reason.
 */
export function buildImportedVoucher(
  planned: SiePlannedVoucher,
  ctx: TenantScope & { actorId: string; createdAt: string },
): Voucher {
  return {
    id: planned.aggregateId,
    organizationId: ctx.organizationId,
    workspaceId: ctx.workspaceId,
    evidencePacketId: null,
    voucherNumber: planned.reference,
    status: "posted",
    origin: "import",
    accountingMethod: "invoice",
    extractedFields: [],
    voucherFields: {
      description: planned.text ?? planned.reference,
      transactionDate: planned.date,
      currency: "SEK",
    },
    createdAt: ctx.createdAt,
    createdBy: ctx.actorId,
  };
}

export interface LedgerStore {
  createEvidence(input: EvidenceCreateInput & ActorAttribution): Promise<EvidenceCreateResult>;
  /**
   * Bundle evidence into a NEW packet (packets are never edited in place) and
   * link it to a voucher. Link resolution, in order:
   *
   * 1. `input.targetVoucherId` when given (KFR Phase D / Task 2) — the only
   *    way to reach an imported or manual voucher, which starts with
   *    `evidencePacketId: null` and so leaves no packet breadcrumb. An id
   *    naming no voucher in this workspace throws `VoucherNotFoundError`
   *    BEFORE any mutation (→ HTTP 404 `voucher_not_found`).
   * 2. Otherwise auto-detect: the voucher currently linked to the first
   *    prior packet any of `evidenceIds` belonged to.
   *
   * A resolved link repoints `voucher.evidencePacketId` and appends one
   * `EvidenceRelinked` event (WS-B B6b) — the relink is chain-visible, never a
   * silent read-model repoint. It touches no ReviewTask: a voucher's review
   * linkage survives an attach untouched. With no link resolved, only the
   * packet is created and NO event is appended.
   */
  composeEvidence(input: EvidenceComposeInput & ActorAttribution): Promise<EvidencePacket>;
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
   * Each accepted voucher also materializes an already-posted Voucher row
   * (`buildImportedVoucher` — `origin: "import"`, `status: "posted"`,
   * `evidencePacketId: null`) keyed by that same aggregate id, so migrated
   * history is attachable and displays its real series+number (KFR Phase D /
   * Task 1). No ReviewTask is created — the entry is already booked.
   * Bounds violations throw `SieImportError`.
   */
  importSie(input: SieImportInput): Promise<SieImportResult>;
  /**
   * Create a manual N-line journal entry (KFR Phase B / D2): a Voucher
   * (`origin: "manual"`, `evidencePacketId: null`) plus a ReviewTask
   * (`needs-review`) whose suggestion carries the verbatim lines. Approval
   * posts those lines unchanged — the review queue stays the only path to a
   * posted voucher, same invariant as every other posting route. Throws
   * `InvalidManualVoucherError` (→ HTTP 422) before any mutation when the
   * lines don't balance to the exact öre.
   *
   * Not idempotent by design (unlike `createEvidence`'s content dedupe): a
   * hand-typed entry carries no content hash to dedupe on, and two identical
   * entries are a legitimate double booking the reviewer may intend. Repeat
   * submissions are the caller's problem to gate.
   *
   * `actorId` is optional server-derived attribution (`ActorAttribution`) —
   * absent means "no authenticated subject" and the store resolves
   * `DEMO_ACTOR_ID`, exactly like `createEvidence`.
   */
  createManualVoucher(input: ManualVoucherInput & ActorAttribution): Promise<ManualVoucherResult>;
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
    input: ReviewDecisionInput & ActorAttribution & ApprovalGate,
  ): Promise<ReviewTask | undefined>;
  runSimulation(input: SimulationRequest & ActorAttribution): Promise<SimulationRun>;
  getCloseRun(): Promise<CloseRun>;
  refreshComplianceAlerts(): Promise<ComplianceAlert[]>;
  getCompanySettings(): Promise<CompanySettings | null>;
  putCompanySettings(input: CompanySettings): Promise<CompanySettings>;
}

const MEMORY_ALERT_CAP = 500;

const { organizationId: defaultOrganizationId, workspaceId: defaultWorkspaceId } = DEFAULT_TENANT_SCOPE;

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
  /** Frozen demo seed — never mutated; reports replay event payloads on top. */
  private readonly seedLines: LedgerLine[] = assertBalancedPosting(initialLedgerLines(), "demo seed lines");
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
  }

  private appendEvent(event: Omit<LedgerEvent, "id" | "eventHash" | "previousHash" | "digestDate">) {
    const previousHash = this.events.at(-1)?.eventHash ?? "GENESIS";
    const digestDate = new Date().toISOString().slice(0, 10);

    const fullEvent: LedgerEvent = {
      ...event,
      id: createId("evt"),
      previousHash,
      // SHA-256 over canonicalJson of (previousHash, payload) — pass the RAW
      // payload so append-time hashing and integrity re-verification share
      // the one canonical serializer (WS-B R14; parity with Postgres).
      eventHash: buildEventHash(previousHash, event.payload),
      digestDate,
    };

    this.events.push(fullEvent);
    return fullEvent;
  }

  async createEvidence(input: EvidenceCreateInput & ActorAttribution): Promise<EvidenceCreateResult> {
    return this.createEvidenceSync(input);
  }

  /**
   * Idempotent-create dedupe (WS-D R19): when an evidence row with the same
   * (workspace, sha256, sizeBytes) already exists, return the EXISTING row's
   * full create-context instead of creating a duplicate. A dedup hit appends
   * NOTHING — the hash chain stays clean. Map iteration is insertion-ordered,
   * so the FIRST (oldest) matching evidence wins deterministically. Falls
   * through to a genuine create when any context link is missing (defensive —
   * `createEvidence` always writes the full evidence→packet→voucher→review
   * chain, so a partial match means the row wasn't born here).
   */
  private findDuplicateEvidenceResult(input: EvidenceCreateInput): EvidenceCreateResult | undefined {
    if (input.sha256 === undefined || input.sizeBytes === undefined) return undefined;
    for (const candidate of this.evidence.values()) {
      if (!isDuplicateEvidence(candidate, input)) continue;
      const packetId = this.evidenceIdToPacketId.get(candidate.id);
      const packet = packetId !== undefined ? this.evidencePackets.get(packetId) : undefined;
      const voucherId = packetId !== undefined ? this.packetIdToVoucherId.get(packetId) : undefined;
      const voucher = voucherId !== undefined ? this.vouchers.get(voucherId) : undefined;
      const reviewId = voucherId !== undefined ? this.voucherIdToReviewId.get(voucherId) : undefined;
      const review = reviewId !== undefined ? this.reviews.get(reviewId) : undefined;
      if (!packet || !voucher || !review) continue;
      return { evidence: candidate, packet, voucher, review, voucherId: voucher.id, deduped: true };
    }
    return undefined;
  }

  private createEvidenceSync(input: EvidenceCreateInput & ActorAttribution): EvidenceCreateResult {
    const duplicate = this.findDuplicateEvidenceResult(input);
    if (duplicate) return duplicate;

    const plan = planEvidenceCreate(input, {
      voucherIndex: this.vouchers.size,
      organizationId: defaultOrganizationId,
      workspaceId: defaultWorkspaceId,
    });

    this.evidence.set(plan.evidence.id, plan.evidence);
    this.evidencePackets.set(plan.packet.id, plan.packet);
    this.vouchers.set(plan.voucher.id, plan.voucher);
    this.reviews.set(plan.review.id, plan.review);
    this.suggestions.set(plan.voucher.id, plan.suggestion);
    this.evidenceIdToPacketId.set(plan.evidence.id, plan.packet.id);
    this.packetIdToVoucherId.set(plan.packet.id, plan.voucher.id);
    this.voucherIdToReviewId.set(plan.voucher.id, plan.review.id);

    for (const event of plan.events) {
      this.appendEvent(event);
    }

    return {
      evidence: plan.evidence,
      packet: plan.packet,
      voucher: plan.voucher,
      review: plan.review,
      voucherId: plan.voucher.id,
    };
  }

  async composeEvidence(input: EvidenceComposeInput & ActorAttribution): Promise<EvidencePacket> {
    const actorId = input.actorId ?? DEMO_ACTOR_ID;
    // KFR Phase D / Task 2: validate the explicit target BEFORE anything is
    // written, so an unknown id leaves zero state behind (no packet row, no
    // event) rather than a dangling packet.
    if (input.targetVoucherId !== undefined && !this.vouchers.has(input.targetVoucherId)) {
      throw new VoucherNotFoundError(input.targetVoucherId);
    }

    const packet: EvidencePacket = {
      id: createId("packet"),
      evidenceIds: input.evidenceIds,
      note: input.note,
      voiceTranscript: input.voiceTranscript,
    };
    this.evidencePackets.set(packet.id, packet);

    // An explicit targetVoucherId overrides auto-detection entirely — this is
    // how a packet attaches to a voucher that never had one (imported vouchers
    // start with `evidencePacketId: null`, so there is no packet-history
    // breadcrumb for the auto-detect loop below to follow).
    let voucherIdToRelink = input.targetVoucherId;
    for (const eid of input.evidenceIds) {
      const previousPacketId = this.evidenceIdToPacketId.get(eid);
      if (previousPacketId && voucherIdToRelink === undefined) {
        const linkedVoucherId = this.packetIdToVoucherId.get(previousPacketId);
        if (linkedVoucherId) {
          voucherIdToRelink = linkedVoucherId;
        }
      }
      this.evidenceIdToPacketId.set(eid, packet.id);
    }

    if (voucherIdToRelink) {
      this.packetIdToVoucherId.set(packet.id, voucherIdToRelink);
      const voucher = this.vouchers.get(voucherIdToRelink);
      // `?? undefined` normalizes an imported voucher's NULL packet to an
      // absent payload key, keeping the event hash identical to Postgres
      // (canonicalJson drops undefined, jsonb never stores it).
      const previousPacketId = voucher?.evidencePacketId ?? undefined;
      if (voucher && voucher.evidencePacketId !== packet.id) {
        this.vouchers.set(voucherIdToRelink, { ...voucher, evidencePacketId: packet.id });
      }
      // WS-B B6b: a relink changes which evidence backs a voucher — that must
      // be visible in the audit chain, not a silent read-model repoint.
      this.appendEvent({
        organizationId: defaultOrganizationId,
        workspaceId: defaultWorkspaceId,
        aggregateType: "voucher",
        aggregateId: voucherIdToRelink,
        eventType: "EvidenceRelinked",
        actorId,
        occurredAt: nowIso(),
        payload: {
          voucherId: voucherIdToRelink,
          packetId: packet.id,
          previousPacketId,
          evidenceIds: [...input.evidenceIds],
        },
      });
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
    const reviewId = voucher ? this.voucherIdToReviewId.get(voucher.id) : undefined;
    const review = reviewId ? this.reviews.get(reviewId) : undefined;

    const plan = planExtractionRefresh(evidenceId, extraction, {
      evidence,
      ...(packet ? { packet } : {}),
      ...(voucher ? { voucher } : {}),
      ...(review ? { review } : {}),
    });

    if (plan.kind === "unchanged") {
      return plan.context;
    }

    // 5–6. Persist planned read-model updates (CONVENTIONS Rule 17).
    this.vouchers.set(plan.updatedVoucher.id, plan.updatedVoucher);
    if (plan.updatedReview) {
      this.reviews.set(plan.updatedReview.id, plan.updatedReview);
      this.suggestions.set(plan.updatedVoucher.id, plan.suggestion);
    }

    // 7. Append the planned hash-chained events (full snapshot payload, Rule 13).
    for (const event of plan.events) {
      this.appendEvent(event);
    }

    // 8. Fresh copies for the caller.
    return plan.context;
  }

  async importSie(input: SieImportInput): Promise<SieImportResult> {
    const { vouchers, skipped } = planSieImport(input.file);
    const result: SieImportResult = {
      accepted: true,
      importedVouchers: 0,
      importedTransactions: 0,
      skipped: [...skipped],
      // Non-fatal parse notes ride along so the caller can surface them (D3).
      warnings: summarizeSieWarnings(input.file.warnings),
    };

    // Idempotency: skip vouchers whose aggregate id was already imported.
    const alreadyImported = new Set(
      this.events.filter((event) => event.eventType === "VoucherImported").map((event) => event.aggregateId),
    );

    const occurredAt = nowIso();
    const actorId = input.actorId ?? DEMO_ACTOR_ID;
    for (const planned of vouchers) {
      if (alreadyImported.has(planned.aggregateId)) {
        result.skipped.push({ reference: planned.reference, reason: "duplicate" });
        continue;
      }

      this.appendEvent({
        organizationId: defaultOrganizationId,
        workspaceId: defaultWorkspaceId,
        aggregateType: "ledger",
        aggregateId: planned.aggregateId,
        eventType: "VoucherImported",
        actorId,
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

      // KFR Phase D / Task 1: materialize the already-posted Voucher row so
      // migrated history is attachable (Task 2) and displays its real
      // series+number (Task 5) instead of the raw `sie_*` aggregate id. The
      // `VoucherImported` event stays the source of truth — this row is a
      // projection-side record, never a second source.
      const voucher = buildImportedVoucher(planned, {
        organizationId: defaultOrganizationId,
        workspaceId: defaultWorkspaceId,
        actorId,
        createdAt: occurredAt,
      });
      this.vouchers.set(voucher.id, voucher);

      result.importedVouchers += 1;
      result.importedTransactions += planned.lines.length;
    }

    return result;
  }

  async createManualVoucher(input: ManualVoucherInput & ActorAttribution): Promise<ManualVoucherResult> {
    // `planManualVoucher` requires a resolved actor (it stamps `createdBy` and
    // both event `actorId`s); the sentinel fallback is the store's job, same
    // as `planEvidenceCreate` does internally for createEvidence.
    const plan = planManualVoucher(
      { ...input, actorId: input.actorId ?? DEMO_ACTOR_ID },
      {
        voucherIndex: this.vouchers.size,
        organizationId: defaultOrganizationId,
        workspaceId: defaultWorkspaceId,
      },
    );

    // The planner throws (öre gate) before returning, so nothing below runs on
    // a rejected entry — no read model, no event, no chain movement.
    this.vouchers.set(plan.voucher.id, plan.voucher);
    this.reviews.set(plan.review.id, plan.review);
    // A manual plan's review ALWAYS carries the verbatim-line suggestion
    // (planManualVoucher builds it unconditionally); assert rather than
    // silently skip the suggestions index, which approval reads back.
    const suggestion = plan.review.suggestion;
    if (!suggestion) {
      throw new Error(`Manual voucher plan for ${plan.voucher.id} produced no suggestion (invariant violation).`);
    }
    this.suggestions.set(plan.voucher.id, suggestion);
    this.voucherIdToReviewId.set(plan.voucher.id, plan.review.id);

    for (const event of plan.events) {
      this.appendEvent(event);
    }

    return { voucherId: plan.voucher.id, reviewId: plan.review.id };
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

  /**
   * Demo seed + event-payload replay. Postgres has the same private name but
   * omits seed — keep that asymmetry intentional (no PG demo seed).
   */
  private collectLedgerLines(): LedgerLine[] {
    return [...this.seedLines, ...collectLedgerLinesFromEvents(this.events)];
  }

  async getReports(range?: ReportRange): Promise<ReportBundle> {
    const lines = filterLedgerLines(this.collectLedgerLines(), range);
    return {
      journal: buildJournal(lines),
      balances: buildBalances(lines),
      vat: buildVat(lines),
    };
  }

  async getReportPack(input: { period: string }): Promise<ReportPack> {
    const settings = await this.getCompanySettings();
    const lines = this.collectLedgerLines();
    return buildReportPack(lines, {
      periodToken: input.period,
      fiscalYearStart: settings?.profile.fiscalYearStart ?? "01-01",
      ...(settings?.profile.firstFiscalYearStart !== undefined
        ? { firstFiscalYearStart: settings.profile.firstFiscalYearStart }
        : {}),
    });
  }

  async getSnapshot(): Promise<WorkspaceSnapshot> {
    // Defensive array copies (Rule 17): internal collections are mutated in place —
    // callers must not share mutable refs with the store (§A N8).
    // assistantExamples retired (P2-6 / F-7); staged empty for wire compat.
    return {
      evidence: [...this.evidence.values()],
      vouchers: [...this.vouchers.values()],
      reviews: await this.getReviewFeed(),
      reports: await this.getReports(),
      assistantExamples: [],
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

    // KFR D2: a manual voucher's suggestion IS the reviewer's verbatim lines —
    // there is nothing to re-derive from extracted fields, and regenerating
    // would drop `suggestion.lines` and turn the next approval into a
    // "no verbatim lines" invariant 500. Return what was authored, unchanged.
    if (voucher.origin === "manual") return this.suggestions.get(voucherId);

    const ruleHits = evaluateVoucherRules(voucher);
    const suggestion = buildDeterministicSuggestion(voucher, ruleHits);
    this.suggestions.set(voucherId, suggestion);
    // Store parity (WS-B B7b): persist the regenerated suggestion onto the
    // review read model exactly like PostgresLedgerStore — but only while the
    // review is still open. A decided review's suggestion records what was
    // actually posted and must never be clobbered by a later regeneration.
    const reviewId = this.voucherIdToReviewId.get(voucherId);
    const review = reviewId ? this.reviews.get(reviewId) : undefined;
    if (review && review.status === "needs-review") {
      // Clone-before-mutate (Rule 17): the review may be shared via getSnapshot.
      this.reviews.set(review.id, { ...review, suggestion });
    }
    return suggestion;
  }

  async applyReviewDecision(
    reviewId: string,
    action: ReviewAction,
    input: ReviewDecisionInput & ActorAttribution & ApprovalGate,
  ): Promise<ReviewTask | undefined> {
    const review = this.reviews.get(reviewId);
    if (!review) return undefined;

    const voucher = this.vouchers.get(review.voucherId);
    if (!voucher) return undefined;

    const plan = planReviewDecision(review, voucher, action, input);
    if (plan.kind === "replay") return plan.review;

    // Clone-before-mutate (Rule 17): review/voucher may have been returned by
    // getSnapshot() — replace read models instead of mutating shared objects.
    if (plan.postingSuggestion && input.edited && action !== "reject") {
      this.suggestions.set(voucher.id, plan.postingSuggestion);
    }
    this.reviews.set(reviewId, plan.updatedReview);
    this.vouchers.set(voucher.id, plan.updatedVoucher);

    // Honest decision vocabulary (WS-B B6a) + PostedToLedger lines for replay
    // truth — planners emit the same event sequence both stores persist.
    // Journal lines come from event-payload replay in getReports/getReportPack.
    for (const event of plan.events) {
      this.appendEvent(event);
    }

    return { ...plan.updatedReview };
  }

  async runSimulation(input: SimulationRequest & ActorAttribution): Promise<SimulationRun> {
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
      actorId: input.actorId ?? DEMO_ACTOR_ID,
      occurredAt: nowIso(),
      payload: result,
    });

    return result;
  }

  async refreshComplianceAlerts(): Promise<ComplianceAlert[]> {
    const detected = detectComplianceIssues([...this.reviews.values()], [...this.vouchers.values()], today());
    const detectedById = new Map(detected.map((a) => [a.id, a]));

    // Shared resolveIds computation with PostgresLedgerStore (planComplianceMerge).
    const existingAutoOpen = this.alerts
      .filter((alert) => alert.status === "open" && AUTO_DETECTED_ALERT_KINDS.has(alert.kind))
      .map((alert) => ({ id: alert.id }));
    const { resolveIds } = planComplianceMerge(existingAutoOpen, detected);
    const toResolve = new Set(resolveIds);

    // Immutable single-pass rebuild (CONVENTIONS Rules 17, 24): clone before
    // mutating so prior snapshot consumers don't observe spooky state flips.
    // Auto-detected alerts can transition open<->resolved; user states
    // (acknowledged, dismissed) and seeded non-auto kinds pass through unchanged.
    // Memory-only extras beyond planComplianceMerge: reopen resolved auto alerts
    // that are still detected, and the MEMORY_ALERT_CAP trim (PG has no in-memory cap).
    const rebuilt: ComplianceAlert[] = this.alerts.map((alert) => {
      if (!AUTO_DETECTED_ALERT_KINDS.has(alert.kind)) return { ...alert };
      const stillDetected = detectedById.has(alert.id);
      if (alert.status === "open" && toResolve.has(alert.id)) return { ...alert, status: "resolved" };
      if (alert.status === "resolved" && stillDetected) return { ...alert, status: "open" };
      return { ...alert };
    });

    const existingIds = new Set(rebuilt.map((a) => a.id));
    for (const alert of detected) {
      if (!existingIds.has(alert.id)) rebuilt.push({ ...alert });
    }

    // Bound accumulation (Rule 25): cap auto-detected entries; seeded alerts pinned.
    const seeded = rebuilt.filter((a) => !AUTO_DETECTED_ALERT_KINDS.has(a.kind));
    const auto = rebuilt.filter((a) => AUTO_DETECTED_ALERT_KINDS.has(a.kind));
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
