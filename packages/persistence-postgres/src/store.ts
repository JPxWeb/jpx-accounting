import type {
  AccountingMethod,
  AccountingSuggestion,
  AssistantSession,
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
  ExtractedField,
  ExtractionResult,
  LedgerEvent,
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

import {
  buildAssistantScaffold,
  buildBalances,
  buildDeterministicSuggestion,
  buildEventHash,
  buildExtractedFields,
  buildJournal,
  buildPostingLines,
  buildReportPack,
  buildVat,
  createId,
  currentMonthToken,
  deriveVoucherFields,
  detectComplianceIssues,
  evaluateVoucherRules,
  filterLedgerLines,
  guessAccountingMethod,
  initialLedgerLines,
  mergeExtractedFields,
  nowIso,
  planSieImport,
  recomputeVoucherFields,
  resolveReviewDecisionEdit,
  ReviewNotFoundError,
  simulateApprovals,
  today,
  type LedgerLine,
  type LedgerStore,
  type ReportRange,
  type ReviewAction,
  type SieImportInput,
} from "@jpx-accounting/domain";

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

// `buildExtractedFields`, `guessSupplier`, `guessAccountingMethod`,
// `initialLedgerLines`, and `buildPostingLines` are now imported from
// `@jpx-accounting/domain` so the memory and postgres stores stay in lockstep.

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
    const rows = await tx<{ event_hash: string }[]>`
      SELECT event_hash
      FROM ledger.events
      WHERE organization_id = ${this.defaults.organizationId}
        AND workspace_id = ${this.defaults.workspaceId}
      ORDER BY occurred_at DESC, created_at DESC, seq DESC
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

  async createEvidence(input: EvidenceCreateInput): Promise<EvidenceCreateResult> {
    return this.withChainForkRetry(() =>
      this.client.begin(async (tx) => {
        const tailHash = await this.lockWorkspaceTail(tx);

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

        const packet: EvidencePacket = {
          id: packetId,
          evidenceIds: [evidenceId],
        };
        if (input.note !== undefined) packet.note = input.note;
        if (input.extractedText !== undefined) packet.voiceTranscript = input.extractedText;

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
          ${input.organizationId},
          ${input.workspaceId},
          ${packet.note ?? null},
          ${packet.voiceTranscript ?? null},
          ${createdAt}
        )
      `;

        await tx`
        INSERT INTO ledger.evidence_packet_items (evidence_packet_id, evidence_object_id)
        VALUES (${packet.id}, ${evidence.id})
      `;

        // Voucher number sequencing: COUNT(*) inside the workspace, just like
        // MemoryLedgerStore which uses `this.vouchers.size + 1001`.
        const voucherCountRows = await tx<{ count: string }[]>`
        SELECT COUNT(*)::text AS count
        FROM ledger.vouchers
        WHERE organization_id = ${input.organizationId}
          AND workspace_id = ${input.workspaceId}
      `;
        const voucherCount = Number(voucherCountRows[0]?.count ?? "0");
        const voucherNumber = `V-${voucherCount + 1001}`;

        const extractedFields = buildExtractedFields(input);
        const voucher: Voucher = {
          id: voucherId,
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          evidencePacketId: packetId,
          voucherNumber,
          status: "needs-review",
          accountingMethod: guessAccountingMethod(input),
          extractedFields,
          voucherFields: deriveVoucherFields(extractedFields, input),
          createdAt,
          createdBy: input.actorId,
        };

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

        const ruleHits = evaluateVoucherRules(voucher);
        const suggestion = buildDeterministicSuggestion(voucher, ruleHits);
        const reviewId = createId("review");
        const blocked = ruleHits.some((rule) => rule.severity === "blocking");

        const review: ReviewTask = {
          id: reviewId,
          voucherId,
          title: `Review ${voucher.voucherNumber}`,
          status: "needs-review",
          suggestedAction: blocked
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
        if (blocked) {
          review.blockedReason =
            "Mandatory bookkeeping or VAT data must be confirmed before deductible VAT can be approved.";
        }

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
          ${input.organizationId},
          ${input.workspaceId},
          ${review.voucherId},
          ${review.status},
          ${review.blockedReason ?? null},
          ${review.suggestedAction},
          ${tx.json(suggestion as unknown as Parameters<typeof tx.json>[0])},
          ${tx.json(review.provenanceTimeline as unknown as Parameters<typeof tx.json>[0])},
          ${review.title},
          ${createdAt}
        )
      `;

        // Append the four events that mirror MemoryLedgerStore exactly. We thread
        // the previous_hash forward so the chain stays consistent.
        let prev = tailHash;
        const evt1 = await this.appendEvent(
          tx,
          {
            organizationId: input.organizationId,
            workspaceId: input.workspaceId,
            aggregateType: "evidence",
            aggregateId: evidenceId,
            eventType: "EvidenceReceived",
            actorId: input.actorId,
            occurredAt: createdAt,
            payload: evidence as unknown as Record<string, unknown>,
          },
          prev,
        );
        prev = evt1.eventHash;

        const evt2 = await this.appendEvent(
          tx,
          {
            organizationId: input.organizationId,
            workspaceId: input.workspaceId,
            aggregateType: "voucher",
            aggregateId: voucherId,
            eventType: "FieldsExtracted",
            actorId: "system-extractor",
            occurredAt: createdAt,
            payload: { extractedFields },
          },
          prev,
        );
        prev = evt2.eventHash;

        const evt3 = await this.appendEvent(
          tx,
          {
            organizationId: input.organizationId,
            workspaceId: input.workspaceId,
            aggregateType: "voucher",
            aggregateId: voucherId,
            eventType: "VoucherCreated",
            actorId: input.actorId,
            occurredAt: createdAt,
            payload: voucher as unknown as Record<string, unknown>,
          },
          prev,
        );
        prev = evt3.eventHash;

        await this.appendEvent(
          tx,
          {
            organizationId: input.organizationId,
            workspaceId: input.workspaceId,
            aggregateType: "review",
            aggregateId: review.id,
            eventType: "SuggestionGenerated",
            actorId: "system-ai",
            occurredAt: createdAt,
            payload: suggestion as unknown as Record<string, unknown>,
          },
          prev,
        );

        return { evidence, packet, voucher, review, voucherId };
      }),
    );
  }

  // composeEvidence appends an EvidenceRelinked chain event when a voucher is
  // repointed at the new packet (WS-B B6b), so it takes the workspace chain
  // lock + fork retry like every other appender. suggestVoucher,
  // answerAssistantQuestion, refreshComplianceAlerts and putCompanySettings
  // below stay lock-free: they mutate read models only and append NO chain
  // events — the chain lock's scope is chain appends.
  async composeEvidence(input: EvidenceComposeInput): Promise<EvidencePacket> {
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
          ${input.organizationId},
          ${input.workspaceId},
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
            AND v.organization_id = ${input.organizationId}
            AND v.workspace_id = ${input.workspaceId}
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
            AND organization_id = ${input.organizationId}
            AND workspace_id = ${input.workspaceId}
        `;

          // WS-B B6b: a relink changes which evidence backs a voucher — that
          // must be visible in the audit chain, not a silent repoint (payload
          // parity with MemoryLedgerStore.composeEvidence).
          await this.appendEvent(
            tx,
            {
              organizationId: input.organizationId,
              workspaceId: input.workspaceId,
              aggregateType: "voucher",
              aggregateId: voucherIdToRelink,
              eventType: "EvidenceRelinked",
              actorId: input.actorId,
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
    // Mirrors MemoryLedgerStore.updateEvidenceExtraction step-for-step; one
    // transaction with the workspace chain lock held so both events chain atomically.
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

        if (!voucher) {
          const result: EvidenceContext = { evidence };
          if (packet) result.packet = packet;
          return result;
        }

        const reviewRows = await tx<ReviewRow[]>`
        SELECT id, organization_id, workspace_id, voucher_id, status, blocked_reason,
               suggested_action, suggestion, provenance_timeline, title, created_at
        FROM ledger.review_tasks
        WHERE voucher_id = ${voucher.id}
          AND organization_id = ${this.defaults.organizationId}
          AND workspace_id = ${this.defaults.workspaceId}
        LIMIT 1
      `;
        const review = reviewRows[0] ? rowToReview(reviewRows[0]) : undefined;

        // 2. Decided-voucher guard (append-only): no mutation, no event.
        if (voucher.status !== "needs-review") {
          const result: EvidenceContext = { evidence, voucher };
          if (packet) result.packet = packet;
          if (review) result.review = review;
          return result;
        }

        const occurredAt = nowIso();

        // 3. Merge by key; 4. recompute voucher fields preserving description/currency.
        const mergedFields = mergeExtractedFields(voucher.extractedFields, extraction.fields);
        const voucherFields = recomputeVoucherFields(mergedFields, voucher.voucherFields);
        const updatedVoucher: Voucher = { ...voucher, extractedFields: mergedFields, voucherFields };

        // 5. Update the voucher read model (events stay the source of truth).
        await tx`
        UPDATE ledger.vouchers
        SET extracted_fields = ${tx.json(mergedFields as unknown as Parameters<typeof tx.json>[0])},
            voucher_fields = ${tx.json(voucherFields as Parameters<typeof tx.json>[0])}
        WHERE id = ${voucher.id}
      `;

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

          await tx`
          UPDATE ledger.review_tasks
          SET suggestion = ${tx.json(suggestion as unknown as Parameters<typeof tx.json>[0])},
              blocked_reason = ${updatedReview.blockedReason ?? null},
              suggested_action = ${updatedReview.suggestedAction},
              provenance_timeline = ${tx.json(updatedReview.provenanceTimeline as unknown as Parameters<typeof tx.json>[0])}
          WHERE id = ${review.id}
        `;
        }

        // 7. Append the two hash-chained events (full snapshot payload, Rule 13).
        let prev = tailHash;
        const refreshedEvt = await this.appendEvent(
          tx,
          {
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
          },
          prev,
        );
        prev = refreshedEvt.eventHash;

        if (updatedReview) {
          await this.appendEvent(
            tx,
            {
              organizationId: updatedVoucher.organizationId,
              workspaceId: updatedVoucher.workspaceId,
              aggregateType: "review",
              aggregateId: updatedReview.id,
              eventType: "SuggestionGenerated",
              actorId: "system-ai",
              occurredAt,
              payload: suggestion as unknown as Record<string, unknown>,
            },
            prev,
          );
        }

        // 8. Fresh copies for the caller.
        const result: EvidenceContext = { evidence, voucher: updatedVoucher };
        if (packet) result.packet = packet;
        if (updatedReview) result.review = updatedReview;
        return result;
      }),
    );
  }

  async importSie(input: SieImportInput): Promise<SieImportResult> {
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
            ${input.actorId},
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
   * Rebuild the workspace's full ledger-line stream. Always prepends the
   * seeded ledger lines so projection output matches the MemoryLedgerStore
   * baseline. Anything posted via approved/booked-without-VAT reviews or
   * imported from SIE is replayed from event payload `lines` (PostedToLedger
   * + VoucherImported both carry them — Rule 13). Shared by `getReports` and
   * `getReportPack` so the two read paths can never diverge.
   */
  private async collectLedgerLines(): Promise<LedgerLine[]> {
    const lines: LedgerLine[] = [...initialLedgerLines()];

    const rows = await this.client<{ payload: Record<string, unknown> }[]>`
      SELECT payload
      FROM ledger.events
      WHERE event_type = ANY(${["PostedToLedger", "VoucherImported"]})
        AND organization_id = ${this.defaults.organizationId}
        AND workspace_id = ${this.defaults.workspaceId}
      ORDER BY occurred_at ASC, created_at ASC, seq ASC
    `;

    for (const row of rows) {
      const payloadLines = (row.payload as { lines?: unknown }).lines;
      if (Array.isArray(payloadLines)) {
        for (const line of payloadLines as LedgerLine[]) {
          lines.push(line);
        }
      }
    }

    return lines;
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

    const [reviews, reports, closeRun, alertRows] = await Promise.all([
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
    ]);

    return {
      evidence: evidenceRows.map(rowToEvidence),
      vouchers: voucherRows.map(rowToVoucher),
      reviews,
      reports,
      // Contract decision: assistantExamples has no Postgres read model yet.
      // answerAssistantQuestion persists to ledger.assistant_sessions, but the
      // snapshot's AssistantSession[] shape is Memory-only until wired.
      assistantExamples: [],
      closeRun,
      alerts: alertRows.map(rowToComplianceAlert),
      packets: packetRows.map((row) => rowToPacket(row, row.evidence_object_ids)),
    };
  }

  async getEvents(): Promise<LedgerEvent[]> {
    // `seq` (0006 identity) is the FINAL tiebreak on every ledger.events read:
    // occurred_at and created_at are both wall-clock and can tie inside a
    // multi-row insert (importSie batch) or across appends on the same µs.
    const rows = await this.client<EventRow[]>`
      SELECT id, organization_id, workspace_id, aggregate_type, aggregate_id, event_type,
             actor_id, occurred_at, payload, previous_hash, event_hash, digest_date, created_at
      FROM ledger.events
      WHERE organization_id = ${this.defaults.organizationId}
        AND workspace_id = ${this.defaults.workspaceId}
      ORDER BY occurred_at ASC, created_at ASC, seq ASC
    `;
    return rows.map(rowToEvent);
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
    input: ReviewDecisionInput,
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

        // Idempotency: replays should not re-post lines.
        if (review.status !== "needs-review") return review;

        // Decision-time derivation for edited approvals: validates (throwing
        // InvalidReviewEditError BEFORE any mutation — the transaction would
        // roll back anyway, but ordering keeps the two stores step-identical)
        // and derives the effective posting inputs. Append-only: the stored
        // voucher row is NOT rewritten.
        const edited = action !== "reject" ? input.edited : undefined;
        let postingSuggestion = review.suggestion;
        let postingVoucher = voucher;
        if (edited) {
          const resolved = resolveReviewDecisionEdit(voucher, review.suggestion, edited);
          postingSuggestion = resolved.effectiveSuggestion;
          postingVoucher = resolved.effectiveVoucher;
        }

        const occurredAt = nowIso();
        const newStatus: ReviewTask["status"] =
          action === "approve" ? "approved" : action === "reject" ? "rejected" : "booked-without-vat";

        const stepLabel =
          action === "approve"
            ? edited
              ? "Approved with edits"
              : "Review approved"
            : action === "reject"
              ? "Review rejected"
              : edited
                ? "Booked without VAT deduction (edited)"
                : "Booked without VAT deduction";

        const updatedTimeline: ReviewTask["provenanceTimeline"] = [
          ...review.provenanceTimeline,
          {
            id: createId("step"),
            label: stepLabel,
            timestamp: occurredAt,
            actor: input.actorId,
          },
        ];

        review.status = newStatus;
        review.provenanceTimeline = updatedTimeline;
        voucher.status = newStatus;
        if (edited && postingSuggestion) {
          // Review read model reflects what was actually posted.
          review.suggestion = postingSuggestion;
        }

        await tx`
        UPDATE ledger.review_tasks
        SET status = ${newStatus},
            provenance_timeline = ${tx.json(updatedTimeline as unknown as Parameters<typeof tx.json>[0])},
            suggestion = ${review.suggestion ? tx.json(review.suggestion as unknown as Parameters<typeof tx.json>[0]) : null}
        WHERE id = ${review.id}
      `;

        await tx`
        UPDATE ledger.vouchers
        SET status = ${newStatus}
        WHERE id = ${voucher.id}
      `;

        let prev = tailHashStart;
        // Honest decision vocabulary (WS-B B6a): book-without-vat gets its own
        // decision event. Legacy streams recorded ReviewRejected +
        // PostedToLedger for this decision; collectLedgerLines keys on
        // PostedToLedger/VoucherImported lines only, so old streams keep
        // projecting identically (backward compatible; parity with Memory).
        const decisionEventType: EventTypeName =
          action === "approve" ? "ReviewApproved" : action === "reject" ? "ReviewRejected" : "ReviewBookedWithoutVat";
        const decisionPayload: Record<string, unknown> = { action };
        if (input.notes !== undefined) decisionPayload.notes = input.notes;
        if (edited) decisionPayload.edited = edited;

        const decisionEvt = await this.appendEvent(
          tx,
          {
            organizationId: voucher.organizationId,
            workspaceId: voucher.workspaceId,
            aggregateType: "review",
            aggregateId: review.id,
            eventType: decisionEventType,
            actorId: input.actorId,
            occurredAt,
            payload: decisionPayload,
          },
          prev,
        );
        prev = decisionEvt.eventHash;

        if (action !== "reject" && postingSuggestion) {
          const lines = buildPostingLines(postingVoucher, postingSuggestion, action, occurredAt);
          await this.appendEvent(
            tx,
            {
              organizationId: voucher.organizationId,
              workspaceId: voucher.workspaceId,
              aggregateType: "ledger",
              aggregateId: voucher.id,
              eventType: "PostedToLedger",
              actorId: input.actorId,
              occurredAt,
              payload: {
                action,
                suggestion: postingSuggestion as unknown as Record<string, unknown>,
                lines: lines as unknown as Record<string, unknown>[],
              },
            },
            prev,
          );
        }

        return review;
      }),
    );
  }

  async answerAssistantQuestion(question: string): Promise<AssistantSession> {
    const session = buildAssistantScaffold(question);

    await this.client.begin(async (tx) => {
      await tx`
        INSERT INTO ledger.assistant_sessions
          (id, organization_id, workspace_id, question, answer, status, citations, actor_id)
        VALUES
          (${session.id}, ${this.defaults.organizationId}, ${this.defaults.workspaceId},
           ${session.question}, ${session.answer}, ${session.status},
           ${tx.json(session.citations as unknown as Parameters<typeof tx.json>[0])}, null)
      `;
    });

    return session;
  }

  async runSimulation(input: SimulationRequest): Promise<SimulationRun> {
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
            actorId: input.actorId,
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
      const detectedIds = new Set(detected.map((a) => a.id));
      const autoOpenRows = await tx<Array<{ id: string }>>`
        SELECT id FROM ledger.compliance_alerts
        WHERE organization_id = ${this.defaults.organizationId}
          AND workspace_id = ${this.defaults.workspaceId}
          AND status = 'open'
          AND kind = ANY(${["stale-blocked", "missing-supplier-vat"]})
      `;
      const toResolve = autoOpenRows.filter((r) => !detectedIds.has(r.id)).map((r) => r.id);
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
