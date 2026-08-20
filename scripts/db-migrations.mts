/**
 * Locked, checksum-tracked migration runner for `infra/supabase/migrations/*.sql`.
 *
 * Discovers migration files dynamically (no hardcoded list), validates their four-digit
 * numeric prefixes are unique/contiguous/lexically ordered, applies each unapplied file in
 * its own transaction under one fixed session-scoped `pg_advisory_lock`, and records a
 * SHA-256 of every applied file in `jpx_meta.schema_migrations` so edited history is
 * detected loudly instead of silently re-applied. Runs under `tsx` so it can import the
 * workspace TypeScript client directly (same pattern as `scripts/ingest-knowledge.mjs`):
 *
 *   tsx scripts/db-migrations.mts <command> [--database-url <url>]
 *
 * Commands:
 *   migrate  Apply all pending migrations, then run capability assertions.
 *   status   Report applied/pending migrations and any checksum drift. Read-only.
 *   verify   Run capability assertions only — no schema changes.
 *   replay   Re-run the migrate flow against an already-migrated database and prove it is
 *            a no-op (zero new/changed `jpx_meta.schema_migrations` rows), then re-check
 *            capability assertions.
 *
 * Connection resolution: `--database-url` wins, then `DATABASE_MIGRATION_URL` (preferred),
 * then `DATABASE_URL` (fallback). `DATABASE_POOL_MODE=transaction` is rejected outright for
 * every command — Supavisor's transaction-mode pooler does not reliably support
 * session-level advisory locks or DDL (see resolveDatabaseUrl below). This script's env
 * reading is local/independent of `services/api/src/config.ts`'s application config
 * resolution, but intentionally mirrors the same canonical variable names (plan Task 3).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  closePostgresClient,
  createPostgresClient,
  type PostgresClient,
} from "../packages/persistence-postgres/src/client.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MIGRATIONS_DIR = path.join(repoRoot, "infra", "supabase", "migrations");

/** A single reserved physical connection — see withAdvisoryLock() for why this matters. */
type ReservedSql = Awaited<ReturnType<PostgresClient["reserve"]>>;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class MigrationConfigError extends Error {}
export class MigrationValidationError extends Error {}
export class ChecksumDriftError extends Error {}
export class CapabilityAssertionError extends Error {}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Migration discovery + sequence validation
// ---------------------------------------------------------------------------

export type MigrationFile = {
  filename: string;
  prefix: number;
  fullPath: string;
  sqlText: string;
  sha256: string;
};

const FILENAME_PATTERN = /^(\d{4})_[a-z0-9][a-z0-9_]*\.sql$/;

/**
 * Pure sequence validation, deliberately separated from filesystem/hash I/O so it can be
 * unit-tested directly with a mocked filename list (no throwaway files on disk needed).
 * Requires: every name matches NNNN_description.sql, prefixes are unique, the sequence
 * starts at 0001, and prefixes are contiguous (no gaps) once sorted lexically.
 */
export function validateMigrationSequence(filenames: string[]): { filename: string; prefix: number }[] {
  const parsed = filenames.map((filename) => {
    const match = FILENAME_PATTERN.exec(filename);
    const prefixText = match?.[1];
    if (!prefixText) {
      throw new MigrationValidationError(
        `Migration filename "${filename}" does not match the required pattern ` +
          `NNNN_description.sql (four-digit numeric prefix, lowercase snake_case description).`,
      );
    }
    return { filename, prefix: Number.parseInt(prefixText, 10) };
  });

  const sorted = [...parsed].sort((a, b) => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0));

  const seenPrefixes = new Map<number, string>();
  for (const entry of sorted) {
    const existing = seenPrefixes.get(entry.prefix);
    if (existing) {
      throw new MigrationValidationError(
        `Duplicate migration prefix ${String(entry.prefix).padStart(4, "0")}: used by both ` +
          `"${existing}" and "${entry.filename}". Migration prefixes must be unique.`,
      );
    }
    seenPrefixes.set(entry.prefix, entry.filename);
  }

  const first = sorted[0];
  if (first && first.prefix !== 1) {
    throw new MigrationValidationError(
      `Migration sequence must start at 0001; first discovered migration is "${first.filename}" ` +
        `(prefix ${String(first.prefix).padStart(4, "0")}).`,
    );
  }
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (!prev || !curr) continue;
    if (curr.prefix !== prev.prefix + 1) {
      throw new MigrationValidationError(
        `Gap in migration prefixes between "${prev.filename}" (${String(prev.prefix).padStart(4, "0")}) ` +
          `and "${curr.filename}" (${String(curr.prefix).padStart(4, "0")}); prefixes must be contiguous.`,
      );
    }
  }

  return sorted;
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function discoverMigrationFiles(dir: string): MigrationFile[] {
  const entries = fs.readdirSync(dir).filter((name) => name.endsWith(".sql"));
  const validated = validateMigrationSequence(entries);
  return validated.map(({ filename, prefix }) => {
    const fullPath = path.join(dir, filename);
    const bytes = fs.readFileSync(fullPath);
    return { filename, prefix, fullPath, sqlText: bytes.toString("utf8"), sha256: sha256Hex(bytes) };
  });
}

// ---------------------------------------------------------------------------
// Connection resolution
// ---------------------------------------------------------------------------

type ResolvedConnection = { url: string; source: string };

/**
 * `DATABASE_POOL_MODE=transaction` is rejected unconditionally, regardless of which URL
 * source wins: Supavisor's transaction-mode pooler multiplexes statements across physical
 * connections between round trips, so a session-scoped `pg_advisory_lock` (held across
 * multiple separate transactions here) and raw DDL are both unreliable through it. Callers
 * needing to migrate through a pooled provider must point DATABASE_MIGRATION_URL at a
 * direct or session-mode endpoint instead.
 */
export function resolveDatabaseUrl(cliUrl: string | undefined, env: NodeJS.ProcessEnv): ResolvedConnection {
  const poolMode = env.DATABASE_POOL_MODE?.trim();
  if (poolMode === "transaction") {
    throw new MigrationConfigError(
      "DATABASE_POOL_MODE=transaction is set, but the migration runner requires a direct or " +
        "session-mode connection — Supavisor's transaction-mode pooler does not reliably support " +
        "session-level advisory locks or DDL. Point DATABASE_MIGRATION_URL at a direct (port 5432) " +
        "or session-mode Postgres URL, or unset/change DATABASE_POOL_MODE.",
    );
  }

  const trimmedCli = cliUrl?.trim();
  if (trimmedCli) return { url: trimmedCli, source: "--database-url" };

  const migrationUrl = env.DATABASE_MIGRATION_URL?.trim();
  if (migrationUrl) return { url: migrationUrl, source: "DATABASE_MIGRATION_URL" };

  const fallbackUrl = env.DATABASE_URL?.trim();
  if (fallbackUrl) return { url: fallbackUrl, source: "DATABASE_URL (fallback)" };

  throw new MigrationConfigError(
    "No database URL configured. Pass --database-url <url>, or set DATABASE_MIGRATION_URL " +
      "(preferred) or DATABASE_URL (fallback, only valid when DATABASE_POOL_MODE is direct/session).",
  );
}

// ---------------------------------------------------------------------------
// Advisory lock
// ---------------------------------------------------------------------------

/**
 * One fixed advisory lock key for the entire migration session, shared by every environment
 * (local, CI, managed providers) so concurrent migration attempts against the same database
 * serialize instead of racing on DDL.
 *
 * Derived once from SHA-256("jpx-accounting-migrations"): take the first 8 bytes as a
 * big-endian unsigned 64-bit integer, then wrap into Postgres's signed bigint range (this
 * particular hash already falls inside it, so no wraparound was actually needed). Recompute
 * with:
 *   node -e "const h=require('crypto').createHash('sha256').update('jpx-accounting-migrations').digest();
 *            const u=h.readBigUInt64BE(0); console.log(u > (2n**63n-1n) ? u-(2n**64n) : u)"
 * -> 624442838906982426n. Hardcoded (not recomputed at runtime) so the key is stable and
 * auditable independent of Node's crypto module at call time.
 */
export const MIGRATION_ADVISORY_LOCK_KEY = 624442838906982426n;

/**
 * Reserves a single physical connection for the whole migration session. This matters
 * because `pg_advisory_lock` (the session-scoped variant, as opposed to
 * `pg_advisory_xact_lock`) is held for the lifetime of the CONNECTION, not a transaction —
 * and each migration file is applied in its OWN transaction (plan requirement), so the lock
 * must survive multiple sequential BEGIN/COMMIT round trips (see runInTransaction below). A
 * plain pooled client would risk different statements landing on different physical
 * connections. `postgres-js`'s `reserve()` is exactly the documented mechanism for this
 * (advisory locks / LISTEN).
 */
async function withAdvisoryLock<T>(client: PostgresClient, fn: (reserved: ReservedSql) => Promise<T>): Promise<T> {
  const reserved = await client.reserve();
  // Passed as a string + explicit ::bigint cast, not a raw JS bigint: postgres-js 3.4.5's
  // published types omit bigint from its serializable-parameter union (even though the
  // runtime driver supports it) — this keeps the call type-safe without an `as any` escape.
  const lockKey = MIGRATION_ADVISORY_LOCK_KEY.toString();
  try {
    await reserved`select pg_advisory_lock(${lockKey}::bigint)`;
    try {
      return await fn(reserved);
    } finally {
      await reserved`select pg_advisory_unlock(${lockKey}::bigint)`;
    }
  } finally {
    reserved.release();
  }
}

// ---------------------------------------------------------------------------
// Migration history table + apply logic
// ---------------------------------------------------------------------------

/**
 * `postgres-js`'s `reserve()` returns a connection wrapper that intentionally does NOT expose
 * `.begin()` at runtime (only the top-level pool client does — see the driver's own
 * UNSAFE_TRANSACTION guidance: "use sql.begin(...) or max: 1" to keep a transaction pinned
 * to one connection). Since we already pin every statement to one physical connection via
 * `reserve()` for the advisory lock's sake, transactions here are just raw BEGIN/COMMIT/
 * ROLLBACK issued on that same reserved connection.
 */
async function runInTransaction<T>(reserved: ReservedSql, fn: () => Promise<T>): Promise<T> {
  await reserved.unsafe("begin");
  try {
    const result = await fn();
    await reserved.unsafe("commit");
    return result;
  } catch (error) {
    try {
      await reserved.unsafe("rollback");
    } catch {
      // The original error is more useful than a rollback failure (usually just means the
      // connection already dropped) — swallow it and rethrow below.
    }
    throw error;
  }
}

async function ensureMigrationHistoryTable(sql: ReservedSql): Promise<void> {
  await sql.unsafe(`
    create schema if not exists jpx_meta;
    create table if not exists jpx_meta.schema_migrations (
      filename text primary key,
      sha256 text not null,
      applied_at timestamptz not null default clock_timestamp()
    );
  `);
}

async function tableExists(sql: PostgresClient | ReservedSql, schema: string, table: string): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    select to_regclass(${`${schema}.${table}`}) is not null as exists
  `;
  return rows[0]?.exists ?? false;
}

type HistoryRow = { filename: string; sha256: string; appliedAt: string };

async function snapshotHistory(sql: PostgresClient | ReservedSql): Promise<HistoryRow[]> {
  if (!(await tableExists(sql, "jpx_meta", "schema_migrations"))) return [];
  const rows = await sql<{ filename: string; sha256: string; applied_at: string }[]>`
    select filename, sha256, applied_at::text as applied_at
    from jpx_meta.schema_migrations
    order by filename
  `;
  return rows.map((row) => ({ filename: row.filename, sha256: row.sha256, appliedAt: row.applied_at }));
}

/**
 * `ledger.events` existing while `jpx_meta.schema_migrations` is empty means this is a
 * pre-tooling database (bootstrap case), not a fresh one — purely informational for the log
 * line below. The APPLY LOGIC itself needs no separate branch: 0001-0009 are all written
 * idempotently (`IF NOT EXISTS` / exception-guarded `DO` blocks — verified by reading them),
 * so "pending = every discovered file" safely replays the full set on an existing schema
 * exactly as it would create one from scratch, and each file's checksum is then baselined
 * into history as it is (re-)applied.
 */
async function detectPreexistingSchema(sql: ReservedSql): Promise<boolean> {
  return tableExists(sql, "ledger", "events");
}

type ApplyResult = { applied: string[]; alreadyApplied: string[] };

async function applyPendingMigrations(reserved: ReservedSql, files: MigrationFile[]): Promise<ApplyResult> {
  const applied: string[] = [];
  const alreadyApplied: string[] = [];

  const appliedRows = await snapshotHistory(reserved);
  const appliedMap = new Map(appliedRows.map((row) => [row.filename, row]));

  if (appliedMap.size === 0) {
    const preexisting = await detectPreexistingSchema(reserved);
    console.log(
      preexisting
        ? "jpx_meta.schema_migrations is empty but ledger.events already exists — bootstrapping an " +
            "existing pre-tooling database: replaying all discovered migrations (idempotent by design) " +
            "and baselining their checksums."
        : "No migration history found — fresh database, applying all discovered migrations.",
    );
  }

  for (const file of files) {
    const record = appliedMap.get(file.filename);
    if (record) {
      if (record.sha256 !== file.sha256) {
        throw new ChecksumDriftError(
          `Checksum drift detected for "${file.filename}": the applied migration was recorded with ` +
            `SHA-256 ${record.sha256}, but the on-disk file now hashes to ${file.sha256}. Historical ` +
            `migrations must never be edited after being applied — revert the file or add a new ` +
            `migration instead. Aborting before applying any further migrations.`,
        );
      }
      alreadyApplied.push(file.filename);
      continue;
    }

    await runInTransaction(reserved, async () => {
      await reserved.unsafe(file.sqlText);
      await reserved`
        insert into jpx_meta.schema_migrations (filename, sha256)
        values (${file.filename}, ${file.sha256})
      `;
    });
    applied.push(file.filename);
    console.log(`Applied ${file.filename}`);
  }

  return { applied, alreadyApplied };
}

// ---------------------------------------------------------------------------
// Capability assertions
// ---------------------------------------------------------------------------

type AssertionResult = { name: string; pass: boolean; detail: string; remediation?: string };

async function safeCheck(name: string, fn: () => Promise<AssertionResult>): Promise<AssertionResult> {
  try {
    return await fn();
  } catch (error) {
    return {
      name,
      pass: false,
      detail: `Assertion check raised an error: ${errorMessage(error)}`,
      remediation: "Ensure migrations have been applied (run the `migrate` command first).",
    };
  }
}

async function getColumnInfo(
  sql: PostgresClient | ReservedSql,
  schema: string,
  table: string,
  column: string,
): Promise<{ data_type: string; column_default: string | null; is_identity: string } | null> {
  const rows = await sql<{ data_type: string; column_default: string | null; is_identity: string }[]>`
    select data_type, column_default, is_identity
    from information_schema.columns
    where table_schema = ${schema} and table_name = ${table} and column_name = ${column}
  `;
  return rows[0] ?? null;
}

async function constraintExists(
  sql: PostgresClient | ReservedSql,
  schema: string,
  table: string,
  conname: string,
  contype: string,
): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    select true as exists
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = ${schema} and t.relname = ${table} and c.conname = ${conname} and c.contype = ${contype}
  `;
  return rows.length > 0;
}

async function primaryKeyColumns(sql: PostgresClient | ReservedSql, schema: string, table: string): Promise<string[]> {
  const rows = await sql<{ attname: string }[]>`
    select a.attname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join unnest(c.conkey) with ordinality as k(attnum, ord) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where n.nspname = ${schema} and t.relname = ${table} and c.contype = 'p'
    order by k.ord
  `;
  return rows.map((row) => row.attname);
}

async function indexExists(
  sql: PostgresClient | ReservedSql,
  schema: string,
  table: string,
  indexName: string,
): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    select true as exists
    from pg_indexes
    where schemaname = ${schema} and tablename = ${table} and indexname = ${indexName}
  `;
  return rows.length > 0;
}

/**
 * Capability assertions run after `migrate` (and on demand via `verify`/`replay`). Each
 * check queries information_schema/pg_catalog for the exact names introduced by migrations
 * 0005-0009 (read from the actual SQL files, not recalled) rather than probing behavior, so
 * a failure names precisely which migration is missing or which provider capability is
 * absent.
 */
export async function runCapabilityAssertions(sql: PostgresClient | ReservedSql): Promise<AssertionResult[]> {
  const results: AssertionResult[] = [];

  results.push(
    await safeCheck("writable-primary", async () => {
      const rows = await sql<{ in_recovery: boolean }[]>`select pg_is_in_recovery() as in_recovery`;
      const inRecovery = rows[0]?.in_recovery ?? true;
      return {
        name: "writable-primary",
        pass: !inRecovery,
        detail: inRecovery ? "pg_is_in_recovery() = true (read replica / standby)." : "Server is a writable primary.",
        ...(inRecovery
          ? { remediation: "Point the migration URL at the primary/writer endpoint, not a read replica." }
          : {}),
      };
    }),
  );

  results.push(
    await safeCheck("server-version", async () => {
      const rows = await sql<{ version_num: string }[]>`
        select current_setting('server_version_num') as version_num
      `;
      const versionNum = Number.parseInt(rows[0]?.version_num ?? "0", 10);
      const major = Math.floor(versionNum / 10000);
      const pass = major >= 15 && major <= 17;
      return {
        name: "server-version",
        pass,
        detail: `PostgreSQL major version ${major} (server_version_num=${versionNum}).`,
        ...(pass
          ? {}
          : { remediation: "Use PostgreSQL 15, 16, or 17 (pgvector/pgvector:0.8.5-pg17-bookworm locally)." }),
      };
    }),
  );

  results.push(
    await safeCheck("vector-extension", async () => {
      const extRows = await sql<{ extversion: string }[]>`
        select extversion from pg_extension where extname = 'vector'
      `;
      const extVersion = extRows[0]?.extversion;
      if (!extVersion) {
        return {
          name: "vector-extension",
          pass: false,
          detail: "The 'vector' extension is not installed.",
          remediation:
            "Run `create extension vector;` (pgvector >= 0.7 for halfvec) — see migration 0003_pgvector.sql.",
        };
      }
      let halfvecOk = false;
      try {
        await sql`select '[1,2,3]'::halfvec(3)`;
        halfvecOk = true;
      } catch {
        halfvecOk = false;
      }
      const amRows = await sql<{ amname: string }[]>`select amname from pg_am where amname = 'hnsw'`;
      const hnswOk = amRows.length > 0;
      const pass = halfvecOk && hnswOk;
      return {
        name: "vector-extension",
        pass,
        detail:
          `vector extension ${extVersion} installed; halfvec ${halfvecOk ? "supported" : "NOT supported"}; ` +
          `HNSW access method ${hnswOk ? "available" : "NOT available"}.`,
        ...(pass
          ? {}
          : {
              remediation:
                "Upgrade to pgvector >= 0.7 (0.8.5 is the pinned local image) — halfvec + HNSW are required by knowledge.documents.",
            }),
      };
    }),
  );

  results.push(
    await safeCheck("ledger-events-id-text", async () => {
      const info = await getColumnInfo(sql, "ledger", "events", "id");
      const pass = info?.data_type === "text";
      return {
        name: "ledger-events-id-text",
        pass,
        detail: info ? `ledger.events.id data_type = ${info.data_type}.` : "ledger.events.id column not found.",
        ...(pass ? {} : { remediation: "Apply migration 0005_events_id_text.sql." }),
      };
    }),
  );

  results.push(
    await safeCheck("ledger-events-created-at-clock-timestamp", async () => {
      const info = await getColumnInfo(sql, "ledger", "events", "created_at");
      const pass = Boolean(info?.column_default?.includes("clock_timestamp()"));
      return {
        name: "ledger-events-created-at-clock-timestamp",
        pass,
        detail: info
          ? `ledger.events.created_at column_default = ${info.column_default ?? "null"}.`
          : "ledger.events.created_at column not found.",
        ...(pass
          ? {}
          : { remediation: "Apply migration 0005_events_id_text.sql (sets created_at default to clock_timestamp())." }),
      };
    }),
  );

  results.push(
    await safeCheck("ledger-events-seq-identity", async () => {
      const info = await getColumnInfo(sql, "ledger", "events", "seq");
      const pass = info?.is_identity === "YES";
      return {
        name: "ledger-events-seq-identity",
        pass,
        detail: info ? `ledger.events.seq is_identity = ${info.is_identity}.` : "ledger.events.seq column not found.",
        ...(pass ? {} : { remediation: "Apply migration 0006_chain_serialization.sql." }),
      };
    }),
  );

  results.push(
    await safeCheck("chain-fork-constraint", async () => {
      const pass = await constraintExists(sql, "ledger", "events", "ledger_events_chain_fork_key", "u");
      return {
        name: "chain-fork-constraint",
        pass,
        detail: pass
          ? "UNIQUE constraint ledger_events_chain_fork_key is present on ledger.events."
          : "ledger_events_chain_fork_key not found on ledger.events.",
        ...(pass ? {} : { remediation: "Apply migration 0006_chain_serialization.sql." }),
      };
    }),
  );

  results.push(
    await safeCheck("knowledge-documents-tenant-pk", async () => {
      const columns = await primaryKeyColumns(sql, "knowledge", "documents");
      const pass = JSON.stringify(columns) === JSON.stringify(["organization_id", "workspace_id", "id"]);
      return {
        name: "knowledge-documents-tenant-pk",
        pass,
        detail: `knowledge.documents primary key columns: (${columns.join(", ") || "none"}).`,
        ...(pass ? {} : { remediation: "Apply migration 0007_knowledge_tenant_pk.sql." }),
      };
    }),
  );

  results.push(
    await safeCheck("evidence-dedupe-index", async () => {
      const pass = await indexExists(sql, "ledger", "evidence_objects", "ledger_evidence_objects_dedupe_idx");
      return {
        name: "evidence-dedupe-index",
        pass,
        detail: pass
          ? "Index ledger_evidence_objects_dedupe_idx is present on ledger.evidence_objects."
          : "ledger_evidence_objects_dedupe_idx not found on ledger.evidence_objects.",
        ...(pass ? {} : { remediation: "Apply migration 0008_evidence_dedupe_index.sql." }),
      };
    }),
  );

  results.push(
    await safeCheck("manual-vouchers-schema", async () => {
      const originColumn = await getColumnInfo(sql, "ledger", "vouchers", "origin");
      const nullableRows = await sql<{ is_nullable: string }[]>`
        select is_nullable from information_schema.columns
        where table_schema = 'ledger' and table_name = 'vouchers' and column_name = 'evidence_packet_id'
      `;
      const packetNullable = nullableRows[0]?.is_nullable === "YES";
      const hasOriginCheck = await constraintExists(sql, "ledger", "vouchers", "ledger_vouchers_origin_check", "c");
      const pass = Boolean(originColumn) && packetNullable && hasOriginCheck;
      return {
        name: "manual-vouchers-schema",
        pass,
        detail: pass
          ? "ledger.vouchers.evidence_packet_id is nullable and origin + its CHECK constraint are present."
          : `ledger.vouchers evidence_packet_id nullable=${packetNullable}, origin column=${Boolean(originColumn)}, origin check=${hasOriginCheck}.`,
        ...(pass ? {} : { remediation: "Apply migration 0009_manual_vouchers.sql." }),
      };
    }),
  );

  return results;
}

function formatAssertions(results: AssertionResult[]): string {
  return results
    .map((result) => {
      const status = result.pass ? "PASS" : "FAIL";
      const fix = !result.pass && result.remediation ? ` (fix: ${result.remediation})` : "";
      return `  [${status}] ${result.name} — ${result.detail}${fix}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// CLI commands
// ---------------------------------------------------------------------------

async function cmdMigrate(url: string): Promise<void> {
  const files = discoverMigrationFiles(MIGRATIONS_DIR);
  const client = createPostgresClient({ connectionString: url, max: 1 });
  try {
    await withAdvisoryLock(client, async (reserved) => {
      await ensureMigrationHistoryTable(reserved);
      const { applied, alreadyApplied } = await applyPendingMigrations(reserved, files);
      console.log(
        applied.length > 0
          ? `Applied ${applied.length} migration(s): ${applied.join(", ")}.`
          : `No pending migrations (${alreadyApplied.length} already applied).`,
      );

      const assertions = await runCapabilityAssertions(reserved);
      console.log(`Capability assertions:\n${formatAssertions(assertions)}`);
      const failed = assertions.filter((result) => !result.pass);
      if (failed.length > 0) {
        throw new CapabilityAssertionError(
          `${failed.length} capability assertion(s) failed after migration:\n${formatAssertions(failed)}`,
        );
      }
    });
  } finally {
    await closePostgresClient(client);
  }
}

async function cmdStatus(url: string): Promise<void> {
  const files = discoverMigrationFiles(MIGRATIONS_DIR);
  const client = createPostgresClient({ connectionString: url, max: 1 });
  try {
    const historyExists = await tableExists(client, "jpx_meta", "schema_migrations");
    const appliedRows = historyExists ? await snapshotHistory(client) : [];
    const appliedMap = new Map(appliedRows.map((row) => [row.filename, row]));

    let driftCount = 0;
    let pendingCount = 0;
    for (const file of files) {
      const record = appliedMap.get(file.filename);
      if (!record) {
        pendingCount++;
        console.log(`  [pending] ${file.filename}`);
      } else if (record.sha256 !== file.sha256) {
        driftCount++;
        console.log(`  [DRIFT]   ${file.filename} — recorded ${record.sha256}, on-disk ${file.sha256}`);
      } else {
        console.log(`  [applied] ${file.filename} (${record.appliedAt})`);
      }
    }
    console.log(
      `${files.length} migration(s) total, ${files.length - pendingCount - driftCount} applied, ` +
        `${pendingCount} pending, ${driftCount} drifted.`,
    );

    if (driftCount > 0) {
      console.error(
        `${driftCount} migration(s) show checksum drift — run \`verify\`/\`migrate\` for the full error, do NOT ignore.`,
      );
      process.exitCode = 1;
    }
  } finally {
    await closePostgresClient(client);
  }
}

async function cmdVerify(url: string): Promise<void> {
  const client = createPostgresClient({ connectionString: url, max: 1 });
  try {
    const assertions = await runCapabilityAssertions(client);
    console.log(`Capability assertions:\n${formatAssertions(assertions)}`);
    const failed = assertions.filter((result) => !result.pass);
    if (failed.length > 0) {
      throw new CapabilityAssertionError(
        `${failed.length} capability assertion(s) failed:\n${formatAssertions(failed)}`,
      );
    }
    console.log("All capability assertions passed.");
  } finally {
    await closePostgresClient(client);
  }
}

/**
 * Proves the migrate flow is idempotent against an already-migrated database: re-running it
 * must apply zero files and leave `jpx_meta.schema_migrations` byte-for-byte unchanged.
 * "No schema diff" is proxied by (a) the zero-new-rows history check and (b) re-running the
 * same capability assertions used post-migrate, rather than a full catalog dump/diff, which
 * is out of scope for this CLI.
 */
async function cmdReplay(url: string): Promise<void> {
  const files = discoverMigrationFiles(MIGRATIONS_DIR);
  const client = createPostgresClient({ connectionString: url, max: 1 });
  try {
    const before = await snapshotHistory(client);

    await withAdvisoryLock(client, async (reserved) => {
      await ensureMigrationHistoryTable(reserved);
      const { applied } = await applyPendingMigrations(reserved, files);
      if (applied.length > 0) {
        throw new Error(
          `Replay check expected zero pending migrations but applied ${applied.length}: ` +
            `${applied.join(", ")}. The database was not fully migrated before calling \`replay\` — ` +
            "run `migrate` first.",
        );
      }
    });

    const after = await snapshotHistory(client);
    if (after.length !== before.length) {
      throw new Error(
        `Replay is not a no-op: jpx_meta.schema_migrations row count changed from ${before.length} to ${after.length}.`,
      );
    }
    for (let i = 0; i < before.length; i++) {
      const beforeRow = before[i];
      const afterRow = after[i];
      if (
        !beforeRow ||
        !afterRow ||
        beforeRow.filename !== afterRow.filename ||
        beforeRow.sha256 !== afterRow.sha256 ||
        beforeRow.appliedAt !== afterRow.appliedAt
      ) {
        throw new Error(`Replay is not a no-op: migration history row for "${beforeRow?.filename ?? "?"}" changed.`);
      }
    }

    const assertions = await runCapabilityAssertions(client);
    const failed = assertions.filter((result) => !result.pass);
    if (failed.length > 0) {
      throw new CapabilityAssertionError(`Replay capability assertions failed:\n${formatAssertions(failed)}`);
    }

    console.log(
      `Replay confirmed no-op: ${after.length} migration history row(s) unchanged, ` +
        "all capability assertions still pass.",
    );
  } finally {
    await closePostgresClient(client);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const COMMANDS = ["migrate", "status", "verify", "replay"] as const;
type Command = (typeof COMMANDS)[number];

function isCommand(value: string | undefined): value is Command {
  return value !== undefined && (COMMANDS as readonly string[]).includes(value);
}

function parseArgs(argv: string[]): { command: string | undefined; databaseUrl: string | undefined } {
  const args = argv.slice(2);
  let databaseUrl: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--database-url") {
      databaseUrl = args[i + 1];
      i++;
    } else if (arg !== undefined) {
      positional.push(arg);
    }
  }
  return { command: positional[0], databaseUrl };
}

function printUsage(): void {
  console.error(
    [
      "Usage: tsx scripts/db-migrations.mts <command> [--database-url <url>]",
      "",
      "Commands:",
      "  migrate   Apply all pending migrations under a fixed advisory lock, then verify capabilities.",
      "  status    Report applied/pending migrations and any checksum drift. Read-only.",
      "  verify    Run capability assertions only — no schema changes.",
      "  replay    Re-run the migrate flow and prove it is a no-op (idempotency check).",
      "",
      "Connection URL resolution order: --database-url, then DATABASE_MIGRATION_URL, then " +
        "DATABASE_URL (fallback). DATABASE_POOL_MODE=transaction is rejected for every command.",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const { command, databaseUrl: cliUrl } = parseArgs(process.argv);
  if (!isCommand(command)) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const { url, source } = resolveDatabaseUrl(cliUrl, process.env);
  // Never log the URL itself — it may carry credentials.
  console.log(`jpx-accounting migration runner: command=${command}, connection source=${source}`);

  switch (command) {
    case "migrate":
      await cmdMigrate(url);
      break;
    case "status":
      await cmdStatus(url);
      break;
    case "verify":
      await cmdVerify(url);
      break;
    case "replay":
      await cmdReplay(url);
      break;
  }
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  // Avoid top-level await so this module can be imported by integration tests under
  // tsx's CJS transform path (node:test), not only as a CLI entrypoint.
  main().catch((error) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}
