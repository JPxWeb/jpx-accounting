/**
 * Cross-platform local PostgreSQL lifecycle orchestrator (Local Postgres Dev DB plan, Task 1).
 *
 * Wraps `compose.db.yml` with an isolated, per-clone/per-worktree/per-agent Compose project
 * (derived from a hash of this repo's absolute path plus the optional JPX_DB_INSTANCE env
 * var) so multiple isolated Postgres instances can run concurrently on one machine without
 * fixed-name or fixed-port collisions. Runs identically via `tsx scripts/db.mts <cmd>` on
 * Windows, Linux CI, and cloud agents — only `node:child_process` is used, no Bash-only or
 * PowerShell-only syntax.
 *
 * Subcommands: doctor | up | url | migrate | reset | seed | test | down
 *
 * `migrate`/`seed`/`test` shell out to the sibling runners:
 *   tsx scripts/db-migrations.mts migrate --database-url <url>
 *   tsx scripts/db-seed.mts seed --database-url <url>
 */
import { randomUUID, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type SpawnOptions } from "node:child_process";

import {
  createPostgresClient,
  closePostgresClient,
  type PostgresClient,
} from "../packages/persistence-postgres/src/client.ts";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const composeFile = path.join(repoRoot, "compose.db.yml");
const MIGRATIONS_SCRIPT = path.join(repoRoot, "scripts", "db-migrations.mts");
const SEED_SCRIPT = path.join(repoRoot, "scripts", "db-seed.mts");
// Invoke tsx's own CLI entry point directly through the current Node binary (no shell, no
// .cmd/.ps1 shim resolution) so this works identically on Windows, Linux CI, and cloud
// agents. `node_modules/tsx` is the top-level symlink pnpm creates for the root devDependency.
const TSX_CLI = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");

const ADMIN_DATABASE = "postgres";
const DEV_DATABASE = "jpx_dev";
const DB_USER = "postgres";
const DB_PASSWORD = "postgres";
const DB_HOST = "127.0.0.1";

/** Docker Compose project names must be lowercase [a-z0-9_-], starting with a letter/digit. */
function sanitizeInstanceSuffix(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned;
}

/**
 * Stable short hash of this repo's absolute path so every clone/worktree gets its own
 * Compose project deterministically (same clone -> same project across invocations, so
 * `db:up` is idempotent and `db:doctor` finds what `db:up` created). JPX_DB_INSTANCE lets
 * multiple isolated instances coexist within the SAME clone (e.g. concurrent agents).
 */
export function resolveProjectName(env: NodeJS.ProcessEnv = process.env): string {
  const normalizedPath = repoRoot.replace(/\\/g, "/").toLowerCase();
  const hash = createHash("sha256").update(normalizedPath).digest("hex").slice(0, 12);
  const base = `jpx-pgdev-${hash}`;
  const instance = sanitizeInstanceSuffix(env.JPX_DB_INSTANCE?.trim() ?? "");
  return instance ? `${base}-${instance}` : base;
}

function composeBaseArgs(project: string): string[] {
  return ["compose", "-p", project, "-f", composeFile];
}

type CaptureResult = { code: number; stdout: string; stderr: string };

function runCapture(command: string, args: string[], options: SpawnOptions = {}): Promise<CaptureResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      ...options,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr?.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function runInherit(command: string, args: string[], options: SpawnOptions = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
      ...options,
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(database: string, port: number): string {
  return `postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${port}/${database}`;
}

async function detectDocker(): Promise<{
  dockerAvailable: boolean;
  dockerVersion: string | undefined;
  composeAvailable: boolean;
  composeVersion: string | undefined;
}> {
  let dockerAvailable = false;
  let dockerVersion: string | undefined;
  try {
    const result = await runCapture("docker", ["version", "--format", "{{.Client.Version}}"]);
    if (result.code === 0) {
      dockerAvailable = true;
      dockerVersion = result.stdout.trim();
    }
  } catch {
    dockerAvailable = false;
  }

  let composeAvailable = false;
  let composeVersion: string | undefined;
  try {
    const result = await runCapture("docker", ["compose", "version", "--short"]);
    if (result.code === 0) {
      composeAvailable = true;
      composeVersion = result.stdout.trim();
    }
  } catch {
    composeAvailable = false;
  }

  return { dockerAvailable, dockerVersion, composeAvailable, composeVersion };
}

type ComposeServiceStatus = {
  Service?: string;
  State?: string;
  Health?: string;
  Status?: string;
  ID?: string;
};

/** `docker compose ps --format json` prints one JSON object per line (JSONL), never an array. */
function parsePsJsonLines(stdout: string): ComposeServiceStatus[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ComposeServiceStatus);
}

async function getServiceStatus(project: string): Promise<ComposeServiceStatus | undefined> {
  const result = await runCapture("docker", [...composeBaseArgs(project), "ps", "--format", "json"]);
  if (result.code !== 0) {
    return undefined;
  }
  const services = parsePsJsonLines(result.stdout);
  return services.find((service) => service.Service === "db");
}

/** Throws with the container's log tail attached for fast diagnosis. */
async function resolvePort(project: string): Promise<number> {
  const result = await runCapture("docker", [...composeBaseArgs(project), "port", "db", "5432"]);
  if (result.code !== 0) {
    throw new Error(
      `Could not resolve the published port for Compose project "${project}" — is it running? ` +
        `Run "pnpm db:up" first. (${result.stderr.trim() || result.stdout.trim()})`,
    );
  }
  const match = result.stdout.trim().match(/:(\d+)\s*$/);
  if (!match) {
    throw new Error(`Unexpected \`docker compose port\` output for project "${project}": ${result.stdout.trim()}`);
  }
  return Number(match[1]);
}

/**
 * Waits for the container to leave a transient "restarting"/"created" state, then requires
 * three successful `SELECT 1` probes spanning at least two seconds over fresh connections.
 * `pg_isready`/the Compose healthcheck alone are insufficient: the official Postgres image
 * restarts its process once during initdb, and a probe that lands in that brief window would
 * report false-positive readiness.
 */
async function waitUntilReady(
  project: string,
  url: string,
  options: { timeoutMs?: number; minStreakMs?: number; requiredSuccesses?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const minStreakMs = options.minStreakMs ?? 2_000;
  const requiredSuccesses = options.requiredSuccesses ?? 3;
  const start = Date.now();

  // Coarse gate: don't even start probing while Docker itself reports the container down/exited.
  while (Date.now() - start < timeoutMs) {
    const status = await getServiceStatus(project);
    if (status?.State === "exited" || status?.State === "dead") {
      const logs = await runCapture("docker", [...composeBaseArgs(project), "logs", "--no-color", "--tail", "50", "db"]);
      throw new Error(
        `Container for project "${project}" exited unexpectedly (state: ${status.State}).\n--- last logs ---\n${logs.stdout}${logs.stderr}`,
      );
    }
    if (status?.State === "running") {
      break;
    }
    await sleep(500);
  }

  let successTimestamps: number[] = [];
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    let client: PostgresClient | undefined;
    try {
      client = createPostgresClient({ connectionString: url, max: 1 });
      await client`SELECT 1`;
      successTimestamps.push(Date.now());
    } catch (error) {
      lastError = error;
      successTimestamps = [];
    } finally {
      if (client) {
        await closePostgresClient(client).catch(() => undefined);
      }
    }

    const first = successTimestamps[0];
    const last = successTimestamps[successTimestamps.length - 1];
    if (successTimestamps.length >= requiredSuccesses && first !== undefined && last !== undefined && last - first >= minStreakMs) {
      return;
    }
    await sleep(400);
  }

  throw new Error(
    `Postgres for project "${project}" did not become ready within ${timeoutMs}ms. ` +
      `Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function assertDockerUsable(): Promise<void> {
  const { dockerAvailable, composeAvailable } = await detectDocker();
  if (!dockerAvailable) {
    throw new Error(
      "Docker is not available on this machine/environment. Install Docker (or Docker Desktop) or, for " +
        "database verification without Docker, set DATABASE_TEST_URL to a disposable jpx_test_* Postgres " +
        "URL and run JPX_REQUIRE_DATABASE_TESTS=true pnpm test:integration (not pnpm db:test).",
    );
  }
  if (!composeAvailable) {
    throw new Error("Docker is available but `docker compose` (the Compose v2 plugin) is not — please update Docker.");
  }
}

async function doUp(): Promise<{ project: string; port: number }> {
  await assertDockerUsable();
  const project = resolveProjectName();
  const code = await runInherit("docker", [...composeBaseArgs(project), "up", "-d"]);
  if (code !== 0) {
    throw new Error(`\`docker compose up\` failed for project "${project}" (exit code ${code}).`);
  }
  const port = await resolvePort(project);
  await waitUntilReady(project, buildUrl(DEV_DATABASE, port));
  return { project, port };
}

async function cmdUp(): Promise<void> {
  const { project, port } = await doUp();
  console.log(`Postgres is ready — project "${project}" on 127.0.0.1:${port}.`);
  console.log(`  Dev database:   ${buildUrl(DEV_DATABASE, port)}`);
  console.log('Run "pnpm db:migrate" to apply migrations, then "pnpm db:seed" for sample data.');
}

async function cmdDown(): Promise<void> {
  const project = resolveProjectName();
  const code = await runInherit("docker", [...composeBaseArgs(project), "down"]);
  if (code !== 0) {
    throw new Error(`\`docker compose down\` failed for project "${project}" (exit code ${code}).`);
  }
  console.log(`Stopped and removed containers for project "${project}" (volume preserved).`);
}

async function cmdReset(): Promise<void> {
  const project = resolveProjectName();
  console.log(`Resetting project "${project}" (down -v, then up)...`);
  const downCode = await runInherit("docker", [...composeBaseArgs(project), "down", "-v"]);
  if (downCode !== 0) {
    throw new Error(`\`docker compose down -v\` failed for project "${project}" (exit code ${downCode}).`);
  }
  const { port } = await doUp();
  console.log(`Reset complete — project "${project}" on 127.0.0.1:${port}.`);
}

async function requireRunningPort(): Promise<{ project: string; port: number }> {
  const project = resolveProjectName();
  const status = await getServiceStatus(project);
  if (!status || status.State !== "running") {
    throw new Error(`No running Postgres container for project "${project}". Run "pnpm db:up" first.`);
  }
  const port = await resolvePort(project);
  return { project, port };
}

async function cmdUrl(): Promise<void> {
  const { port } = await requireRunningPort();
  // Nothing but the URL goes to stdout — this is meant to be captured by callers/scripts.
  process.stdout.write(`${buildUrl(DEV_DATABASE, port)}\n`);
}

async function cmdDoctor(): Promise<void> {
  const lines: string[] = [];
  lines.push("jpx-accounting local Postgres doctor");
  lines.push(`  Repo path:       ${repoRoot}`);

  const { dockerAvailable, dockerVersion, composeAvailable, composeVersion } = await detectDocker();
  lines.push(`  Docker:          ${dockerAvailable ? `available (${dockerVersion})` : "NOT available"}`);
  lines.push(`  Docker Compose:  ${composeAvailable ? `available (${composeVersion})` : "NOT available"}`);

  const project = resolveProjectName();
  lines.push(`  Compose project: ${project}`);
  lines.push(`  Compose file:    ${composeFile}`);

  if (!dockerAvailable || !composeAvailable) {
    lines.push("  Container:       unknown (Docker/Compose unavailable)");
    console.log(lines.join("\n"));
    return;
  }

  const status = await getServiceStatus(project);
  if (!status || status.State !== "running") {
    lines.push(`  Container:       not running${status ? ` (state: ${status.State})` : ""}`);
    console.log(lines.join("\n"));
    return;
  }
  lines.push(`  Container:       running (health: ${status.Health || "n/a"})`);

  let port: number | undefined;
  try {
    port = await resolvePort(project);
    lines.push(`  Host port:       127.0.0.1:${port}`);
  } catch (error) {
    lines.push(`  Host port:       unresolved (${error instanceof Error ? error.message : String(error)})`);
  }

  if (port !== undefined) {
    let client: PostgresClient | undefined;
    try {
      client = createPostgresClient({ connectionString: buildUrl(DEV_DATABASE, port), max: 1 });
      const versionRows = await client<{ version: string }[]>`SELECT version() as version`;
      lines.push(`  Postgres:        ${versionRows[0]?.version ?? "unknown"}`);
      const extensionRows = await client<{ extversion: string }[]>`
        SELECT extversion FROM pg_extension WHERE extname = 'vector'
      `;
      lines.push(
        extensionRows.length > 0 && extensionRows[0]
          ? `  vector ext:      installed (${extensionRows[0].extversion}) on "${DEV_DATABASE}"`
          : `  vector ext:      not installed on "${DEV_DATABASE}" yet (run "pnpm db:migrate")`,
      );
    } catch (error) {
      lines.push(`  Postgres:        unreachable (${error instanceof Error ? error.message : String(error)})`);
    } finally {
      if (client) {
        await closePostgresClient(client).catch(() => undefined);
      }
    }
  }

  console.log(lines.join("\n"));
}

function assertSiblingScriptExists(scriptPath: string, humanName: string): void {
  if (!existsSync(scriptPath)) {
    throw new Error(
      `${humanName} is missing at ${path.relative(repoRoot, scriptPath)}. ` +
        "Restore it from the repository before running this command.",
    );
  }
}

async function runMigrationsAgainst(url: string, extraArgs: string[] = []): Promise<void> {
  assertSiblingScriptExists(MIGRATIONS_SCRIPT, "The migration runner");
  // Contract: tsx scripts/db-migrations.mts <command> [--database-url <url>] (see that file's header).
  const code = await runInherit(process.execPath, [
    TSX_CLI,
    MIGRATIONS_SCRIPT,
    "migrate",
    "--database-url",
    url,
    ...extraArgs,
  ]);
  if (code !== 0) {
    throw new Error(`Migrations failed against ${redactUrl(url)} (exit code ${code}).`);
  }
}

async function cmdMigrate(extraArgs: string[]): Promise<void> {
  const { port } = await requireRunningPort();
  await runMigrationsAgainst(buildUrl(DEV_DATABASE, port), extraArgs);
}

async function cmdSeed(extraArgs: string[]): Promise<void> {
  const { port } = await requireRunningPort();
  assertSiblingScriptExists(SEED_SCRIPT, "The seed script");
  const url = buildUrl(DEV_DATABASE, port);
  const code = await runInherit(process.execPath, [TSX_CLI, SEED_SCRIPT, "seed", "--database-url", url, ...extraArgs]);
  if (code !== 0) {
    throw new Error(`Seeding failed against ${redactUrl(url)} (exit code ${code}).`);
  }
}

/** Never log full connection strings (credentials) — only host:port/database. */
function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port}${parsed.pathname}`;
  } catch {
    return "<unparseable url>";
  }
}

/**
 * Create a throwaway `jpx_test_<uuid>` database, migrate it, run the integration suite with
 * `JPX_REQUIRE_DATABASE_TESTS=true`, then always drop that database in `finally`.
 *
 * The suite prefers `DATABASE_TEST_URL` over `DATABASE_URL` / legacy `SUPABASE_DB_URL`, so this
 * command MUST pin `DATABASE_TEST_URL` to the throwaway URL — otherwise an ambient
 * `DATABASE_TEST_URL` in the developer environment would silently redirect the gate.
 */
async function cmdTest(extraArgs: string[]): Promise<void> {
  const { project, port } = await doUp();
  const testDatabase = `jpx_test_${randomUUID().replace(/-/g, "")}`;
  const adminUrl = buildUrl(ADMIN_DATABASE, port);
  const testUrl = buildUrl(testDatabase, port);

  console.log(`Creating throwaway test database "${testDatabase}" on project "${project}"...`);
  const createClient = createPostgresClient({ connectionString: adminUrl, max: 1 });
  try {
    await createClient.unsafe(`CREATE DATABASE "${testDatabase}"`);
  } finally {
    await closePostgresClient(createClient).catch(() => undefined);
  }

  let exitCode = 1;
  try {
    await runMigrationsAgainst(testUrl);

    console.log(`Running "pnpm test:integration" against "${testDatabase}" (JPX_REQUIRE_DATABASE_TESTS=true)...`);
    exitCode = await runInherit("corepack", ["pnpm", "test:integration", ...extraArgs], {
      shell: process.platform === "win32",
      env: {
        ...process.env,
        // Pin all three so URL precedence cannot escape the throwaway DB.
        DATABASE_TEST_URL: testUrl,
        DATABASE_URL: testUrl,
        SUPABASE_DB_URL: testUrl,
        JPX_REQUIRE_DATABASE_TESTS: "true",
      },
    });
  } finally {
    console.log(`Dropping test database "${testDatabase}"...`);
    const cleanupClient = createPostgresClient({ connectionString: adminUrl, max: 1 });
    try {
      await cleanupClient`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = ${testDatabase} AND pid <> pg_backend_pid()
      `;
      await cleanupClient.unsafe(`DROP DATABASE IF EXISTS "${testDatabase}"`);
    } finally {
      await closePostgresClient(cleanupClient).catch(() => undefined);
    }
  }

  if (exitCode !== 0) {
    throw new Error(`pnpm test:integration failed against the isolated test database (exit code ${exitCode}).`);
  }
  console.log("Strict PostgreSQL integration run passed.");
}

function printUsage(): void {
  console.log(
    [
      "Usage: tsx scripts/db.mts <command>",
      "",
      "Commands:",
      "  doctor   Report Docker/Compose availability, project status, port, and Postgres capabilities",
      "  up       Start (or reuse) this clone/instance's isolated Postgres + pgvector server",
      "  url      Print the resolved local dev database URL to stdout",
      "  migrate  Apply migrations to the dev database (scripts/db-migrations.mts)",
      "  reset    Tear down (including the data volume) and bring this instance back up",
      "  seed     Apply the deterministic development seed (scripts/db-seed.mts)",
      "  test     Run the strict per-run integration suite against a throwaway jpx_test_* database",
      "  down     Stop and remove this instance's containers (volume preserved)",
      "",
      "Set JPX_DB_INSTANCE to run multiple isolated instances against the same clone concurrently.",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const [sub, ...rest] = process.argv.slice(2);
  switch (sub) {
    case "doctor":
      return cmdDoctor();
    case "up":
      return cmdUp();
    case "url":
      return cmdUrl();
    case "migrate":
      return cmdMigrate(rest);
    case "reset":
      return cmdReset();
    case "seed":
      return cmdSeed(rest);
    case "test":
      return cmdTest(rest);
    case "down":
      return cmdDown();
    default:
      printUsage();
      process.exitCode = sub ? 1 : 0;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
