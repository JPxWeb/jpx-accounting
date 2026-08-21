/**
 * `pnpm db:backup` — pg_dump (custom format) of DATABASE_URL/--database-url into
 * ./backups/<timestamp>.dump, plus a best-effort mirror of ACCOUNTING_BLOB_DIR into
 * ./backups/blobs/<timestamp>/ (the LocalDiskBlobUploader's evidence root — see D1 in
 * docs/superpowers/specs/2026-08-20-kapitas-full-replacement-design.md).
 *
 * Runs identically on Windows/Linux/macOS via node:child_process only (no bash/PowerShell-only
 * syntax) — same portability goal as scripts/db.mts and scripts/db-migrations.mts.
 *
 *   tsx scripts/db-backup.mts [--database-url <url>] [--blob-dir <path>] [--out-dir <dir>]
 *
 * Connection resolution: --database-url wins, then DATABASE_URL, then legacy SUPABASE_DB_URL.
 * Unlike the migration runner this never touches DATABASE_MIGRATION_URL — a dump only needs
 * read access, so the ordinary runtime credential is fine.
 *
 * Blob resolution: --blob-dir wins, then ACCOUNTING_BLOB_DIR; if neither is set, the blob-mirror
 * step is skipped (a Postgres-only backup is still useful — e.g. Azure-backed evidence storage
 * has its own retention story, see docs/SELF_HOST.md).
 *
 * Requires `pg_dump` on PATH, matching your server's major version (15-17) — see
 * https://www.postgresql.org/download/ and docs/SELF_HOST.md for the Windows install note.
 * The blob mirror uses `robocopy` on Windows (bundled with the OS) and `cp -R` elsewhere.
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT_DIR = path.join(repoRoot, "backups");

export class BackupConfigError extends Error {}

function normalize(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** --database-url wins, then DATABASE_URL, then legacy SUPABASE_DB_URL. */
export function resolveBackupDatabaseUrl(cliUrl: string | undefined, env: NodeJS.ProcessEnv): string {
  const explicit = normalize(cliUrl);
  if (explicit) return explicit;
  const fromEnv = normalize(env.DATABASE_URL) ?? normalize(env.SUPABASE_DB_URL);
  if (fromEnv) return fromEnv;
  throw new BackupConfigError(
    "No database URL configured. Pass --database-url <url> or set DATABASE_URL (see .env.example).",
  );
}

/** --blob-dir wins, then ACCOUNTING_BLOB_DIR; undefined means "skip the blob mirror step". */
export function resolveBackupBlobDir(cliBlobDir: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
  return normalize(cliBlobDir) ?? normalize(env.ACCOUNTING_BLOB_DIR);
}

/**
 * Sortable, filesystem-safe UTC timestamp (no colons — illegal in Windows filenames): e.g.
 * "2026-08-20T153045Z". Shared by the dump filename and the blob-mirror subdirectory so one
 * backup run's two artifacts carry one identifier.
 */
export function formatBackupTimestamp(now: Date): string {
  return now
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/:/g, "");
}

export function buildDumpFilename(now: Date): string {
  return `${formatBackupTimestamp(now)}.dump`;
}

/**
 * `signal` is carried alongside `code` because a child killed by a signal reports code=null.
 * That matters for robocopy in particular, whose success test is "exit code < 8" — a bare
 * null->fallback code would otherwise make a Ctrl+C'd mirror look like a completed backup.
 */
type SpawnResult = { code: number; signal: NodeJS.Signals | null };

function runInherit(command: string, args: string[]): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code: code ?? 1, signal }));
  });
}

async function dumpDatabase(databaseUrl: string, outFile: string): Promise<void> {
  console.log(`Running pg_dump --format=custom into ${path.relative(repoRoot, outFile)}...`);
  let result: SpawnResult;
  try {
    result = await runInherit("pg_dump", ["--format=custom", `--file=${outFile}`, databaseUrl]);
  } catch (error) {
    throw new Error(
      `Could not launch pg_dump (${error instanceof Error ? error.message : String(error)}). Install ` +
        "PostgreSQL client tools matching your server's major version (15-17) and ensure pg_dump is on " +
        "PATH — see https://www.postgresql.org/download/ and docs/SELF_HOST.md.",
    );
  }
  if (result.signal) {
    throw new Error(`pg_dump was terminated by signal ${result.signal}.`);
  }
  if (result.code !== 0) {
    throw new Error(`pg_dump exited with code ${result.code}.`);
  }
}

/**
 * Windows: robocopy (bundled with the OS) — exit codes 0-7 are success (bitmask of "some files
 * copied"/"extra files present"/etc.), 8+ is failure. Everything else: cp -R. Both mirror the
 * SOURCE tree's contents into an already-created DEST directory.
 */
async function mirrorBlobDir(blobDir: string, destDir: string): Promise<void> {
  mkdirSync(destDir, { recursive: true });
  if (process.platform === "win32") {
    console.log(`Mirroring ${blobDir} -> ${destDir} via robocopy...`);
    const result = await runInherit("robocopy", [blobDir, destDir, "/E", "/NFL", "/NDL", "/NJH", "/NJS"]);
    if (result.signal) {
      throw new Error(`robocopy was terminated by signal ${result.signal} mirroring ${blobDir}.`);
    }
    if (result.code >= 8) {
      throw new Error(`robocopy exited with code ${result.code} (>=8 indicates failure) mirroring ${blobDir}.`);
    }
    return;
  }
  console.log(`Mirroring ${blobDir} -> ${destDir} via cp -R...`);
  const result = await runInherit("cp", ["-R", `${blobDir}/.`, destDir]);
  if (result.signal) {
    throw new Error(`cp -R was terminated by signal ${result.signal} mirroring ${blobDir}.`);
  }
  if (result.code !== 0) {
    throw new Error(`cp -R exited with code ${result.code} mirroring ${blobDir}.`);
  }
}

type BackupCliArgs = { databaseUrl: string | undefined; blobDir: string | undefined; outDir: string | undefined };

/**
 * Hand-rolled `--flag <value>` parsing, same shape as scripts/db-migrations.mts. The fields are
 * `string | undefined` rather than optional properties because a trailing `--flag` with no value
 * yields undefined, and `exactOptionalPropertyTypes` (tsconfig.base.json) forbids assigning that
 * to an optional `string` property; such a flag simply falls through to env resolution below.
 */
function parseArgs(argv: string[]): BackupCliArgs {
  const args = argv.slice(2);
  let databaseUrl: string | undefined;
  let blobDir: string | undefined;
  let outDir: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--database-url") databaseUrl = args[++i];
    else if (arg === "--blob-dir") blobDir = args[++i];
    else if (arg === "--out-dir") outDir = args[++i];
  }
  return { databaseUrl, blobDir, outDir };
}

async function main(): Promise<void> {
  const { databaseUrl: cliUrl, blobDir: cliBlobDir, outDir: cliOutDir } = parseArgs(process.argv);
  const databaseUrl = resolveBackupDatabaseUrl(cliUrl, process.env);
  const blobDir = resolveBackupBlobDir(cliBlobDir, process.env);
  const outDir = cliOutDir ? path.resolve(cliOutDir) : DEFAULT_OUT_DIR;

  mkdirSync(outDir, { recursive: true });
  const now = new Date();
  const timestamp = formatBackupTimestamp(now);
  const dumpFile = path.join(outDir, buildDumpFilename(now));

  await dumpDatabase(databaseUrl, dumpFile);
  console.log(`Postgres backup complete: ${path.relative(repoRoot, dumpFile)}`);

  if (!blobDir) {
    console.log("ACCOUNTING_BLOB_DIR not set — skipping blob mirror (Postgres-only backup).");
    return;
  }
  if (!existsSync(blobDir)) {
    console.warn(`ACCOUNTING_BLOB_DIR "${blobDir}" does not exist yet — skipping blob mirror.`);
    return;
  }
  const blobDestDir = path.join(outDir, "blobs", timestamp);
  await mirrorBlobDir(blobDir, blobDestDir);
  console.log(`Blob directory backup complete: ${path.relative(repoRoot, blobDestDir)}`);
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
