import assert from "node:assert/strict";
import test from "node:test";

import { derivePrepareFromPoolMode } from "../../services/api/src/config";
import { readIngestEnv } from "../../scripts/ingest-knowledge.mjs";

const AZURE_VARS = {
  AZURE_OPENAI_ENDPOINT: "https://resource.openai.azure.com",
  AZURE_OPENAI_API_KEY: "test-key",
} as const;

const DATABASE_URL = "postgres://user:pass@db.example.com:5432/app";

test("DATABASE_URL alone + Azure vars resolves databaseUrl with direct poolMode", () => {
  const env = readIngestEnv({
    ...AZURE_VARS,
    DATABASE_URL,
  });
  assert.equal(env.databaseUrl, DATABASE_URL);
  assert.equal(env.poolMode, "direct");
});

test("legacy SUPABASE_DB_URL alone resolves the same databaseUrl", () => {
  const env = readIngestEnv({
    ...AZURE_VARS,
    SUPABASE_DB_URL: DATABASE_URL,
  });
  assert.equal(env.databaseUrl, DATABASE_URL);
  assert.equal(env.poolMode, "direct");
});

test("conflicting DATABASE_URL and SUPABASE_DB_URL throws, naming both settings", () => {
  assert.throws(
    () =>
      readIngestEnv({
        ...AZURE_VARS,
        DATABASE_URL,
        SUPABASE_DB_URL: "postgres://user:pass@other.example.com:5432/app",
      }),
    /DATABASE_URL.*SUPABASE_DB_URL/s,
  );
});

test("SUPABASE_POOLER_TRANSACTION_MODE=true resolves to transaction poolMode with prepare disabled", () => {
  const env = readIngestEnv({
    ...AZURE_VARS,
    DATABASE_URL,
    SUPABASE_POOLER_TRANSACTION_MODE: "true",
  });
  assert.equal(env.poolMode, "transaction");
  assert.equal(derivePrepareFromPoolMode(env.poolMode), false);
});

test("missing database URL error names DATABASE_URL, not SUPABASE_DB_URL", () => {
  assert.throws(
    () => readIngestEnv({ ...AZURE_VARS }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /DATABASE_URL/);
      assert.doesNotMatch(error.message, /SUPABASE_DB_URL —/);
      return true;
    },
  );
});
