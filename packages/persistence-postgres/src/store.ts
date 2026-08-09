import type {
  AccountingMethod,
  AccountingSuggestion,
  AttachReviewEnrichmentIntentInput,
  CloseRun,
  CompanySettings,
  ComplianceAlert,
  EvidenceComposeInput,
  EvidenceContext,
  EvidenceCreateInput,
  EvidenceCreateResult,
  EvidenceModality,
  EvidenceObject,
  EvidencePacket,
  EnrichmentWorkItem,
  ExternalReferenceProjection,
  ExtractedField,
  ExtractionResult,
  LedgerEvent,
  ProposeEnrichmentWorkItemInput,
  ProjectProjection,
  RegisterProjectInput,
  ReportBundle,
  ReportPack,
  ReviewEnrichmentIntent,
  ReviewDecisionInput,
  ReviewTask,
  SieImportResult,
  SimulationRequest,
  SimulationRun,
  Voucher,
  WorkspaceSnapshot,
} from "@jpx-accounting/contracts";
import { companySettingsSchema } from "@jpx-accounting/contracts";

import {
  AUTO_DETECTED_ALERT_KINDS,
  assertEnrichmentTargetPosted,
  assertPrePostEnrichmentIntentSupported,
  buildBalances,
  buildDeterministicSuggestion,
  buildEventHash,
  buildExternalReferencesFromEvents,
  buildVoucherTagsFromEvents,
  buildJournal,
  buildProjectRegistryFromEvents,
  buildReportPack,
  buildVat,
  collectLedgerLinesFromEvents,
  collectPostedEnrichmentTargets,
  createId,
  currentMonthToken,
  DEMO_ACTOR_ID,
  detectComplianceIssues,
  EnrichmentIntentClosedError,
  evaluateVoucherRules,
  ExternalReferenceNotFoundError,
  filterLedgerLines,
  findActiveExternalReference,
  LINE_CARRYING_EVENT_TYPES,
  nowIso,
  planComplianceMerge,
  planEvidenceCreate,
  planExternalReferenceLink,
  planExternalReferenceRemoval,
  planExtractionRefresh,
  mergePrePostEnrichmentsIntoReviewDecisionPlan,
  planPrePostEnrichment,
  planPostPostEnrichmentConfirm,
  planReviewDecision,
  planVoucherTagsAppend,
  simulateApprovals,
  today,
  type ActorAttribution,
  type ApprovalGate,
  type ExternalReferenceEvent,
  type LedgerLine,
  type LineEnrichmentEvent,
  type ReviewAction,
  type TagDefinition,
  type VoucherTagEvent,
  type VoucherTagsProjection,
} from "@jpx-accounting/domain";
import {
  isDuplicateEvidence,
  EnrichmentWorkItemConflictError,
  EnrichmentWorkItemNotFoundError,
  planSieImport,
  ReviewNotFoundError,
  type LedgerStore,
  type ReportRange,
  type SieImportInput,
} from "@jpx-accounting/domain/store";

import type { PostgresClient } from "./client";

// ---------------------------------------------------------------------------
// Local helper types
// ---------------------------------------------------------------------------

// The transaction handle exposed by `postgres-js` inside `sql.begin(async tx => …)`.
// We type it loosely as the same surface as the top-level client so all tagged-template
// helpers (`tx<…>\`SELECT …\``, `tx.array`, `tx.json`) work without further plumbing.
type Tx = PostgresClient;

// `aggregateType` is restricted in the domain schema; capture the union once so
// we can construct events without sprinkling string casts everywhere.
type AggregateType = LedgerEvent["aggregateType"];
type EventTypeName = LedgerEvent["eventType"];

type EventInput = {
  organizationId: string;
  workspaceId: string;
  aggregateType: AggregateType;
  aggregateId: string;
  eventType: EventTypeName;
  actorId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
};

// `buildExtractedFields`, `guessSupplier`, `guessAccountingMethod`, and
// `buildPostingLines` are imported from `@jpx-accounting/domain` so posting
// helpers stay in lockstep with MemoryLedgerStore. Demo seed lines
// (`initialLedgerLines`) stay Memory-only — Postgres replays event payloads.

// ---------------------------------------------------------------------------
// Hash-chain fork guard (WS-B R15)
// ---------------------------------------------------------------------------

/** Migration 0006's UNIQUE (organization_id, workspace_id, previous_hash). */
const CHAIN_FORK_CONSTRAINT = "ledger_events_chain_fork_key";

/**
 * Raised when a workspace's hash chain forked twice in a row: the appending
 * transaction lost the (org, workspace, previous_hash) unique race even after
 * one full internal retry against a freshly re-read tail. Reaching this means
 * some writer is appending WITHOUT the per-workspace advisory lock (every
 * chain append in this store takes it first) — the constraint turned what
 * used to be silent chain corruption into a loud, retryable conflict.
 *
 * Error-vocabulary note: services/api deliberately detects Postgres failures
 * structurally (`name === "PostgresError"` + SQLSTATE `code`, WS-A5 — it
 * never imports a driver), and W1 mapped 23505 → HTTP 409 `conflict` in
 * `app.onError`. This class presents that same structural face on purpose so
 * an exhausted chain-fork retry surfaces to clients as the retryable 409 the
 * vocabulary already defines, not an opaque 500 — while staying a distinct,
 * `instanceof`-testable type carrying the underlying driver error as `cause`.
 */
export class HashChainForkError extends Error {
  override readonly name = "PostgresError";
  readonly code = "23505";
  readonly constraint_name = CHAIN_FORK_CONSTRAINT;
  readonly retryable = true;

  constructor(scope: { organizationId: string; workspaceId: string }, cause: unknown) {
    super(
      `Hash-chain fork detected for workspace ${scope.organizationId}/${scope.workspaceId}: ` +
        `another writer appended concurrently and the retry lost the race again. ` +
        `The ledger chain is intact (the fork was rejected); retry the request.`,
      { cause },
    );
  }
}

/**
 * True when `error` is the driver-level unique violation raised by
 * `ledger_events_chain_fork_key` — the ONLY 23505 that means "chain fork".
 * Other unique violations (voucher numbers, alert dedup, …) must keep their
 * own semantics and are never retried here.
 */
function isChainForkViolation(error: unknown): boolean {
  if (!(error instanceof Error) || error.name !== "PostgresError") return false;
  const { code, constraint_name } = error as Error & { code?: unknown; constraint_name?: unknown };
  return code === "23505" && constraint_name === CHAIN_FORK_CONSTRAINT;
}

// ---------------------------------------------------------------------------
// Row → domain mapping helpers
// ---------------------------------------------------------------------------

type EvidenceRow = {
  id: string;
  organization_id: string;
  workspace_id: string;
  title: string;
  created_by: string;
  created_at: Date | string;
  original_filename: string;
  mime_type: string;
  blob_path: string;
  hash: string;
  trust_level: string;
  metadata: { sizeBytes?: number } | null;
  modalities: string[];
};

type PacketRow = {
  id: string;
  organization_id: string;
  workspace_id: string;
  note: string | null;
  voice_transcript: string | null;
  created_at: Date | string;
};

type VoucherRow = {
  id: string;
  organization_id: string;
  workspace_id: string;
  evidence_packet_id: string;
  voucher_number: string;
  accounting_method: string;
  status: string;
  voucher_fields: Voucher["voucherFields"];
  extracted_fields: ExtractedField[];
  created_by: string;
  created_at: Date | string;
};

type ReviewRow = {
  id: string;
  organization_id: string;
  workspace_id: string;
  voucher_id: string;
  status: string;
  blocked_reason: string | null;
  suggested_action: string;
  suggestion: AccountingSuggestion | null;
  provenance_timeline: ReviewTask["provenanceTimeline"];
  title: string;
  created_at: Date | string;
};

type EventRow = {
  id: string;
  organization_id: string;
  workspace_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  actor_id: string;
  occurred_at: Date | string;
  payload: Record<string, unknown>;
  previous_hash: string;
  event_hash: string;
  digest_date: Date | string;
  created_at: Date | string;
};

type EnrichmentWorkItemRow = {
  id: string;
  organization_id: string;
  workspace_id: string;
  target_kind: string;
  target_id: string;
  proposed_change: EnrichmentWorkItem["proposedChange"];
  status: string;
  source: string;
  idempotency_key: string;
  created_at: Date | string;
  created_by: string;
  confirmed_at: Date | string | null;
  confirmed_by: string | null;
  resulting_event_ids: string[] | null;
  superseded_by_work_item_id: string | null;
};

type ReviewEnrichmentIntentRow = {
  review_id: string;
  voucher_id: string;
  proposals: ReviewEnrichmentIntent["proposals"];
  updated_at: Date | string;
  updated_by: string;
};

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toDateOnlyIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  // Postgres returns DATE columns as 'YYYY-MM-DD' strings already.
  return value.length >= 10 ? value.slice(0, 10) : value;
}

function rowToEvidence(row: EvidenceRow): EvidenceObject {
  const evidence: EvidenceObject = {
    id: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    createdAt: toIso(row.created_at),
    createdBy: row.created_by,
    title: row.title,
    modalities: row.modalities as EvidenceModality[],
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    blobPath: row.blob_path,
    hash: row.hash,
    trustLevel: row.trust_level as EvidenceObject["trustLevel"],
  };
  if (typeof row.metadata?.sizeBytes === "number") evidence.sizeBytes = row.metadata.sizeBytes;
  return evidence;
}

function rowToPacket(row: PacketRow, evidenceIds: string[]): EvidencePacket {
  // Pin the exact EvidencePacket shape (§A N10): optional keys are always present,
  // matching MemoryLedgerStore.composeEvidence even when values are undefined.
  return {
    id: row.id,
    evidenceIds,
    note: row.note ?? undefined,
    voiceTranscript: row.voice_transcript ?? undefined,
  };
}

function rowToVoucher(row: VoucherRow): Voucher {
  return {
    id: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    evidencePacketId: row.evidence_packet_id,
    voucherNumber: row.voucher_number,
    status: row.status as Voucher["status"],
    accountingMethod: row.accounting_method as AccountingMethod,
    extractedFields: row.extracted_fields,
    voucherFields: row.voucher_fields,
    createdAt: toIso(row.created_at),
    createdBy: row.created_by,
  };
}

function rowToReview(row: ReviewRow): ReviewTask {
  const review: ReviewTask = {
    id: row.id,
    voucherId: row.voucher_id,
    title: row.title,
    status: row.status as ReviewTask["status"],
    suggestedAction: row.suggested_action,
    provenanceTimeline: row.provenance_timeline,
  };
  if (row.blocked_reason !== null) review.blockedReason = row.blocked_reason;
  if (row.suggestion !== null) review.suggestion = row.suggestion;
  return review;
}

function rowToEvent(row: EventRow): LedgerEvent {
  return {
    id: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    aggregateType: row.aggregate_type as AggregateType,
    aggregateId: row.aggregate_id,
    eventType: row.event_type as EventTypeName,
    actorId: row.actor_id,
    occurredAt: toIso(row.occurred_at),
    payload: row.payload,
    previousHash: row.previous_hash,
    eventHash: row.event_hash,
    digestDate: toDateOnlyIso(row.digest_date),
  };
}

function rowToEnrichmentWorkItem(row: EnrichmentWorkItemRow): EnrichmentWorkItem {
  const workItem: EnrichmentWorkItem = {
    id: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    targetKind: row.target_kind as EnrichmentWorkItem["targetKind"],
    targetId: row.target_id,
    proposedChange: row.proposed_change,
    status: row.status as EnrichmentWorkItem["status"],
    source: row.source as EnrichmentWorkItem["source"],
    idempotencyKey: row.idempotency_key,
    createdAt: toIso(row.created_at),
    createdBy: row.created_by,
  };
  if (row.confirmed_at !== null) workItem.confirmedAt = toIso(row.confirmed_at);
  if (row.confirmed_by !== null) workItem.confirmedBy = row.confirmed_by;
  if (row.resulting_event_ids !== null) workItem.resultingEventIds = row.resulting_event_ids;
  if (row.superseded_by_work_item_id !== null) {
    workItem.supersededByWorkItemId = row.superseded_by_work_item_id;
  }
  return workItem;
}

function rowToReviewEnrichmentIntent(row: ReviewEnrichmentIntentRow): ReviewEnrichmentIntent {
  return {
    reviewId: row.review_id,
    voucherId: row.voucher_id,
    proposals: structuredClone(row.proposals),
    updatedAt: toIso(row.updated_at),
    updatedBy: row.updated_by,
  };
}

type PostedEnrichmentTargetRow = {
  id: string;
  aggregate_id: string;
  event_type: LedgerEvent["eventType"];
  payload: Record<string, unknown>;
};

async function loadPostedEnrichmentTargets(
  runner: PostgresClient,
  scope: { organizationId: string; workspaceId: string },
) {
  const rows = await runner<PostedEnrichmentTargetRow[]>`
    SELECT id, aggregate_id, event_type, payload
    FROM ledger.events
    WHERE organization_id = ${scope.organizationId}
      AND workspace_id = ${scope.workspaceId}
      AND event_type IN ('PostedToLedger', 'VoucherImported')
    ORDER BY seq ASC
  `;
  return collectPostedEnrichmentTargets(
    rows.map((row) => ({
      id: row.id,
      aggregateId: row.aggregate_id,
      eventType: row.event_type,
      payload: row.payload,
    })),
  );
}

async function loadExternalReferenceEvents(
  runner: PostgresClient,
  scope: { organizationId: string; workspaceId: string },
  voucherId: string,
): Promise<ExternalReferenceEvent[]> {
  const rows = await runner<EventRow[]>`
    SELECT id, organization_id, workspace_id, aggregate_type, aggregate_id, event_type,
           actor_id, occurred_at, payload, previous_hash, event_hash, digest_date, created_at
    FROM ledger.events
    WHERE organization_id = ${scope.organizationId}
      AND workspace_id = ${scope.workspaceId}
      AND aggregate_id = ${voucherId}
      AND event_type IN ('ExternalReferenceLinked', 'ExternalReferenceRemoved')
    ORDER BY seq ASC
  `;
  return rows.map(rowToEvent);
}

async function loadVoucherTagEvents(
  runner: PostgresClient,
  scope: { organizationId: string; workspaceId: string },
  voucherId: string,
): Promise<VoucherTagEvent[]> {
  const rows = await runner<EventRow[]>`
    SELECT id, organization_id, workspace_id, aggregate_type, aggregate_id, event_type,
           actor_id, occurred_at, payload, previous_hash, event_hash, digest_date, created_at
    FROM ledger.events
    WHERE organization_id = ${scope.organizationId}
      AND workspace_id = ${scope.workspaceId}
      AND aggregate_id = ${voucherId}
      AND event_type IN ('VoucherTagsAdded', 'VoucherTagsRemoved')
    ORDER BY seq ASC
  `;
  return rows.map(rowToEvent);
}

async function loadLineEnrichmentEvents(
  runner: PostgresClient,
  scope: { organizationId: string; workspaceId: string },
  lineId: string,
): Promise<LineEnrichmentEvent[]> {
  const rows = await runner<EventRow[]>`
    SELECT id, organization_id, workspace_id, aggregate_type, aggregate_id, event_type,
           actor_id, occurred_at, payload, previous_hash, event_hash, digest_date, created_at
    FROM ledger.events
    WHERE organization_id = ${scope.organizationId}
      AND workspace_id = ${scope.workspaceId}
      AND aggregate_id = ${lineId}
      AND event_type IN ('LineEnrichmentRecorded', 'LineEnrichmentSuperseded')
    ORDER BY seq ASC
  `;
  return rows.map(rowToEvent);
}

async function loadTagDefinitions(
  runner: PostgresClient,
  scope: { organizationId: string; workspaceId: string },
): Promise<TagDefinition[]> {
  return runner<TagDefinition[]>`
    SELECT id, name, color
    FROM ledger.tag_definitions
    WHERE organization_id = ${scope.organizationId}
      AND workspace_id = ${scope.workspaceId}
    ORDER BY id ASC
  `;
}

type ComplianceAlertRow = {
  id: string;
  title: string;
  source: string;
  detected_at: string;
  impact_summary: string;
  kind: string;
  severity: string;
  status: string;
  target_id: string | null;
  body: string | null;
};

function rowToComplianceAlert(row: ComplianceAlertRow): ComplianceAlert {
  return {
    id: row.id,
    title: row.title,
    source: row.source,
    detectedAt: row.detected_at,
    impactSummary: row.impact_summary,
    kind: row.kind,
    severity: row.severity as ComplianceAlert["severity"],
    status: row.status as ComplianceAlert["status"],
    targetId: row.target_id ?? undefined,
    body: row.body ?? undefined,
  };
}

type PacketWithEvidenceIds = PacketRow & { evidence_object_ids: string[] };

type ResolvedPacketVoucher = {
  packet?: EvidencePacket;
  voucher?: Voucher;
};

/**
 * Shared evidence→packet→voucher join (§A N11). Accepts the top-level client or
 * a transaction handle from `begin()` — both expose the same tagged-template API.
 * Picks the newest packet containing the evidence (`ORDER BY created_at DESC`).
 */
async function resolvePacketAndVoucher(
  runner: PostgresClient,
  scope: { organizationId: string; workspaceId: string },
  evidenceId: string,
): Promise<ResolvedPacketVoucher> {
  const packetRows = await runner<PacketWithEvidenceIds[]>`
    SELECT p.id, p.organization_id, p.workspace_id, p.note, p.voice_transcript, p.created_at,
           COALESCE(
             (SELECT array_agg(i2.evidence_object_id ORDER BY i2.evidence_object_id)
              FROM ledger.evidence_packet_items i2
              WHERE i2.evidence_packet_id = p.id),
             '{}'::text[]
           ) AS evidence_object_ids
    FROM ledger.evidence_packets p
    JOIN ledger.evidence_packet_items i ON i.evidence_packet_id = p.id
    WHERE i.evidence_object_id = ${evidenceId}
      AND p.organization_id = ${scope.organizationId}
      AND p.workspace_id = ${scope.workspaceId}
    ORDER BY p.created_at DESC
    LIMIT 1
  `;
  const packetRow = packetRows[0];
  if (!packetRow) return {};

  const packet = rowToPacket(packetRow, packetRow.evidence_object_ids);

  const voucherRows = await runner<VoucherRow[]>`
    SELECT id, organization_id, workspace_id, evidence_packet_id, voucher_number,
           accounting_method, status, voucher_fields, extracted_fields, created_by, created_at
    FROM ledger.vouchers
    WHERE evidence_packet_id = ${packetRow.id}
      AND organization_id = ${scope.organizationId}
      AND workspace_id = ${scope.workspaceId}
    LIMIT 1
  `;
  const voucher = voucherRows[0] ? rowToVoucher(voucherRows[0]) : undefined;

  const result: ResolvedPacketVoucher = { packet };
  if (voucher) result.voucher = voucher;
  return result;
}

// ---------------------------------------------------------------------------
// PostgresLedgerStore
// ---------------------------------------------------------------------------

export class PostgresLedgerStore implements LedgerStore {
  private readonly client: PostgresClient;
  private readonly defaults: { organizationId: string; workspaceId: string };

  constructor(client: PostgresClient, defaults: { organizationId: string; workspaceId: string }) {
    this.client = client;
    this.defaults = defaults;
  }

  // ---------------- internal helpers ----------------

  /**
   * Serialize the workspace's hash chain, then read the current tail hash.
   * Mirrors `MemoryLedgerStore`'s `events.at(-1)?.eventHash ?? "GENESIS"`
   * (which is fork-safe by construction: its tail read and push happen
   * synchronously with no await between them).
   *
   * MUST be the FIRST statement of every transaction that appends chain
   * events (WS-B R15): `pg_advisory_xact_lock` on the workspace key blocks
   * until any concurrent appender COMMITS/aborts, and only then is the tail
   * read — so the tail is always fresh. This replaces the old
   * `SELECT … FOR UPDATE` tail-row lock, which is dropped as redundant AND
   * insufficient: a waiter blocked on FOR UPDATE resumed with its original
   * snapshot (EvalPlanQual rechecks the locked row, it does not re-run the
   * query), so it chained onto a STALE tail; and at GENESIS there was no row
   * to lock at all, so two first-appenders raced freely. With the advisory
   * lock serializing every store appender and migration 0006's UNIQUE
   * (org, workspace, previous_hash) rejecting any out-of-band fork, the row
   * lock adds nothing. Taking the lock before ALL reads also serializes the
   * voucher-number COUNT(*) in createEvidence as a side benefit.
   *
   * `hashtextextended` (64-bit) is used over 32-bit `hashtext` to make
   * cross-workspace advisory-key collisions (harmless but serializing)
   * negligible. Collisions never affect correctness, only concurrency.
   */
  private async lockWorkspaceTail(tx: Tx): Promise<string> {
    await tx`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`${this.defaults.organizationId}/${this.defaults.workspaceId}`}, 0)
      )
    `;
    // seq-PRIMARY, not occurred_at: seq is the true append order. Keying the
    // tail on wall-clock occurred_at wedges the workspace permanently after a
    // single clock inversion (NTP step-back between appends): the pick returns
    // the wrong "newest" event, the fork constraint 23505s, and the one retry
    // re-picks the same wrong tail forever.
    const rows = await tx<{ event_hash: string }[]>`
      SELECT event_hash
      FROM ledger.events
      WHERE organization_id = ${this.defaults.organizationId}
        AND workspace_id = ${this.defaults.workspaceId}
      ORDER BY seq DESC
      LIMIT 1
    `;
    return rows[0]?.event_hash ?? "GENESIS";
  }

  /**
   * Run one chain-appending transaction; if it dies on the chain-fork unique
   * constraint (23505 on `ledger_events_chain_fork_key`), re-run it ONCE —
   * the retry re-enters `lockWorkspaceTail`, re-reads the now-fresh tail and
   * re-derives every id/hash, so a transient out-of-band append is absorbed
   * invisibly. A second fork means a writer is persistently bypassing the
   * advisory lock → surface the typed retryable error (→ HTTP 409 via the
   * existing W1 23505 mapping in services/api). Every `run` closure must be
   * re-entrant: it derives all state inside the transaction (they all do —
   * ids, hashes and read models are computed after `lockWorkspaceTail`).
   */
  private async withChainForkRetry<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (!isChainForkViolation(error)) throw error;
      try {
        return await run();
      } catch (retryError) {
        if (!isChainForkViolation(retryError)) throw retryError;
        throw new HashChainForkError(this.defaults, retryError);
      }
    }
  }

  /**
   * Insert one event into ledger.events using `previousHash` as the chain
   * predecessor and return the freshly-built `LedgerEvent` (including its new
   * `eventHash`) so the caller can chain it forward as the next predecessor.
   */
  private async appendEvent(tx: Tx, event: EventInput, previousHash: string): Promise<LedgerEvent> {
    // SHA-256 over canonicalJson of (previousHash, payload) — pass the RAW
    // payload so the hash survives the jsonb round trip and re-verification
    // recomputes the identical bytes (WS-B R14; parity with MemoryLedgerStore
    // — both stores MUST keep importing buildEventHash from domain).
    const eventHash = buildEventHash(previousHash, event.payload);
    const digestDate = new Date().toISOString().slice(0, 10);
    const id = createId("evt");

    await tx`
      INSERT INTO ledger.events (
        id,
        organization_id,
        workspace_id,
        aggregate_type,
        aggregate_id,
        event_type,
        actor_id,
        occurred_at,
        payload,
        previous_hash,
        event_hash,
        digest_date
      ) VALUES (
        ${id},
        ${event.organizationId},
        ${event.workspaceId},
        ${event.aggregateType},
        ${event.aggregateId},
        ${event.eventType},
        ${event.actorId},
        ${event.occurredAt},
        ${tx.json(event.payload as Parameters<typeof tx.json>[0])},
        ${previousHash},
        ${eventHash},
        ${digestDate}
      )
    `;

    return {
      id,
      organizationId: event.organizationId,
      workspaceId: event.workspaceId,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      actorId: event.actorId,
      occurredAt: event.occurredAt,
      payload: event.payload,
      previousHash,
      eventHash,
      digestDate,
    };
  }

  // ---------------- readiness ----------------

  /**
   * Readiness probe (WS-A5): a trivial round-trip proving the connection pool
   * can reach Postgres. Not part of the `LedgerStore` interface — the API's
   * /ready check discovers it structurally.
   */
  async ping(): Promise<void> {
    await this.client`SELECT 1`;
  }

  // ---------------- LedgerStore API ----------------

  /**
   * Idempotent-create dedupe (WS-D R19): find an EXISTING evidence row with the
   * identical (workspace, sha256, sizeBytes) tuple and rebuild its full
   * create-context. Must run INSIDE the chain transaction AFTER
   * `lockWorkspaceTail` — the advisory lock serializes concurrent
   * `createEvidence` calls, so the second racer always sees the first's
   * committed row (a pre-transaction check would let both miss and duplicate).
   * The shared `isDuplicateEvidence` predicate keeps the match semantics
   * byte-identical with MemoryLedgerStore (CONVENTIONS Rule 11); rows whose
   * packet/voucher/review links can't be resolved fall through to a genuine
   * create, mirroring the memory store's defensive behavior. The lookup is
   * indexed by migration 0008 (`organization_id, workspace_id, hash`).
   */
  private async findDuplicateEvidence(tx: Tx, input: EvidenceCreateInput): Promise<EvidenceCreateResult | undefined> {
    if (input.sha256 === undefined || input.sizeBytes === undefined) return undefined;
    const scope = { organizationId: this.defaults.organizationId, workspaceId: this.defaults.workspaceId };

    const rows = await tx<EvidenceRow[]>`
      SELECT id, organization_id, workspace_id, title, created_by, created_at,
             original_filename, mime_type, blob_path, hash, trust_level, metadata, modalities
      FROM ledger.evidence_objects
      WHERE organization_id = ${scope.organizationId}
        AND workspace_id = ${scope.workspaceId}
        AND hash = ${input.sha256}
      ORDER BY created_at ASC, id ASC
    `;

    for (const row of rows) {
      const evidence = rowToEvidence(row);
      // Re-check the full tuple (sizeBytes lives in metadata, not the WHERE clause).
      if (!isDuplicateEvidence(evidence, input)) continue;

      const { packet, voucher } = await resolvePacketAndVoucher(tx, scope, evidence.id);
      if (!packet || !voucher) continue;

      const reviewRows = await tx<ReviewRow[]>`
        SELECT id, organization_id, workspace_id, voucher_id, status, blocked_reason,
               suggested_action, suggestion, provenance_timeline, title, created_at
        FROM ledger.review_tasks
        WHERE voucher_id = ${voucher.id}
          AND organization_id = ${scope.organizationId}
          AND workspace_id = ${scope.workspaceId}
        LIMIT 1
      `;
      const review = reviewRows[0] ? rowToReview(reviewRows[0]) : undefined;
      if (!review) continue;

      return { evidence, packet, voucher, review, voucherId: voucher.id, deduped: true };
    }
    return undefined;
  }

  async createEvidence(input: EvidenceCreateInput & ActorAttribution): Promise<EvidenceCreateResult> {
    // Server-derived attribution or the demo sentinel — never a client value
    // (R5; parity with MemoryLedgerStore, Rule 11).
    return this.withChainForkRetry(() =>
      this.client.begin(async (tx) => {
        const tailHash = await this.lockWorkspaceTail(tx);

        // Dedup hit: return the existing context and append NOTHING — no rows,
        // no chain events; the transaction commits empty (WS-D R19).
        const duplicate = await this.findDuplicateEvidence(tx, input);
        if (duplicate) return duplicate;

        // Voucher number sequencing: COUNT(*) inside the workspace, just like
        // MemoryLedgerStore which uses `this.vouchers.size + 1001`. Planner is
        // called INSIDE the retry closure so fork retries re-derive ids.
        const voucherCountRows = await tx<{ count: string }[]>`
        SELECT COUNT(*)::text AS count
        FROM ledger.vouchers
        WHERE organization_id = ${this.defaults.organizationId}
          AND workspace_id = ${this.defaults.workspaceId}
      `;
        const voucherCount = Number(voucherCountRows[0]?.count ?? "0");
        const plan = planEvidenceCreate(input, {
          voucherIndex: voucherCount,
          organizationId: this.defaults.organizationId,
          workspaceId: this.defaults.workspaceId,
        });
        const { evidence, packet, voucher, review, suggestion } = plan;

        // Evidence-level upload provenance lives in the existing metadata jsonb —
        // no schema change (Phase 3 plan, finding 2).
        const metadata: { sizeBytes?: number } = {};
        if (input.sizeBytes !== undefined) metadata.sizeBytes = input.sizeBytes;

        await tx`
        INSERT INTO ledger.evidence_objects (
          id,
          organization_id,
          workspace_id,
          title,
          created_by,
          created_at,
          original_filename,
          mime_type,
          blob_path,
          hash,
          trust_level,
          metadata,
          modalities
        ) VALUES (
          ${evidence.id},
          ${evidence.organizationId},
          ${evidence.workspaceId},
          ${evidence.title},
          ${evidence.createdBy},
          ${evidence.createdAt},
          ${evidence.originalFilename},
          ${evidence.mimeType},
          ${evidence.blobPath},
          ${evidence.hash},
          ${evidence.trustLevel},
          ${tx.json(metadata)},
          ${tx.array(evidence.modalities as unknown as string[])}
        )
      `;

        await tx`
        INSERT INTO ledger.evidence_packets (
          id,
          organization_id,
          workspace_id,
          note,
          voice_transcript,
          created_at
        ) VALUES (
          ${packet.id},
          ${this.defaults.organizationId},
          ${this.defaults.workspaceId},
          ${packet.note ?? null},
          ${packet.voiceTranscript ?? null},
          ${evidence.createdAt}
        )
      `;

        await tx`
        INSERT INTO ledger.evidence_packet_items (evidence_packet_id, evidence_object_id)
        VALUES (${packet.id}, ${evidence.id})
      `;

        await tx`
        INSERT INTO ledger.vouchers (
          id,
          organization_id,
          workspace_id,
          evidence_packet_id,
          voucher_number,
          accounting_method,
          status,
          voucher_fields,
          extracted_fields,
          created_by,
          created_at
        ) VALUES (
          ${voucher.id},
          ${voucher.organizationId},
          ${voucher.workspaceId},
          ${voucher.evidencePacketId},
          ${voucher.voucherNumber},
          ${voucher.accountingMethod},
          ${voucher.status},
          ${tx.json(voucher.voucherFields as Parameters<typeof tx.json>[0])},
          ${tx.json(voucher.extractedFields as unknown as Parameters<typeof tx.json>[0])},
          ${voucher.createdBy},
          ${voucher.createdAt}
        )
      `;

        await tx`
        INSERT INTO ledger.review_tasks (
          id,
          organization_id,
          workspace_id,
          voucher_id,
          status,
          blocked_reason,
          suggested_action,
          suggestion,
          provenance_timeline,
          title,
          created_at
        ) VALUES (
          ${review.id},
          ${this.defaults.organizationId},
          ${this.defaults.workspaceId},
          ${review.voucherId},
          ${review.status},
          ${review.blockedReason ?? null},
          ${review.suggestedAction},
          ${tx.json(suggestion as unknown as Parameters<typeof tx.json>[0])},
          ${tx.json(review.provenanceTimeline as unknown as Parameters<typeof tx.json>[0])},
          ${review.title},
          ${evidence.createdAt}
        )
      `;

        // Append the four planned events. We thread the previous_hash forward
        // so the chain stays consistent.
        let prev = tailHash;
        for (const event of plan.events) {
          const appended = await this.appendEvent(
            tx,
            {
              ...event,
              payload: event.payload as unknown as Record<string, unknown>,
            },
            prev,
          );
          prev = appended.eventHash;
        }

        return { evidence, packet, voucher, review, voucherId: voucher.id };
      }),
    );
  }

  // composeEvidence appends an EvidenceRelinked chain event when a voucher is
  // repointed at the new packet (WS-B B6b), so it takes the workspace chain
  // lock + fork retry like every other appender. suggestVoucher,
  // refreshComplianceAlerts and putCompanySettings
  // below stay lock-free: they mutate read models only and append NO chain
  // events — the chain lock's scope is chain appends.
  async composeEvidence(input: EvidenceComposeInput & ActorAttribution): Promise<EvidencePacket> {
    const actorId = input.actorId ?? DEMO_ACTOR_ID;
    return this.withChainForkRetry(() =>
      this.client.begin(async (tx) => {
        const tailHash = await this.lockWorkspaceTail(tx);

        const packet: EvidencePacket = {
          id: createId("packet"),
          evidenceIds: input.evidenceIds,
          note: input.note,
          voiceTranscript: input.voiceTranscript,
        };

        await tx`
        INSERT INTO ledger.evidence_packets (
          id,
          organization_id,
          workspace_id,
          note,
          voice_transcript,
          created_at
        ) VALUES (
          ${packet.id},
          ${this.defaults.organizationId},
          ${this.defaults.workspaceId},
          ${packet.note ?? null},
          ${packet.voiceTranscript ?? null},
          ${nowIso()}
        )
      `;

        for (const evidenceId of input.evidenceIds) {
          await tx`
          INSERT INTO ledger.evidence_packet_items (evidence_packet_id, evidence_object_id)
          VALUES (${packet.id}, ${evidenceId})
          ON CONFLICT DO NOTHING
        `;
        }

        // Voucher relink read-model fix (Memory parity §A N9): when evidence is
        // re-bundled into a new packet, repoint vouchers.evidence_packet_id so
        // getEvidenceContext (newest packet) and getSnapshot (voucher link) agree.
        let voucherIdToRelink: string | undefined;
        let previousPacketId: string | undefined;
        for (const evidenceId of input.evidenceIds) {
          const linkedRows = await tx<Array<{ voucher_id: string; evidence_packet_id: string }>>`
          SELECT v.id AS voucher_id, v.evidence_packet_id
          FROM ledger.vouchers v
          JOIN ledger.evidence_packet_items i ON i.evidence_packet_id = v.evidence_packet_id
          WHERE i.evidence_object_id = ${evidenceId}
            AND i.evidence_packet_id != ${packet.id}
            AND v.organization_id = ${this.defaults.organizationId}
            AND v.workspace_id = ${this.defaults.workspaceId}
          LIMIT 1
        `;
          if (linkedRows[0]?.voucher_id && !voucherIdToRelink) {
            voucherIdToRelink = linkedRows[0].voucher_id;
            previousPacketId = linkedRows[0].evidence_packet_id;
          }
        }

        if (voucherIdToRelink) {
          await tx`
          UPDATE ledger.vouchers
          SET evidence_packet_id = ${packet.id}
          WHERE id = ${voucherIdToRelink}
            AND organization_id = ${this.defaults.organizationId}
            AND workspace_id = ${this.defaults.workspaceId}
        `;

          // WS-B B6b: a relink changes which evidence backs a voucher — that
          // must be visible in the audit chain, not a silent repoint (payload
          // parity with MemoryLedgerStore.composeEvidence).
          await this.appendEvent(
            tx,
            {
              organizationId: this.defaults.organizationId,
              workspaceId: this.defaults.workspaceId,
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
            },
            tailHash,
          );
        }

        return packet;
      }),
    );
  }

  async getEvidenceContext(
    evidenceId: string,
  ): Promise<{ evidence: EvidenceObject; packet?: EvidencePacket; voucher?: Voucher } | undefined> {
    const evidenceRows = await this.client<EvidenceRow[]>`
      SELECT id, organization_id, workspace_id, title, created_by, created_at,
             original_filename, mime_type, blob_path, hash, trust_level, metadata, modalities
      FROM ledger.evidence_objects
      WHERE id = ${evidenceId}
        AND organization_id = ${this.defaults.organizationId}
        AND workspace_id = ${this.defaults.workspaceId}
      LIMIT 1
    `;
    const evidenceRow = evidenceRows[0];
    if (!evidenceRow) return undefined;

    const evidence = rowToEvidence(evidenceRow);
    const { packet, voucher } = await resolvePacketAndVoucher(this.client, this.defaults, evidenceId);

    const result: { evidence: EvidenceObject; packet?: EvidencePacket; voucher?: Voucher } = { evidence };
    if (packet) result.packet = packet;
    if (voucher) result.voucher = voucher;
    return result;
  }

  async updateEvidenceExtraction(
    evidenceId: string,
    extraction: ExtractionResult,
  ): Promise<EvidenceContext | undefined> {
    // Mirrors MemoryLedgerStore.updateEvidenceExtraction via shared planner;
    // one transaction with the workspace chain lock held so both events chain atomically.
    return this.withChainForkRetry(() =>
      this.client.begin(async (tx) => {
        const tailHash = await this.lockWorkspaceTail(tx);

        // 1. Resolve evidence→packet→voucher (same join as getEvidenceContext, on tx).
        const evidenceRows = await tx<EvidenceRow[]>`
        SELECT id, organization_id, workspace_id, title, created_by, created_at,
               original_filename, mime_type, blob_path, hash, trust_level, metadata, modalities
        FROM ledger.evidence_objects
        WHERE id = ${evidenceId}
          AND organization_id = ${this.defaults.organizationId}
          AND workspace_id = ${this.defaults.workspaceId}
        LIMIT 1
      `;
        const evidenceRow = evidenceRows[0];
        if (!evidenceRow) return undefined;
        const evidence = rowToEvidence(evidenceRow);

        const { packet, voucher } = await resolvePacketAndVoucher(tx, this.defaults, evidenceId);

        let review: ReviewTask | undefined;
        if (voucher) {
          const reviewRows = await tx<ReviewRow[]>`
          SELECT id, organization_id, workspace_id, voucher_id, status, blocked_reason,
                 suggested_action, suggestion, provenance_timeline, title, created_at
          FROM ledger.review_tasks
          WHERE voucher_id = ${voucher.id}
            AND organization_id = ${this.defaults.organizationId}
            AND workspace_id = ${this.defaults.workspaceId}
          LIMIT 1
        `;
          review = reviewRows[0] ? rowToReview(reviewRows[0]) : undefined;
        }

        // Planner re-entered on every fork retry — ids/hashes regenerated inside.
        const plan = planExtractionRefresh(evidenceId, extraction, {
          evidence,
          ...(packet ? { packet } : {}),
          ...(voucher ? { voucher } : {}),
          ...(review ? { review } : {}),
        });

        if (plan.kind === "unchanged") {
          return plan.context;
        }

        // 5. Update the voucher read model (events stay the source of truth).
        await tx`
        UPDATE ledger.vouchers
        SET extracted_fields = ${tx.json(plan.updatedVoucher.extractedFields as unknown as Parameters<typeof tx.json>[0])},
            voucher_fields = ${tx.json(plan.updatedVoucher.voucherFields as Parameters<typeof tx.json>[0])}
        WHERE id = ${plan.updatedVoucher.id}
      `;

        // 6. Persist regenerated suggestion / blocked copy on the review read model.
        if (plan.updatedReview) {
          await tx`
          UPDATE ledger.review_tasks
          SET suggestion = ${tx.json(plan.suggestion as unknown as Parameters<typeof tx.json>[0])},
              blocked_reason = ${plan.updatedReview.blockedReason ?? null},
              suggested_action = ${plan.updatedReview.suggestedAction},
              provenance_timeline = ${tx.json(plan.updatedReview.provenanceTimeline as unknown as Parameters<typeof tx.json>[0])}
          WHERE id = ${plan.updatedReview.id}
        `;
        }

        // 7. Append the planned hash-chained events (full snapshot payload, Rule 13).
        let prev = tailHash;
        for (const event of plan.events) {
          const appended = await this.appendEvent(
            tx,
            {
              ...event,
              payload: event.payload as unknown as Record<string, unknown>,
            },
            prev,
          );
          prev = appended.eventHash;
        }

        // 8. Fresh copies for the caller.
        return plan.context;
      }),
    );
  }

  async importSie(input: SieImportInput): Promise<SieImportResult> {
    const actorId = input.actorId ?? DEMO_ACTOR_ID;
    // Shared per-voucher planning (bounds → SieImportError, per-voucher
    // isolation into `skipped`) keeps Memory and Postgres in lockstep.
    const { vouchers, skipped } = planSieImport(input.file);

    return this.withChainForkRetry(() =>
      this.client.begin(async (tx) => {
        const tailHash = await this.lockWorkspaceTail(tx);

        const result: SieImportResult = {
          accepted: true,
          importedVouchers: 0,
          importedTransactions: 0,
          skipped: [...skipped],
        };

        // Idempotency: skip vouchers whose aggregate id was already imported.
        const candidateIds = vouchers.map((planned) => planned.aggregateId);
        const existingRows =
          candidateIds.length === 0
            ? []
            : await tx<{ aggregate_id: string }[]>`
        SELECT aggregate_id
        FROM ledger.events
        WHERE event_type = 'VoucherImported'
          AND organization_id = ${this.defaults.organizationId}
          AND workspace_id = ${this.defaults.workspaceId}
          AND aggregate_id = ANY(${candidateIds})
      `;
        const alreadyImported = new Set(existingRows.map((row) => row.aggregate_id));

        const occurredAt = nowIso();
        const digestDate = new Date().toISOString().slice(0, 10);

        // Chain every hash in JS first, then bulk-insert (WS-B R15). The old
        // shape was one awaited INSERT per SIE voucher — ~500 sequential round
        // trips held under the workspace chain lock. Hash chaining only needs
        // the PREVIOUS event's hash, which is pure JS (buildEventHash), so the
        // rows can be fully materialized before Postgres sees any of them.
        type PlannedEventRow = {
          id: string;
          aggregateId: string;
          payload: Record<string, unknown>;
          previousHash: string;
          eventHash: string;
        };
        const batch: PlannedEventRow[] = [];
        let prev = tailHash;
        for (const planned of vouchers) {
          if (alreadyImported.has(planned.aggregateId)) {
            result.skipped.push({ reference: planned.reference, reason: "duplicate" });
            continue;
          }

          const payload: Record<string, unknown> = {
            source: "sie",
            series: planned.series,
            number: planned.number,
            date: planned.date,
            text: planned.text,
            lines: planned.lines as unknown as Record<string, unknown>[],
          };
          const eventHash = buildEventHash(prev, payload);
          batch.push({ id: createId("evt"), aggregateId: planned.aggregateId, payload, previousHash: prev, eventHash });
          prev = eventHash;

          result.importedVouchers += 1;
          result.importedTransactions += planned.lines.length;
        }

        if (batch.length > 0) {
          // One multi-row INSERT … SELECT. WITH ORDINALITY + ORDER BY ord pins
          // the physical insert order to the JS chain order, so 0006's `seq`
          // identity is assigned in chain order. created_at (clock_timestamp)
          // can tie between rows of a single statement at µs resolution — which
          // is exactly why `seq` is the final ORDER BY key on every read.
          // Constant-per-batch columns ride as scalar params; per-row values
          // come out of one jsonb array param.
          await tx`
          INSERT INTO ledger.events (
            id, organization_id, workspace_id, aggregate_type, aggregate_id,
            event_type, actor_id, occurred_at, payload, previous_hash,
            event_hash, digest_date
          )
          SELECT
            e.doc->>'id',
            ${this.defaults.organizationId},
            ${this.defaults.workspaceId},
            'ledger',
            e.doc->>'aggregateId',
            'VoucherImported',
            ${actorId},
            ${occurredAt},
            e.doc->'payload',
            e.doc->>'previousHash',
            e.doc->>'eventHash',
            ${digestDate}
          FROM jsonb_array_elements(${tx.json(batch as unknown as Parameters<typeof tx.json>[0])}::jsonb)
            WITH ORDINALITY AS e(doc, ord)
          ORDER BY e.ord
        `;
        }

        return result;
      }),
    );
  }

  async findReviewByVoucher(voucherId: string): Promise<ReviewTask | undefined> {
    const rows = await this.client<ReviewRow[]>`
      SELECT id, organization_id, workspace_id, voucher_id, status, blocked_reason,
             suggested_action, suggestion, provenance_timeline, title, created_at
      FROM ledger.review_tasks
      WHERE voucher_id = ${voucherId}
        AND organization_id = ${this.defaults.organizationId}
        AND workspace_id = ${this.defaults.workspaceId}
      LIMIT 1
    `;
    const row = rows[0];
    return row ? rowToReview(row) : undefined;
  }

  async getReviewFeed(): Promise<ReviewTask[]> {
    // Ordering note (R15 sweep): this reads ledger.review_tasks, which has no
    // `seq` column (0006 added it to ledger.events only); `id DESC` is already
    // the deterministic tiebreak here. Ditto for the other non-events
    // created_at orderings in this file (packets, evidence, vouchers, alerts).
    const rows = await this.client<ReviewRow[]>`
      SELECT id, organization_id, workspace_id, voucher_id, status, blocked_reason,
             suggested_action, suggestion, provenance_timeline, title, created_at
      FROM ledger.review_tasks
      WHERE organization_id = ${this.defaults.organizationId}
        AND workspace_id = ${this.defaults.workspaceId}
      ORDER BY created_at DESC, id DESC
    `;
    return rows.map(rowToReview);
  }

  /**
   * Rebuild the workspace's full ledger-line stream from event payloads only
   * (PostedToLedger + VoucherImported — Rule 13). No demo seed prepend —
   * `initialLedgerLines` is Memory/demo-only so normal-mode Postgres reads
   * stay honest empties until real postings exist. Shared by `getReports`
   * and `getReportPack` so the two read paths can never diverge.
   */
  private async collectLedgerLines(): Promise<LedgerLine[]> {
    const rows = await this.client<{ id: string; event_type: string; payload: Record<string, unknown> }[]>`
      SELECT id, event_type, payload
      FROM ledger.events
      WHERE event_type = ANY(${[...LINE_CARRYING_EVENT_TYPES]})
        AND organization_id = ${this.defaults.organizationId}
        AND workspace_id = ${this.defaults.workspaceId}
      ORDER BY seq ASC
    `;

    return collectLedgerLinesFromEvents(
      rows.map((r) => ({
        id: r.id,
        eventType: r.event_type as LedgerEvent["eventType"],
        payload: r.payload,
      })),
    );
  }

  async getReports(range?: ReportRange): Promise<ReportBundle> {
    const lines = filterLedgerLines(await this.collectLedgerLines(), range);
    return {
      journal: buildJournal(lines),
      balances: buildBalances(lines),
      vat: buildVat(lines),
    };
  }

  async getReportPack(input: { period: string }): Promise<ReportPack> {
    const [lines, settings] = await Promise.all([this.collectLedgerLines(), this.getCompanySettings()]);
    return buildReportPack(lines, {
      periodToken: input.period,
      fiscalYearStart: settings?.profile.fiscalYearStart ?? "01-01",
    });
  }

  async getSnapshot(): Promise<WorkspaceSnapshot> {
    const evidenceRows = await this.client<EvidenceRow[]>`
      SELECT id, organization_id, workspace_id, title, created_by, created_at,
             original_filename, mime_type, blob_path, hash, trust_level, metadata, modalities
      FROM ledger.evidence_objects
      WHERE organization_id = ${this.defaults.organizationId}
        AND workspace_id = ${this.defaults.workspaceId}
      ORDER BY created_at ASC
    `;

    const voucherRows = await this.client<VoucherRow[]>`
      SELECT id, organization_id, workspace_id, evidence_packet_id, voucher_number,
             accounting_method, status, voucher_fields, extracted_fields, created_by, created_at
      FROM ledger.vouchers
      WHERE organization_id = ${this.defaults.organizationId}
        AND workspace_id = ${this.defaults.workspaceId}
      ORDER BY created_at ASC
    `;

    // Evidence packets + their item joins so the voucher→evidence join
    // (`voucher.evidencePacketId` → `packet.evidenceIds`) resolves client-side
    // from the snapshot alone (advisory-pivot Phase 4, finding 5).
    const packetRows = await this.client<(PacketRow & { evidence_object_ids: string[] })[]>`
      SELECT p.id, p.organization_id, p.workspace_id, p.note, p.voice_transcript, p.created_at,
             COALESCE(
               (SELECT array_agg(i.evidence_object_id ORDER BY i.evidence_object_id)
                FROM ledger.evidence_packet_items i
                WHERE i.evidence_packet_id = p.id),
               '{}'::text[]
             ) AS evidence_object_ids
      FROM ledger.evidence_packets p
      WHERE p.organization_id = ${this.defaults.organizationId}
        AND p.workspace_id = ${this.defaults.workspaceId}
      ORDER BY p.created_at ASC
    `;

    const [reviews, reports, closeRun, alertRows, events] = await Promise.all([
      this.getReviewFeed(),
      this.getReports(),
      this.getCloseRun(),
      this.client<ComplianceAlertRow[]>`
        SELECT id, title, source, detected_at, impact_summary, kind, severity,
               status, target_id, body
        FROM ledger.compliance_alerts
        WHERE organization_id = ${this.defaults.organizationId}
          AND workspace_id = ${this.defaults.workspaceId}
        ORDER BY detected_at DESC
      `,
      this.getEvents(),
    ]);

    return {
      evidence: evidenceRows.map(rowToEvidence),
      vouchers: voucherRows.map(rowToVoucher),
      reviews,
      reports,
      // assistantExamples retired (P2-6 / F-7); staged empty for wire compat.
      // ledger.assistant_sessions table retained (append-only history).
      assistantExamples: [],
      closeRun,
      alerts: alertRows.map(rowToComplianceAlert),
      packets: packetRows.map((row) => rowToPacket(row, row.evidence_object_ids)),
      externalReferences: buildExternalReferencesFromEvents(events),
      voucherTags: buildVoucherTagsFromEvents(events),
    };
  }

  async getEvents(): Promise<LedgerEvent[]> {
    // seq-PRIMARY (0006 identity): the true append order and therefore the
    // hash-chain order — integrity verification must see events exactly as
    // chained, which wall-clock occurred_at cannot guarantee (clock steps,
    // identical timestamps inside batched inserts). Matches MemoryLedgerStore's
    // insertion order (Rule 11 parity).
    const rows = await this.client<EventRow[]>`
      SELECT id, organization_id, workspace_id, aggregate_type, aggregate_id, event_type,
             actor_id, occurred_at, payload, previous_hash, event_hash, digest_date, created_at
      FROM ledger.events
      WHERE organization_id = ${this.defaults.organizationId}
        AND workspace_id = ${this.defaults.workspaceId}
      ORDER BY seq ASC
    `;
    return rows.map(rowToEvent);
  }

  async registerProject(input: RegisterProjectInput & ActorAttribution): Promise<ProjectProjection> {
    return this.withChainForkRetry(() =>
      this.client.begin(async (tx) => {
        const tailHash = await this.lockWorkspaceTail(tx);
        const rows = await tx<EventRow[]>`
          SELECT id, organization_id, workspace_id, aggregate_type, aggregate_id, event_type,
                 actor_id, occurred_at, payload, previous_hash, event_hash, digest_date, created_at
          FROM ledger.events
          WHERE organization_id = ${this.defaults.organizationId}
            AND workspace_id = ${this.defaults.workspaceId}
            AND event_type IN ('ProjectRegistered', 'ProjectArchived')
          ORDER BY seq ASC
        `;
        const existing = buildProjectRegistryFromEvents(rows.map(rowToEvent)).find(
          (project) => project.projectId === input.projectId,
        );
        if (existing) return existing;

        const project: ProjectProjection = {
          projectId: input.projectId,
          name: input.name,
          status: "active",
        };
        await this.appendEvent(
          tx,
          {
            organizationId: this.defaults.organizationId,
            workspaceId: this.defaults.workspaceId,
            aggregateType: "ledger",
            aggregateId: project.projectId,
            eventType: "ProjectRegistered",
            actorId: input.actorId ?? DEMO_ACTOR_ID,
            occurredAt: nowIso(),
            payload: project,
          },
          tailHash,
        );
        return project;
      }),
    );
  }

  async suggestVoucher(voucherId: string): Promise<AccountingSuggestion | undefined> {
    return this.client.begin(async (tx) => {
      const voucherRows = await tx<VoucherRow[]>`
        SELECT id, organization_id, workspace_id, evidence_packet_id, voucher_number,
               accounting_method, status, voucher_fields, extracted_fields, created_by, created_at
        FROM ledger.vouchers
        WHERE id = ${voucherId}
          AND organization_id = ${this.defaults.organizationId}
          AND workspace_id = ${this.defaults.workspaceId}
        LIMIT 1
      `;
      const voucherRow = voucherRows[0];
      if (!voucherRow) return undefined;

      const voucher = rowToVoucher(voucherRow);
      const ruleHits = evaluateVoucherRules(voucher);
      const suggestion = buildDeterministicSuggestion(voucher, ruleHits);

      // Store parity (WS-B B7b): persist the regenerated suggestion onto the
      // review read model only while the review is still open — a decided
      // review's suggestion records what was actually posted (an edited
      // approval writes the posted suggestion there) and must never be
      // clobbered by a later regeneration. MemoryLedgerStore applies the
      // identical needs-review gate.
      await tx`
        UPDATE ledger.review_tasks
        SET suggestion = ${tx.json(suggestion as unknown as Parameters<typeof tx.json>[0])}
        WHERE voucher_id = ${voucherId}
          AND organization_id = ${this.defaults.organizationId}
          AND workspace_id = ${this.defaults.workspaceId}
          AND status = 'needs-review'
      `;

      return suggestion;
    });
  }

  async applyReviewDecision(
    reviewId: string,
    action: ReviewAction,
    input: ReviewDecisionInput & ActorAttribution & ApprovalGate,
  ): Promise<ReviewTask | undefined> {
    return this.withChainForkRetry(() =>
      this.client.begin(async (tx) => {
        const tailHashStart = await this.lockWorkspaceTail(tx);

        const reviewRows = await tx<ReviewRow[]>`
        SELECT id, organization_id, workspace_id, voucher_id, status, blocked_reason,
               suggested_action, suggestion, provenance_timeline, title, created_at
        FROM ledger.review_tasks
        WHERE id = ${reviewId}
          AND organization_id = ${this.defaults.organizationId}
          AND workspace_id = ${this.defaults.workspaceId}
        LIMIT 1
      `;
        const reviewRow = reviewRows[0];
        if (!reviewRow) return undefined;

        const review = rowToReview(reviewRow);

        const voucherRows = await tx<VoucherRow[]>`
        SELECT id, organization_id, workspace_id, evidence_packet_id, voucher_number,
               accounting_method, status, voucher_fields, extracted_fields, created_by, created_at
        FROM ledger.vouchers
        WHERE id = ${review.voucherId}
          AND organization_id = ${this.defaults.organizationId}
          AND workspace_id = ${this.defaults.workspaceId}
        LIMIT 1
      `;
        const voucherRow = voucherRows[0];
        if (!voucherRow) return undefined;

        const voucher = rowToVoucher(voucherRow);

        // Planner validates edits (InvalidReviewEditError) before any write and
        // is re-entered on every chain-fork retry.
        const basePlan = planReviewDecision(review, voucher, action, input);
        if (basePlan.kind === "replay") return basePlan.review;
        const intentRows = await tx<ReviewEnrichmentIntentRow[]>`
          SELECT review_id, voucher_id, proposals, updated_at, updated_by
          FROM ledger.review_enrichment_intents
          WHERE organization_id = ${this.defaults.organizationId}
            AND workspace_id = ${this.defaults.workspaceId}
            AND review_id = ${reviewId}
          LIMIT 1
        `;
        const intent = intentRows[0] ? rowToReviewEnrichmentIntent(intentRows[0]) : undefined;
        const plan =
          intent && action !== "reject"
            ? mergePrePostEnrichmentsIntoReviewDecisionPlan(
                basePlan,
                planPrePostEnrichment({
                  review,
                  proposals: intent.proposals,
                  postingLines: basePlan.lines ?? [],
                  actorId: input.actorId ?? DEMO_ACTOR_ID,
                  organizationId: voucher.organizationId,
                  workspaceId: voucher.workspaceId,
                }).companionEvents,
              )
            : basePlan;

        await tx`
        UPDATE ledger.review_tasks
        SET status = ${plan.updatedReview.status},
            provenance_timeline = ${tx.json(plan.updatedReview.provenanceTimeline as unknown as Parameters<typeof tx.json>[0])},
            suggestion = ${plan.updatedReview.suggestion ? tx.json(plan.updatedReview.suggestion as unknown as Parameters<typeof tx.json>[0]) : null}
        WHERE id = ${plan.updatedReview.id}
      `;

        await tx`
        UPDATE ledger.vouchers
        SET status = ${plan.updatedVoucher.status}
        WHERE id = ${plan.updatedVoucher.id}
      `;

        // Honest decision vocabulary (WS-B B6a) + optional PostedToLedger with
        // lines for event-payload replay truth (parity with Memory).
        let prev = tailHashStart;
        for (const event of plan.events) {
          const appended = await this.appendEvent(
            tx,
            {
              ...event,
              payload: event.payload as unknown as Record<string, unknown>,
            },
            prev,
          );
          prev = appended.eventHash;
        }

        await tx`
          DELETE FROM ledger.review_enrichment_intents
          WHERE organization_id = ${this.defaults.organizationId}
            AND workspace_id = ${this.defaults.workspaceId}
            AND review_id = ${reviewId}
        `;

        return plan.updatedReview;
      }),
    );
  }

  async attachReviewEnrichmentIntent(
    input: AttachReviewEnrichmentIntentInput & ActorAttribution,
  ): Promise<ReviewEnrichmentIntent> {
    return this.client.begin(async (tx) => {
      await this.lockWorkspaceTail(tx);
      const reviewRows = await tx<ReviewRow[]>`
        SELECT id, organization_id, workspace_id, voucher_id, status, blocked_reason,
               suggested_action, suggestion, provenance_timeline, title, created_at
        FROM ledger.review_tasks
        WHERE id = ${input.reviewId}
          AND organization_id = ${this.defaults.organizationId}
          AND workspace_id = ${this.defaults.workspaceId}
        LIMIT 1
      `;
      const reviewRow = reviewRows[0];
      if (!reviewRow || reviewRow.status !== "needs-review") {
        throw new EnrichmentIntentClosedError(input.reviewId);
      }
      const voucherRows = await tx<{ id: string; status: string }[]>`
        SELECT id, status
        FROM ledger.vouchers
        WHERE id = ${reviewRow.voucher_id}
          AND organization_id = ${this.defaults.organizationId}
          AND workspace_id = ${this.defaults.workspaceId}
        LIMIT 1
      `;
      const voucherRow = voucherRows[0];
      if (!voucherRow || voucherRow.status !== "needs-review") {
        throw new EnrichmentIntentClosedError(input.reviewId);
      }
      assertPrePostEnrichmentIntentSupported(input.proposals);

      const updatedAt = nowIso();
      const updatedBy = input.actorId ?? DEMO_ACTOR_ID;
      await tx`
        INSERT INTO ledger.review_enrichment_intents (
          organization_id, workspace_id, review_id, voucher_id,
          proposals, updated_at, updated_by
        ) VALUES (
          ${this.defaults.organizationId}, ${this.defaults.workspaceId},
          ${reviewRow.id}, ${voucherRow.id},
          ${tx.json(input.proposals as unknown as Parameters<typeof tx.json>[0])},
          ${updatedAt}, ${updatedBy}
        )
        ON CONFLICT (organization_id, workspace_id, review_id)
        DO UPDATE SET
          voucher_id = EXCLUDED.voucher_id,
          proposals = EXCLUDED.proposals,
          updated_at = EXCLUDED.updated_at,
          updated_by = EXCLUDED.updated_by
      `;
      return {
        reviewId: reviewRow.id,
        voucherId: voucherRow.id,
        proposals: structuredClone(input.proposals),
        updatedAt,
        updatedBy,
      };
    });
  }

  async getReviewEnrichmentIntent(reviewId: string): Promise<ReviewEnrichmentIntent | undefined> {
    const rows = await this.client<ReviewEnrichmentIntentRow[]>`
      SELECT review_id, voucher_id, proposals, updated_at, updated_by
      FROM ledger.review_enrichment_intents
      WHERE organization_id = ${this.defaults.organizationId}
        AND workspace_id = ${this.defaults.workspaceId}
        AND review_id = ${reviewId}
      LIMIT 1
    `;
    return rows[0] ? rowToReviewEnrichmentIntent(rows[0]) : undefined;
  }

  async proposeEnrichmentWorkItem(
    input: ProposeEnrichmentWorkItemInput & ActorAttribution,
  ): Promise<EnrichmentWorkItem> {
    return this.client.begin(async (tx) => {
      await this.lockWorkspaceTail(tx);
      const existingRows = await tx<EnrichmentWorkItemRow[]>`
        SELECT id, organization_id, workspace_id, target_kind, target_id,
               proposed_change, status, source, idempotency_key, created_at,
               created_by, confirmed_at, confirmed_by, resulting_event_ids,
               superseded_by_work_item_id
        FROM ledger.enrichment_work_items
        WHERE organization_id = ${this.defaults.organizationId}
          AND workspace_id = ${this.defaults.workspaceId}
          AND idempotency_key = ${input.idempotencyKey}
        LIMIT 1
      `;
      const existing = existingRows[0];
      if (existing) return rowToEnrichmentWorkItem(existing);

      const postedTargets = await loadPostedEnrichmentTargets(tx, this.defaults);
      assertEnrichmentTargetPosted(input, postedTargets);

      const id = createId("ewi");
      const createdAt = nowIso();
      const createdBy = input.actorId ?? DEMO_ACTOR_ID;
      await tx`
        INSERT INTO ledger.enrichment_work_items (
          id, organization_id, workspace_id, target_kind, target_id,
          proposed_change, status, source, idempotency_key, created_at, created_by
        ) VALUES (
          ${id}, ${this.defaults.organizationId}, ${this.defaults.workspaceId},
          ${input.targetKind}, ${input.targetId},
          ${tx.json(input.proposedChange as unknown as Parameters<typeof tx.json>[0])},
          'pending_confirmation', ${input.source}, ${input.idempotencyKey},
          ${createdAt}, ${createdBy}
        )
        ON CONFLICT (organization_id, workspace_id, idempotency_key) DO NOTHING
      `;

      const rows = await tx<EnrichmentWorkItemRow[]>`
        SELECT id, organization_id, workspace_id, target_kind, target_id,
               proposed_change, status, source, idempotency_key, created_at,
               created_by, confirmed_at, confirmed_by, resulting_event_ids,
               superseded_by_work_item_id
        FROM ledger.enrichment_work_items
        WHERE organization_id = ${this.defaults.organizationId}
          AND workspace_id = ${this.defaults.workspaceId}
          AND idempotency_key = ${input.idempotencyKey}
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) throw new Error("Enrichment work item insert did not return a row");
      return rowToEnrichmentWorkItem(row);
    });
  }

  async getEnrichmentWorkItem(id: string): Promise<EnrichmentWorkItem | undefined> {
    const rows = await this.client<EnrichmentWorkItemRow[]>`
      SELECT id, organization_id, workspace_id, target_kind, target_id,
             proposed_change, status, source, idempotency_key, created_at,
             created_by, confirmed_at, confirmed_by, resulting_event_ids,
             superseded_by_work_item_id
      FROM ledger.enrichment_work_items
      WHERE id = ${id}
        AND organization_id = ${this.defaults.organizationId}
        AND workspace_id = ${this.defaults.workspaceId}
      LIMIT 1
    `;
    return rows[0] ? rowToEnrichmentWorkItem(rows[0]) : undefined;
  }

  async confirmEnrichmentWorkItem(id: string, input: ActorAttribution): Promise<EnrichmentWorkItem> {
    return this.withChainForkRetry(() =>
      this.client.begin(async (tx) => {
        const tailHash = await this.lockWorkspaceTail(tx);
        const rows = await tx<EnrichmentWorkItemRow[]>`
          SELECT id, organization_id, workspace_id, target_kind, target_id,
                 proposed_change, status, source, idempotency_key, created_at,
                 created_by, confirmed_at, confirmed_by, resulting_event_ids,
                 superseded_by_work_item_id
          FROM ledger.enrichment_work_items
          WHERE id = ${id}
            AND organization_id = ${this.defaults.organizationId}
            AND workspace_id = ${this.defaults.workspaceId}
          FOR UPDATE
        `;
        const row = rows[0];
        if (!row) throw new EnrichmentWorkItemNotFoundError(id);
        const workItem = rowToEnrichmentWorkItem(row);
        if (workItem.status === "confirmed") return workItem;
        if (workItem.status !== "pending_confirmation") {
          throw new EnrichmentWorkItemConflictError(id, workItem.status);
        }

        const { postedVoucherIds, postedLineIds } = await loadPostedEnrichmentTargets(tx, this.defaults);
        const actorId = input.actorId ?? DEMO_ACTOR_ID;
        const externalReferenceEvents =
          workItem.proposedChange.kind === "external_reference_unlink"
            ? await loadExternalReferenceEvents(tx, this.defaults, workItem.targetId)
            : undefined;
        const isVoucherTagsProposal =
          workItem.proposedChange.kind === "voucher_tags_add" || workItem.proposedChange.kind === "voucher_tags_remove";
        const tagEvents = isVoucherTagsProposal
          ? await loadVoucherTagEvents(tx, this.defaults, workItem.targetId)
          : undefined;
        const tagDefinitions = isVoucherTagsProposal ? await loadTagDefinitions(tx, this.defaults) : undefined;
        const lineEnrichmentEvents =
          workItem.proposedChange.kind === "line_enrichment_supersede"
            ? await loadLineEnrichmentEvents(tx, this.defaults, workItem.targetId)
            : undefined;
        const plan = planPostPostEnrichmentConfirm({
          workItem,
          actorId,
          postedVoucherIds,
          postedLineIds,
          ...(externalReferenceEvents !== undefined ? { externalReferenceEvents } : {}),
          ...(lineEnrichmentEvents !== undefined ? { lineEnrichmentEvents } : {}),
          ...(tagEvents !== undefined ? { tagEvents } : {}),
          ...(tagDefinitions !== undefined ? { tagDefinitions } : {}),
        });

        const resultingEventIds: string[] = [];
        let previousHash = tailHash;
        for (const event of plan.events) {
          const appended = await this.appendEvent(
            tx,
            { ...event, payload: event.payload as unknown as Record<string, unknown> },
            previousHash,
          );
          resultingEventIds.push(appended.id);
          previousHash = appended.eventHash;
        }

        const confirmedAt = nowIso();
        await tx`
          UPDATE ledger.enrichment_work_items
          SET status = 'confirmed',
              confirmed_at = ${confirmedAt},
              confirmed_by = ${actorId},
              resulting_event_ids = ${tx.json(resultingEventIds)}
          WHERE id = ${id}
            AND organization_id = ${this.defaults.organizationId}
            AND workspace_id = ${this.defaults.workspaceId}
        `;
        return {
          ...workItem,
          status: "confirmed",
          confirmedAt,
          confirmedBy: actorId,
          resultingEventIds,
        };
      }),
    );
  }

  async rejectEnrichmentWorkItem(id: string, _input: ActorAttribution): Promise<EnrichmentWorkItem> {
    return this.client.begin(async (tx) => {
      await this.lockWorkspaceTail(tx);
      const rows = await tx<EnrichmentWorkItemRow[]>`
        SELECT id, organization_id, workspace_id, target_kind, target_id,
               proposed_change, status, source, idempotency_key, created_at,
               created_by, confirmed_at, confirmed_by, resulting_event_ids,
               superseded_by_work_item_id
        FROM ledger.enrichment_work_items
        WHERE id = ${id}
          AND organization_id = ${this.defaults.organizationId}
          AND workspace_id = ${this.defaults.workspaceId}
        FOR UPDATE
      `;
      const row = rows[0];
      if (!row) throw new EnrichmentWorkItemNotFoundError(id);
      const workItem = rowToEnrichmentWorkItem(row);
      if (workItem.status === "rejected") return workItem;
      if (workItem.status !== "pending_confirmation") {
        throw new EnrichmentWorkItemConflictError(id, workItem.status);
      }

      await tx`
        UPDATE ledger.enrichment_work_items
        SET status = 'rejected'
        WHERE id = ${id}
          AND organization_id = ${this.defaults.organizationId}
          AND workspace_id = ${this.defaults.workspaceId}
      `;
      return { ...workItem, status: "rejected" };
    });
  }

  async appendVoucherExternalReference(
    voucherId: string,
    input: { url: string; label?: string } & ActorAttribution,
  ): Promise<ExternalReferenceProjection> {
    return this.withChainForkRetry(() =>
      this.client.begin(async (tx) => {
        const tailHash = await this.lockWorkspaceTail(tx);
        assertEnrichmentTargetPosted(
          { targetKind: "voucher", targetId: voucherId },
          await loadPostedEnrichmentTargets(tx, this.defaults),
        );
        const plan = planExternalReferenceLink(
          voucherId,
          {
            url: input.url,
            ...(input.label !== undefined ? { label: input.label } : {}),
            actorId: input.actorId ?? DEMO_ACTOR_ID,
          },
          {
            organizationId: this.defaults.organizationId,
            workspaceId: this.defaults.workspaceId,
          },
        );
        await this.appendEvent(tx, plan.event, tailHash);
        return plan.reference;
      }),
    );
  }

  async removeVoucherExternalReference(
    voucherId: string,
    refId: string,
    input: ActorAttribution,
  ): Promise<ExternalReferenceProjection> {
    return this.withChainForkRetry(() =>
      this.client.begin(async (tx) => {
        const tailHash = await this.lockWorkspaceTail(tx);
        assertEnrichmentTargetPosted(
          { targetKind: "voucher", targetId: voucherId },
          await loadPostedEnrichmentTargets(tx, this.defaults),
        );
        const reference = findActiveExternalReference(
          await loadExternalReferenceEvents(tx, this.defaults, voucherId),
          voucherId,
          refId,
        );
        if (!reference) throw new ExternalReferenceNotFoundError(refId);
        const plan = planExternalReferenceRemoval(reference, input.actorId ?? DEMO_ACTOR_ID, {
          organizationId: this.defaults.organizationId,
          workspaceId: this.defaults.workspaceId,
        });
        await this.appendEvent(tx, plan.event, tailHash);
        return plan.reference;
      }),
    );
  }

  async appendVoucherTags(
    voucherId: string,
    input: { tagIds: string[]; mode: "add" | "remove" } & ActorAttribution,
  ): Promise<VoucherTagsProjection> {
    return this.withChainForkRetry(() =>
      this.client.begin(async (tx) => {
        const tailHash = await this.lockWorkspaceTail(tx);
        assertEnrichmentTargetPosted(
          { targetKind: "voucher", targetId: voucherId },
          await loadPostedEnrichmentTargets(tx, this.defaults),
        );
        const tagEvents = await loadVoucherTagEvents(tx, this.defaults, voucherId);
        const existingActiveTagIds =
          buildVoucherTagsFromEvents(tagEvents).find((projection) => projection.voucherId === voucherId)?.tagIds ?? [];
        const plan = planVoucherTagsAppend(
          {
            voucherId,
            tagIds: input.tagIds,
            mode: input.mode,
            existingActiveTagIds,
            tagDefinitions: await loadTagDefinitions(tx, this.defaults),
            actorId: input.actorId ?? DEMO_ACTOR_ID,
          },
          {
            organizationId: this.defaults.organizationId,
            workspaceId: this.defaults.workspaceId,
          },
        );
        let previousHash = tailHash;
        for (const event of plan.events) {
          const appended = await this.appendEvent(
            tx,
            { ...event, payload: event.payload as unknown as Record<string, unknown> },
            previousHash,
          );
          previousHash = appended.eventHash;
        }
        return (
          buildVoucherTagsFromEvents([...tagEvents, ...plan.events]).find(
            (projection) => projection.voucherId === voucherId,
          ) ?? { voucherId, tagIds: [] }
        );
      }),
    );
  }

  async runSimulation(input: SimulationRequest & ActorAttribution): Promise<SimulationRun> {
    const actorId = input.actorId ?? DEMO_ACTOR_ID;
    return this.withChainForkRetry(() =>
      this.client.begin(async (tx) => {
        const tailHash = await this.lockWorkspaceTail(tx);

        // Dedup at boundary (CONVENTIONS Rule 23). Postgres ANY(...) would dedupe
        // anyway, but explicit dedup makes the length-check correct.
        const reviewIds = [...new Set(input.reviewIds)];

        const reviewRows = await tx<ReviewRow[]>`
        SELECT id, organization_id, workspace_id, voucher_id, status, blocked_reason,
               suggested_action, suggestion, provenance_timeline, title, created_at
        FROM ledger.review_tasks
        WHERE organization_id = ${this.defaults.organizationId}
          AND workspace_id = ${this.defaults.workspaceId}
          AND id = ANY(${reviewIds})
      `;
        if (reviewRows.length !== reviewIds.length) {
          const found = new Set(reviewRows.map((r) => r.id));
          throw new ReviewNotFoundError(reviewIds.filter((id) => !found.has(id)));
        }

        const voucherIds = [...new Set(reviewRows.map((r) => r.voucher_id))];
        const voucherRows =
          voucherIds.length === 0
            ? []
            : await tx<VoucherRow[]>`
        SELECT id, organization_id, workspace_id, evidence_packet_id, voucher_number,
               accounting_method, status, voucher_fields, extracted_fields, created_by, created_at
        FROM ledger.vouchers
        WHERE organization_id = ${this.defaults.organizationId}
          AND workspace_id = ${this.defaults.workspaceId}
          AND id = ANY(${voucherIds})
      `;

        const reviews = reviewRows.map(rowToReview);
        const vouchers = voucherRows.map(rowToVoucher);
        const suggestions = reviews.map((r) => r.suggestion).filter((s): s is AccountingSuggestion => Boolean(s));

        const { balanceDelta, vatDelta, affectedAccounts } = simulateApprovals(
          reviews,
          suggestions,
          vouchers,
          input.action,
        );

        const result: SimulationRun = {
          id: createId("sim"),
          title: input.title,
          scenario: input.scenario,
          outcomeSummary: `Simulated ${reviews.length} review(s); ${affectedAccounts.length} accounts affected. No production postings were changed.`,
          affectedAccounts,
          balanceDelta,
          vatDelta,
        };

        await this.appendEvent(
          tx,
          {
            organizationId: this.defaults.organizationId,
            workspaceId: this.defaults.workspaceId,
            aggregateType: "simulation",
            aggregateId: result.id,
            eventType: "SimulationExecuted",
            actorId,
            occurredAt: nowIso(),
            payload: result as unknown as Record<string, unknown>,
          },
          tailHash,
        );

        return result;
      }),
    );
  }

  async getCloseRun(): Promise<CloseRun> {
    // Store parity with MemoryLedgerStore — honest empty shell until period-close
    // persistence lands (Phase 3.5 / §A C2).
    return {
      id: "close_unavailable",
      period: currentMonthToken(),
      generatedAt: nowIso(),
      checklist: [],
    };
  }

  async refreshComplianceAlerts(): Promise<ComplianceAlert[]> {
    return this.client.begin(async (tx) => {
      const reviewRows = await tx<ReviewRow[]>`
        SELECT id, organization_id, workspace_id, voucher_id, status, blocked_reason,
               suggested_action, suggestion, provenance_timeline, title, created_at
        FROM ledger.review_tasks
        WHERE organization_id = ${this.defaults.organizationId}
          AND workspace_id = ${this.defaults.workspaceId}
      `;
      const reviews = reviewRows.map(rowToReview);

      // Suggestions are embedded on review_tasks.suggestion (jsonb) on main —
      // no separate suggestions table to hydrate from. If a row has null
      // suggestion, the stale-blocked rule won't fire for it (intentional —
      // a review without any suggestion can't have rule hits).

      const voucherRows = await tx<VoucherRow[]>`
        SELECT id, organization_id, workspace_id, evidence_packet_id, voucher_number,
               accounting_method, status, voucher_fields, extracted_fields, created_by, created_at
        FROM ledger.vouchers
        WHERE organization_id = ${this.defaults.organizationId}
          AND workspace_id = ${this.defaults.workspaceId}
      `;
      const vouchers = voucherRows.map(rowToVoucher);

      const detected = detectComplianceIssues(reviews, vouchers, today());

      if (detected.length > 0) {
        // Upsert via ON CONFLICT on (org, workspace, kind, target_id) — unique
        // index with NULLS NOT DISTINCT from migration 0004.
        //
        // Store parity + lifecycle hooks (WS-B B7a; CONVENTIONS Rules 11, 18,
        // 24): re-detection must NOT force-reopen user states — an alert the
        // user acknowledged or dismissed keeps its status (and its resolution
        // metadata) exactly like MemoryLedgerStore's rebuild, which passes
        // acknowledged/dismissed through unchanged. Only auto states flip:
        // open stays open, resolved reopens (with resolved_at/resolved_by
        // cleared so reopened rows carry no stale resolution metadata).
        // detected_at is preserved on conflict — Memory keeps the FIRST
        // detection time across re-detections, so Postgres must too.
        for (const alert of detected) {
          await tx`
            INSERT INTO ledger.compliance_alerts
              (id, organization_id, workspace_id, title, source, detected_at,
               impact_summary, kind, severity, status, target_id, body,
               resolved_at, resolved_by)
            VALUES
              (${alert.id}, ${this.defaults.organizationId}, ${this.defaults.workspaceId},
               ${alert.title}, ${alert.source}, ${alert.detectedAt},
               ${alert.impactSummary}, ${alert.kind}, ${alert.severity},
               ${alert.status}, ${alert.targetId ?? null}, ${alert.body ?? null},
               null, null)
            ON CONFLICT (organization_id, workspace_id, kind, target_id) DO UPDATE
              SET status = CASE
                    WHEN ledger.compliance_alerts.status IN ('acknowledged', 'dismissed')
                      THEN ledger.compliance_alerts.status
                    ELSE EXCLUDED.status
                  END,
                  resolved_at = CASE
                    WHEN ledger.compliance_alerts.status IN ('acknowledged', 'dismissed')
                      THEN ledger.compliance_alerts.resolved_at
                    ELSE null
                  END,
                  resolved_by = CASE
                    WHEN ledger.compliance_alerts.status IN ('acknowledged', 'dismissed')
                      THEN ledger.compliance_alerts.resolved_by
                    ELSE null
                  END
          `;
        }
      }

      // Resolve any previously-open auto-detected alert whose condition no
      // longer holds (CONVENTIONS Rule 24). Use 'system:auto-resolver' sentinel
      // for attribution, not ctx.userId (Rule 20).
      const autoOpenRows = await tx<Array<{ id: string }>>`
        SELECT id FROM ledger.compliance_alerts
        WHERE organization_id = ${this.defaults.organizationId}
          AND workspace_id = ${this.defaults.workspaceId}
          AND status = 'open'
          AND kind = ANY(${[...AUTO_DETECTED_ALERT_KINDS]})
      `;
      const { resolveIds: toResolve } = planComplianceMerge(autoOpenRows, detected);
      if (toResolve.length > 0) {
        await tx`
          UPDATE ledger.compliance_alerts
          SET status = 'resolved',
              resolved_at = now(),
              resolved_by = 'system:auto-resolver'
          WHERE organization_id = ${this.defaults.organizationId}
            AND workspace_id = ${this.defaults.workspaceId}
            AND id = ANY(${toResolve})
        `;
      }

      const allRows = await tx<ComplianceAlertRow[]>`
        SELECT id, title, source, detected_at, impact_summary, kind, severity,
               status, target_id, body
        FROM ledger.compliance_alerts
        WHERE organization_id = ${this.defaults.organizationId}
          AND workspace_id = ${this.defaults.workspaceId}
        ORDER BY detected_at DESC
      `;
      return allRows.map(rowToComplianceAlert);
    });
  }

  async getCompanySettings(): Promise<CompanySettings | null> {
    const rows = await this.client<Array<{ settings: CompanySettings }>>`
      SELECT settings FROM ledger.organization_settings
      WHERE organization_id = ${this.defaults.organizationId}
    `;
    // Normalize through the schema: pre-profile jsonb rows gain the Sweden
    // defaults on read (append-only data is never rewritten in place).
    return rows[0] ? companySettingsSchema.parse(rows[0].settings) : null;
  }

  async putCompanySettings(input: CompanySettings): Promise<CompanySettings> {
    // Authenticated user attribution would normally come from a ctx field —
    // PostgresLedgerStore on main constructs without one, so use the org id as
    // the audit fallback. When ctx.userId is plumbed through (separate sprint),
    // swap this for ctx.userId.
    const parsed = companySettingsSchema.parse(input);
    await this.client.begin(async (tx) => {
      await tx`
        INSERT INTO ledger.organization_settings (organization_id, settings, updated_by)
        VALUES (${this.defaults.organizationId},
                ${tx.json(parsed as unknown as Parameters<typeof tx.json>[0])},
                ${this.defaults.organizationId})
        ON CONFLICT (organization_id) DO UPDATE
          SET settings = EXCLUDED.settings,
              updated_at = now(),
              updated_by = EXCLUDED.updated_by
      `;
    });
    return parsed;
  }
}
