import assert from "node:assert/strict";
import test from "node:test";

import { derivePrepareFromPoolMode, describeBootPosture, readApiRuntimeConfig } from "../../services/api/src/config";

// ---------------------------------------------------------------------------
// Task 3: provider-neutral DATABASE_* config + legacy SUPABASE_* aliases
// ---------------------------------------------------------------------------

const NORMAL_MODE_BASE = {
  ACCOUNTING_RUNTIME_MODE: "normal",
  ADVISOR_TOOL_APPROVAL_SECRET: "production-only-secret",
  SUPABASE_JWKS_URL: "https://project.supabase.co/auth/v1/keys",
} as const;

test("canonical DATABASE_URL alone resolves the runtime connection string", () => {
  const config = readApiRuntimeConfig({
    ...NORMAL_MODE_BASE,
    DATABASE_URL: "postgres://user:pass@db.example.com:5432/app",
  });
  assert.equal(config.database.runtimeUrl, "postgres://user:pass@db.example.com:5432/app");
  assert.equal(config.database.poolMode, "direct");
  assert.equal(config.database.poolMax, 10);
});

test("legacy SUPABASE_DB_URL alone resolves to the same shape as the canonical var", () => {
  const config = readApiRuntimeConfig({
    ...NORMAL_MODE_BASE,
    SUPABASE_DB_URL: "postgres://user:pass@db.example.com:5432/app",
  });
  assert.equal(config.database.runtimeUrl, "postgres://user:pass@db.example.com:5432/app");
  assert.equal(config.database.poolMode, "direct");
  assert.equal(config.database.poolMax, 10);
});

test("canonical and legacy database URLs set to equal values succeed", () => {
  const config = readApiRuntimeConfig({
    ...NORMAL_MODE_BASE,
    DATABASE_URL: "postgres://user:pass@db.example.com:5432/app",
    SUPABASE_DB_URL: "postgres://user:pass@db.example.com:5432/app",
  });
  assert.equal(config.database.runtimeUrl, "postgres://user:pass@db.example.com:5432/app");
});

test("canonical and legacy database URLs set to different values throw, naming both settings", () => {
  assert.throws(
    () =>
      readApiRuntimeConfig({
        ...NORMAL_MODE_BASE,
        DATABASE_URL: "postgres://user:pass@db.example.com:5432/app",
        SUPABASE_DB_URL: "postgres://user:pass@other.example.com:5432/app",
      }),
    /DATABASE_URL.*SUPABASE_DB_URL/s,
  );
});

test("DATABASE_POOL_MODE=transaction + legacy SUPABASE_POOLER_TRANSACTION_MODE=true agree — succeeds", () => {
  const config = readApiRuntimeConfig({
    ...NORMAL_MODE_BASE,
    DATABASE_URL: "postgres://user:pass@db.example.com:6543/app",
    DATABASE_POOL_MODE: "transaction",
    SUPABASE_POOLER_TRANSACTION_MODE: "true",
  });
  assert.equal(config.database.poolMode, "transaction");
});

test("DATABASE_POOL_MODE and legacy SUPABASE_POOLER_TRANSACTION_MODE disagree — throws, naming both settings", () => {
  assert.throws(
    () =>
      readApiRuntimeConfig({
        ...NORMAL_MODE_BASE,
        DATABASE_URL: "postgres://user:pass@db.example.com:5432/app",
        DATABASE_POOL_MODE: "direct",
        SUPABASE_POOLER_TRANSACTION_MODE: "true",
      }),
    /DATABASE_POOL_MODE.*SUPABASE_POOLER_TRANSACTION_MODE/s,
  );
});

test("legacy SUPABASE_POOLER_TRANSACTION_MODE=true alone resolves to transaction mode", () => {
  const config = readApiRuntimeConfig({
    ...NORMAL_MODE_BASE,
    DATABASE_URL: "postgres://user:pass@db.example.com:6543/app",
    SUPABASE_POOLER_TRANSACTION_MODE: "true",
  });
  assert.equal(config.database.poolMode, "transaction");
});

test("SUPABASE_POOLER_TRANSACTION_MODE values other than the literal 'true' never alias to transaction mode", () => {
  const config = readApiRuntimeConfig({
    ...NORMAL_MODE_BASE,
    DATABASE_URL: "postgres://user:pass@db.example.com:5432/app",
    SUPABASE_POOLER_TRANSACTION_MODE: "false",
  });
  assert.equal(config.database.poolMode, "direct");
});

test("invalid DATABASE_POOL_MODE value throws", () => {
  assert.throws(
    () =>
      readApiRuntimeConfig({
        ...NORMAL_MODE_BASE,
        DATABASE_POOL_MODE: "pooled",
      }),
    /Invalid DATABASE_POOL_MODE "pooled"/,
  );
});

test("DATABASE_POOL_MAX rejects non-positive or non-integer values", () => {
  for (const invalid of ["0", "-1", "3.5", "not-a-number"]) {
    assert.throws(
      () => readApiRuntimeConfig({ ...NORMAL_MODE_BASE, DATABASE_POOL_MAX: invalid }),
      /Invalid DATABASE_POOL_MAX/,
      `expected DATABASE_POOL_MAX=${invalid} to throw`,
    );
  }
});

test("DATABASE_POOL_MAX accepts a positive integer and defaults to 10 when unset", () => {
  assert.equal(readApiRuntimeConfig({ ...NORMAL_MODE_BASE }).database.poolMax, 10);
  assert.equal(readApiRuntimeConfig({ ...NORMAL_MODE_BASE, DATABASE_POOL_MAX: "25" }).database.poolMax, 25);
});

test("DATABASE_MIGRATION_URL is parsed when present and left undefined when unset", () => {
  const withUrl = readApiRuntimeConfig({
    ...NORMAL_MODE_BASE,
    DATABASE_MIGRATION_URL: "postgres://owner:pass@db.example.com:5432/app",
  });
  assert.equal(withUrl.database.migrationUrl, "postgres://owner:pass@db.example.com:5432/app");

  const withoutUrl = readApiRuntimeConfig({ ...NORMAL_MODE_BASE });
  assert.equal(withoutUrl.database.migrationUrl, undefined);
});

test("DATABASE_MIGRATION_URL rejects a malformed URL", () => {
  assert.throws(
    () => readApiRuntimeConfig({ ...NORMAL_MODE_BASE, DATABASE_MIGRATION_URL: "not a url" }),
    /Invalid DATABASE_MIGRATION_URL/,
  );
});

test("DATABASE_TEST_URL is accepted and never breaks config parsing when present", () => {
  const config = readApiRuntimeConfig({
    ...NORMAL_MODE_BASE,
    DATABASE_TEST_URL: "postgres://user:pass@db.example.com:5432/jpx_test_abc123",
  });
  assert.equal(config.database.testUrl, "postgres://user:pass@db.example.com:5432/jpx_test_abc123");
});

// ---------------------------------------------------------------------------
// Small pure boundary: transaction pool mode disables postgres-js prepared statements
// ---------------------------------------------------------------------------

test("derivePrepareFromPoolMode disables prepared statements only in transaction mode", () => {
  assert.equal(derivePrepareFromPoolMode("direct"), true);
  assert.equal(derivePrepareFromPoolMode("session"), true);
  assert.equal(derivePrepareFromPoolMode("transaction"), false);
});

// ---------------------------------------------------------------------------
// describeBootPosture never leaks connection strings, for any of the above cases
// ---------------------------------------------------------------------------

const CONNECTION_STRING_PATTERN = /postgres(?:ql)?:\/\/|hunter2|db\.example\.com/;

test("describeBootPosture leaks no connection-string substrings across canonical/legacy/conflict-free cases", () => {
  const cases: Array<Record<string, string>> = [
    { ...NORMAL_MODE_BASE, DATABASE_URL: "postgres://user:hunter2@db.example.com:5432/app" },
    { ...NORMAL_MODE_BASE, SUPABASE_DB_URL: "postgres://user:hunter2@db.example.com:5432/app" },
    {
      ...NORMAL_MODE_BASE,
      DATABASE_URL: "postgres://user:hunter2@db.example.com:5432/app",
      SUPABASE_DB_URL: "postgres://user:hunter2@db.example.com:5432/app",
    },
    {
      ...NORMAL_MODE_BASE,
      DATABASE_URL: "postgres://user:hunter2@db.example.com:6543/app",
      DATABASE_POOL_MODE: "transaction",
      SUPABASE_POOLER_TRANSACTION_MODE: "true",
    },
  ];

  for (const env of cases) {
    const config = readApiRuntimeConfig(env);
    const posture = describeBootPosture(config);
    const line = JSON.stringify(posture);
    assert.doesNotMatch(line, CONNECTION_STRING_PATTERN, `boot posture leaked a connection string for env ${line}`);
    assert.equal(posture.ledgerStore, "postgres");
  }

  // The conflicting-values case throws before describeBootPosture is ever reached — assert that
  // directly instead of calling describeBootPosture on a config that was never produced.
  assert.throws(() =>
    readApiRuntimeConfig({
      ...NORMAL_MODE_BASE,
      DATABASE_URL: "postgres://user:hunter2@db.example.com:5432/app",
      SUPABASE_DB_URL: "postgres://user:hunter2@other.example.com:5432/app",
    }),
  );
});

test("describeBootPosture reports 'unavailable' (never a URL) when no database is configured", () => {
  const config = readApiRuntimeConfig({ ...NORMAL_MODE_BASE });
  const posture = describeBootPosture(config);
  assert.equal(posture.ledgerStore, "unavailable");
  assert.doesNotMatch(JSON.stringify(posture), CONNECTION_STRING_PATTERN);
});
