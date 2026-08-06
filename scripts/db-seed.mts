/**
 * Deterministic development seed for the tool-managed `jpx_dev` database
 * (Local Postgres Dev DB plan, Task 7).
 *
 *   tsx scripts/db-seed.mts seed --database-url <url>
 *
 * Seeds exclusively through `PostgresLedgerStore` public methods so the
 * append-only hash chain and human-approval review gate stay intact (the seed
 * leaves the demo voucher in `needs-review`). Idempotency is tracked in
 * `jpx_meta.seed_versions` — re-running the same version is a no-op.
 *
 * Connection resolution: `--database-url` wins, then `DATABASE_URL`.
 * Never reads `DATABASE_TEST_URL` (seed targets the stable dev database only).
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DEFAULT_TENANT_SCOPE } from "../packages/domain/src/tenant.ts";
import {
  closePostgresClient,
  createPostgresClient,
  PostgresLedgerStore,
  type PostgresClient,
} from "../packages/persistence-postgres/src/index.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const SEED_VERSION = "v1";
export const SEED_ORGANIZATION_ID = DEFAULT_TENANT_SCOPE.organizationId;
export const SEED_WORKSPACE_ID = DEFAULT_TENANT_SCOPE.workspaceId;

/** Semantic fixture values asserted after seed — not generated IDs/hashes/timestamps. */
export const SEED_V1_FIXTURES = {
  evidenceTitle: "OpenAI subscription invoice",
  evidenceFilename: "openai-march-2026.pdf",
  evidenceExtractedText: "OpenAI March 2026 subscription invoice",
  actorId: "user_founder",
  organizationName: "JPX Demo AB",
  organizationNumber: "556677-8899",
  addressLine1: "Demogatan 1",
  postalCode: "11122",
  city: "Stockholm",
  contactEmail: "demo@jpx.example",
} as const;

export class SeedConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedConfigError";
  }
}

function parseArgs(argv: string[]): { command: string | undefined; databaseUrl: string | undefined } {
  const args = argv.slice(2);
  let command: string | undefined;
  let databaseUrl: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--database-url") {
      databaseUrl = args[i + 1];
      i += 1;
      continue;
    }
    if (!command && arg && !arg.startsWith("-")) {
      command = arg;
    }
  }
  return { command, databaseUrl };
}

function resolveSeedUrl(cliUrl: string | undefined): string {
  const fromCli = cliUrl?.trim();
  if (fromCli) return fromCli;
  const fromEnv = process.env.DATABASE_URL?.trim();
  if (fromEnv) return fromEnv;
  throw new SeedConfigError(
    "No database URL configured. Pass --database-url <url> or set DATABASE_URL " +
      "(target the tool-managed jpx_dev database from `pnpm db:up`).",
  );
}

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
  } catch {
    return "<unparseable url>";
  }
}

async function ensureSeedMeta(client: PostgresClient): Promise<void> {
  // IF NOT EXISTS is enough — CREATE SCHEMA never raises duplicate_schema when that clause is used.
  await client.unsafe(`CREATE SCHEMA IF NOT EXISTS jpx_meta`);
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS jpx_meta.seed_versions (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      notes text
    )
  `);
}

async function isSeedApplied(client: PostgresClient, version: string): Promise<boolean> {
  const rows = await client<{ version: string }[]>`
    SELECT version FROM jpx_meta.seed_versions WHERE version = ${version}
  `;
  return rows.length > 0;
}

async function markSeedApplied(client: PostgresClient, version: string, notes: string): Promise<void> {
  await client`
    INSERT INTO jpx_meta.seed_versions (version, notes)
    VALUES (${version}, ${notes})
    ON CONFLICT (version) DO NOTHING
  `;
}

async function applySeedV1(client: PostgresClient): Promise<void> {
  const store = new PostgresLedgerStore(client, {
    organizationId: SEED_ORGANIZATION_ID,
    workspaceId: SEED_WORKSPACE_ID,
  });

  await store.putCompanySettings({
    organizationName: SEED_V1_FIXTURES.organizationName,
    organizationNumber: SEED_V1_FIXTURES.organizationNumber,
    addressLine1: SEED_V1_FIXTURES.addressLine1,
    postalCode: SEED_V1_FIXTURES.postalCode,
    city: SEED_V1_FIXTURES.city,
    contactEmail: SEED_V1_FIXTURES.contactEmail,
  });

  const created = await store.createEvidence({
    actorId: SEED_V1_FIXTURES.actorId,
    title: SEED_V1_FIXTURES.evidenceTitle,
    originalFilename: SEED_V1_FIXTURES.evidenceFilename,
    mimeType: "application/pdf",
    modalities: ["pdf", "upload"],
    extractedText: SEED_V1_FIXTURES.evidenceExtractedText,
  });

  // Human-approval gate preserved: leave the review open (do not approve).
  if (created.review.status !== "needs-review") {
    throw new Error(`Seed expected needs-review voucher, got status=${created.review.status}`);
  }

  // Semantic assertions (stable fixture values only — never generated ids/hashes).
  const snapshot = await store.getSnapshot();
  const evidence = snapshot.evidence.find((item) => item.title === SEED_V1_FIXTURES.evidenceTitle);
  if (!evidence) {
    throw new Error(`Seed missing evidence titled "${SEED_V1_FIXTURES.evidenceTitle}"`);
  }
  if (evidence.originalFilename !== SEED_V1_FIXTURES.evidenceFilename) {
    throw new Error("Seed evidence filename mismatch");
  }

  const openReview = snapshot.reviews.find((item) => item.status === "needs-review");
  if (!openReview) {
    throw new Error("Seed expected at least one needs-review task");
  }

  const settings = await store.getCompanySettings();
  if (!settings || settings.organizationName !== SEED_V1_FIXTURES.organizationName) {
    throw new Error("Seed company settings organizationName mismatch");
  }
  if (settings.organizationNumber !== SEED_V1_FIXTURES.organizationNumber) {
    throw new Error("Seed company settings organizationNumber mismatch");
  }
}

export async function runSeed(databaseUrl: string): Promise<"applied" | "noop"> {
  const client = createPostgresClient({
    connectionString: databaseUrl,
    max: 2,
    applicationName: "jpx-accounting-seed",
  });
  try {
    await ensureSeedMeta(client);
    if (await isSeedApplied(client, SEED_VERSION)) {
      console.log(`Seed ${SEED_VERSION} already applied — no-op.`);
      return "noop";
    }
    console.log(`Applying seed ${SEED_VERSION} to ${redactUrl(databaseUrl)}...`);
    await applySeedV1(client);
    await markSeedApplied(client, SEED_VERSION, "Deterministic org_jpx/workspace_main demo evidence + settings");
    console.log(`Seed ${SEED_VERSION} applied.`);
    return "applied";
  } finally {
    await closePostgresClient(client).catch(() => undefined);
  }
}

function printUsage(): void {
  console.log(
    [
      "Usage: tsx scripts/db-seed.mts seed [--database-url <url>]",
      "",
      `Applies the idempotent development seed (${SEED_VERSION}) for ${SEED_ORGANIZATION_ID}/${SEED_WORKSPACE_ID}.`,
      "Connection URL: --database-url, then DATABASE_URL.",
      `Repo root: ${repoRoot}`,
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const { command, databaseUrl: cliUrl } = parseArgs(process.argv);
  if (command !== "seed") {
    printUsage();
    process.exitCode = command ? 1 : 0;
    return;
  }
  const url = resolveSeedUrl(cliUrl);
  await runSeed(url);
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  // Avoid top-level await so this module can be imported under tsx's CJS transform path
  // (same pattern as scripts/db-migrations.mts).
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
