/**
 * Strict PostgreSQL integration-test harness (Local Postgres Dev DB plan, Task 4).
 *
 * URL resolution (first non-empty wins):
 *   DATABASE_TEST_URL → DATABASE_URL → SUPABASE_DB_URL (legacy)
 *
 * The resolved database name MUST start with `jpx_test_` — disposable test DBs only.
 * This helper never CREATE/DROP DATABASE; `pnpm db:test` / the caller owns lifecycle.
 * When `DATABASE_TEST_URL` is set, callers must already have provisioned that DB.
 *
 * Gating:
 *   - JPX_REQUIRE_DATABASE_TESTS=true → missing/unreachable URL throws before tests run
 *   - unset → silent skip when no URL is configured
 */
import { randomUUID } from "node:crypto";

import { closePostgresClient, createPostgresClient, type PostgresClient } from "@jpx-accounting/persistence-postgres";

export const TEST_DATABASE_NAME_PREFIX = "jpx_test_";

export class PostgresTestConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresTestConfigError";
  }
}

export type PostgresTestNamespace = {
  /** Opaque UUID for this run/case — use in knowledge doc ids, etc. */
  runId: string;
  organizationId: string;
  workspaceId: string;
};

export type ResolvedPostgresTestUrl = {
  url: string;
  source: "DATABASE_TEST_URL" | "DATABASE_URL" | "SUPABASE_DB_URL";
};

export type PostgresIntegrationGate =
  | { skip: true }
  | { skip: false; url: string; source: ResolvedPostgresTestUrl["source"]; databaseName: string };

export type PostgresTestContext = {
  url: string;
  databaseName: string;
  source: ResolvedPostgresTestUrl["source"];
  /** Shared primary client for the suite — do not close between tests. */
  client: PostgresClient;
  createNamespace(label?: string): PostgresTestNamespace;
  /** Separate postgres-js client for real advisory-lock / concurrency races. */
  createExtraClient(): PostgresClient;
  cleanupOrganization(organizationId: string): Promise<void>;
  close(): Promise<void>;
};

function trimEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function isDatabaseTestsRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return trimEnv(env.JPX_REQUIRE_DATABASE_TESTS)?.toLowerCase() === "true";
}

/**
 * Resolve the integration-test database URL without validating the database name.
 * Prefer an explicit disposable test URL over the runtime / legacy aliases.
 */
export function resolvePostgresTestDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedPostgresTestUrl | undefined {
  const testUrl = trimEnv(env.DATABASE_TEST_URL);
  if (testUrl) return { url: testUrl, source: "DATABASE_TEST_URL" };
  const databaseUrl = trimEnv(env.DATABASE_URL);
  if (databaseUrl) return { url: databaseUrl, source: "DATABASE_URL" };
  const legacy = trimEnv(env.SUPABASE_DB_URL);
  if (legacy) return { url: legacy, source: "SUPABASE_DB_URL" };
  return undefined;
}

/** Extract the database name from a postgres URL (pathname without leading slash). */
export function extractDatabaseName(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PostgresTestConfigError(`Invalid PostgreSQL URL (could not parse): <redacted>`);
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!name) {
    throw new PostgresTestConfigError(
      "PostgreSQL URL has an empty database name — integration tests require a named database " +
        `with prefix "${TEST_DATABASE_NAME_PREFIX}".`,
    );
  }
  return name;
}

/** Reject any database whose name does not start with `jpx_test_`. */
export function assertTestDatabaseName(url: string): string {
  const databaseName = extractDatabaseName(url);
  if (!databaseName.startsWith(TEST_DATABASE_NAME_PREFIX)) {
    throw new PostgresTestConfigError(
      `Integration tests refuse database "${databaseName}". The database name must start with ` +
        `"${TEST_DATABASE_NAME_PREFIX}" (disposable test databases only). ` +
        `Use \`pnpm db:test\` or point DATABASE_TEST_URL at a provisioned ${TEST_DATABASE_NAME_PREFIX}* database.`,
    );
  }
  return databaseName;
}

export function createPostgresTestNamespace(label?: string): PostgresTestNamespace {
  const runId = randomUUID();
  const suffix = runId.replace(/-/g, "");
  const labelPart = label
    ? label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 24)
    : "";
  const orgTail = labelPart ? `${labelPart}_${suffix.slice(0, 12)}` : suffix.slice(0, 16);
  return {
    runId,
    organizationId: `org_test_${orgTail}`,
    workspaceId: `ws_${suffix.slice(0, 12)}`,
  };
}

/**
 * FK-safe row cleanup for one organization across migrations 0001–0008 tables.
 * Children before parents; projections + knowledge included even when unused by a given test.
 */
export async function cleanupPostgresTestOrganization(client: PostgresClient, organizationId: string): Promise<void> {
  await client`DELETE FROM ledger.review_tasks WHERE organization_id = ${organizationId}`;
  await client`DELETE FROM ledger.vouchers WHERE organization_id = ${organizationId}`;
  await client`DELETE FROM ledger.evidence_packet_items
    WHERE evidence_packet_id IN (
      SELECT id FROM ledger.evidence_packets WHERE organization_id = ${organizationId}
    )`;
  await client`DELETE FROM ledger.evidence_packets WHERE organization_id = ${organizationId}`;
  await client`DELETE FROM ledger.evidence_objects WHERE organization_id = ${organizationId}`;
  await client`DELETE FROM ledger.events WHERE organization_id = ${organizationId}`;
  await client`DELETE FROM ledger.compliance_alerts WHERE organization_id = ${organizationId}`;
  await client`DELETE FROM ledger.assistant_sessions WHERE organization_id = ${organizationId}`;
  await client`DELETE FROM ledger.organization_settings WHERE organization_id = ${organizationId}`;
  await client`DELETE FROM knowledge.documents WHERE organization_id = ${organizationId}`;
  await client`DELETE FROM projections.journal_entries WHERE organization_id = ${organizationId}`;
  await client`DELETE FROM projections.account_balances WHERE organization_id = ${organizationId}`;
  await client`DELETE FROM projections.vat_summary WHERE organization_id = ${organizationId}`;
}

export async function probePostgresReachable(url: string): Promise<void> {
  const client = createPostgresClient({
    connectionString: url,
    max: 1,
    applicationName: "jpx-accounting-integration-probe",
  });
  try {
    await client`SELECT 1`;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new PostgresTestConfigError(
      `PostgreSQL at the configured test URL is unreachable (${detail}). ` +
        `Run \`pnpm db:test\` (Compose) or provision DATABASE_TEST_URL.`,
    );
  } finally {
    await closePostgresClient(client).catch(() => undefined);
  }
}

/**
 * Resolve + validate the test DB gate synchronously before declaring tests so
 * `JPX_REQUIRE_DATABASE_TESTS=true` with a missing URL throws before any `# SKIP`
 * can mask it. Reachability is probed in `openPostgresTestContext` / suite `before`
 * (tsx's CJS transform for `node:test` cannot load top-level await).
 */
export function preparePostgresIntegrationGate(env: NodeJS.ProcessEnv = process.env): PostgresIntegrationGate {
  const required = isDatabaseTestsRequired(env);
  const resolved = resolvePostgresTestDatabaseUrl(env);

  if (!resolved) {
    if (required) {
      throw new PostgresTestConfigError(
        "JPX_REQUIRE_DATABASE_TESTS=true but no database URL is configured. " +
          "Set DATABASE_TEST_URL (preferred), DATABASE_URL, or legacy SUPABASE_DB_URL " +
          `to a disposable database named ${TEST_DATABASE_NAME_PREFIX}*.`,
      );
    }
    return { skip: true };
  }

  const databaseName = assertTestDatabaseName(resolved.url);

  return {
    skip: false,
    url: resolved.url,
    source: resolved.source,
    databaseName,
  };
}

export async function openPostgresTestContext(
  gate: Extract<PostgresIntegrationGate, { skip: false }>,
  options: { requireReachable?: boolean } = {},
): Promise<PostgresTestContext> {
  if (options.requireReachable ?? isDatabaseTestsRequired()) {
    await probePostgresReachable(gate.url);
  }

  const client = createPostgresClient({
    connectionString: gate.url,
    max: 10,
    applicationName: "jpx-accounting-integration",
  });
  const extraClients = new Set<PostgresClient>();

  return {
    url: gate.url,
    databaseName: gate.databaseName,
    source: gate.source,
    client,
    createNamespace(label) {
      return createPostgresTestNamespace(label);
    },
    createExtraClient() {
      const extra = createPostgresClient({
        connectionString: gate.url,
        max: 2,
        applicationName: "jpx-accounting-integration-racer",
      });
      extraClients.add(extra);
      return extra;
    },
    async cleanupOrganization(organizationId: string) {
      await cleanupPostgresTestOrganization(client, organizationId);
    },
    async close() {
      for (const extra of extraClients) {
        await closePostgresClient(extra).catch(() => undefined);
      }
      extraClients.clear();
      await closePostgresClient(client).catch(() => undefined);
    },
  };
}
