import assert from "node:assert/strict";
import test from "node:test";

import {
  BackupConfigError,
  buildDumpFilename,
  formatBackupTimestamp,
  resolveBackupBlobDir,
  resolveBackupDatabaseUrl,
} from "../../scripts/db-backup.mts";

test("resolveBackupDatabaseUrl prefers --database-url over env", () => {
  assert.equal(
    resolveBackupDatabaseUrl("postgres://cli/db", { DATABASE_URL: "postgres://env/db" }),
    "postgres://cli/db",
  );
});

test("resolveBackupDatabaseUrl falls back to DATABASE_URL, then legacy SUPABASE_DB_URL", () => {
  assert.equal(resolveBackupDatabaseUrl(undefined, { DATABASE_URL: "postgres://env/db" }), "postgres://env/db");
  assert.equal(
    resolveBackupDatabaseUrl(undefined, { SUPABASE_DB_URL: "postgres://legacy/db" }),
    "postgres://legacy/db",
  );
});

test("resolveBackupDatabaseUrl throws BackupConfigError when nothing is configured", () => {
  assert.throws(() => resolveBackupDatabaseUrl(undefined, {}), BackupConfigError);
});

test("resolveBackupBlobDir prefers --blob-dir, then ACCOUNTING_BLOB_DIR, else undefined", () => {
  assert.equal(resolveBackupBlobDir("/cli/blobs", { ACCOUNTING_BLOB_DIR: "/env/blobs" }), "/cli/blobs");
  assert.equal(resolveBackupBlobDir(undefined, { ACCOUNTING_BLOB_DIR: "/env/blobs" }), "/env/blobs");
  assert.equal(resolveBackupBlobDir(undefined, {}), undefined);
});

test("formatBackupTimestamp produces a sortable, filesystem-safe UTC string", () => {
  const fixed = new Date("2026-08-20T15:30:45.123Z");
  assert.equal(formatBackupTimestamp(fixed), "2026-08-20T153045Z");
});

test("buildDumpFilename appends .dump to the formatted timestamp", () => {
  const fixed = new Date("2026-08-20T15:30:45.123Z");
  assert.equal(buildDumpFilename(fixed), "2026-08-20T153045Z.dump");
});
