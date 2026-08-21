/**
 * Schema / capability contract against a migrated `jpx_test_*` database
 * (Local Postgres Dev DB plan, Task 5).
 *
 * Mirrors `scripts/db-migrations.mts` `verify` assertions as node:test checks
 * so `pnpm db:test` / `pnpm test:integration` fail closed when the catalog
 * drifts from migrations 0001–0009.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { discoverMigrationFiles, MIGRATIONS_DIR, runCapabilityAssertions } from "../../scripts/db-migrations.mts";
import {
  openPostgresTestContext,
  preparePostgresIntegrationGate,
  type PostgresTestContext,
} from "./helpers/postgres-test-context";

const gate = preparePostgresIntegrationGate();
const skip = gate.skip;

let ctx: PostgresTestContext | undefined;

test.before(async () => {
  if (!gate.skip) {
    ctx = await openPostgresTestContext(gate);
  }
});

test.after(async () => {
  await ctx?.close();
  ctx = undefined;
});

function requireCtx(): PostgresTestContext {
  if (!ctx) {
    throw new Error("Postgres test context was not opened — gate.skip should have skipped this test");
  }
  return ctx;
}

test("migration history records every checked-in migration with matching checksums", { skip }, async () => {
  const client = requireCtx().client;
  const files = discoverMigrationFiles(MIGRATIONS_DIR);
  assert.ok(files.length >= 9, "expected migrations 0001–0009 (or more) on disk");

  const rows = await client<Array<{ filename: string; sha256: string }>>`
    SELECT filename, sha256
    FROM jpx_meta.schema_migrations
    ORDER BY filename ASC
  `;

  const byName = new Map(rows.map((row) => [row.filename, row.sha256]));
  for (const file of files) {
    assert.equal(
      byName.get(file.filename),
      file.sha256,
      `jpx_meta.schema_migrations must record checksum for ${file.filename}`,
    );
  }
  assert.equal(rows.length, files.length, "applied migration count must match discovered files");
});

test(
  "capability assertions match db-migrations verify (PG 15–17, pgvector, chain, tenant PKs, dedupe)",
  { skip },
  async () => {
    const client = requireCtx().client;
    const results = await runCapabilityAssertions(client);
    const failed = results.filter((result) => !result.pass);

    assert.equal(failed.length, 0, failed.map((result) => `[FAIL] ${result.name} — ${result.detail}`).join("\n"));

    const names = new Set(results.map((result) => result.name));
    for (const required of [
      "writable-primary",
      "server-version",
      "vector-extension",
      "ledger-events-id-text",
      "ledger-events-created-at-clock-timestamp",
      "ledger-events-seq-identity",
      "chain-fork-constraint",
      "knowledge-documents-tenant-pk",
      "vouchers-tenant-pk",
      "evidence-dedupe-index",
      "manual-vouchers-schema",
      "draft-voucher-number-index",
      "voucher-intake-evidence",
    ]) {
      assert.ok(names.has(required), `capability assertion "${required}" must run`);
    }
  },
);

test("core ledger / knowledge / projections schemas exist after migrations", { skip }, async () => {
  const client = requireCtx().client;
  const tables = await client<Array<{ schema: string; name: string }>>`
    SELECT table_schema AS schema, table_name AS name
    FROM information_schema.tables
    WHERE table_schema IN ('ledger', 'knowledge', 'projections', 'jpx_meta')
      AND table_type = 'BASE TABLE'
    ORDER BY table_schema, table_name
  `;

  const qualified = new Set(tables.map((row) => `${row.schema}.${row.name}`));
  for (const required of [
    "ledger.events",
    "ledger.evidence_objects",
    "ledger.evidence_packets",
    "ledger.vouchers",
    "ledger.review_tasks",
    "ledger.organization_settings",
    "ledger.compliance_alerts",
    "knowledge.documents",
    "projections.journal_entries",
    "projections.account_balances",
    "projections.vat_summary",
    "jpx_meta.schema_migrations",
  ]) {
    assert.ok(qualified.has(required), `expected table ${required}`);
  }
});

test("knowledge.documents embedding column is halfvec(1536)", { skip }, async () => {
  const client = requireCtx().client;
  const rows = await client<Array<{ formatted: string }>>`
    SELECT format_type(a.atttypid, a.atttypmod) AS formatted
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class cls ON cls.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = cls.relnamespace
    WHERE n.nspname = 'knowledge'
      AND cls.relname = 'documents'
      AND a.attname = 'embedding'
      AND NOT a.attisdropped
  `;
  assert.equal(rows[0]?.formatted, "halfvec(1536)", "embedding must be halfvec(1536) (migration 0003)");
});
