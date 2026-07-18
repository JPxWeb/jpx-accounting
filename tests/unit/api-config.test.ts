import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SUPABASE_JWT_ALGS,
  DEMO_ADVISOR_TOOL_APPROVAL_SECRET,
  describeBootPosture,
  readApiRuntimeConfig,
} from "../../services/api/src/config";

// ---------------------------------------------------------------------------
// §A N5a: ACCOUNTING_RUNTIME_MODE fails closed on unknown values
// ---------------------------------------------------------------------------

test("readApiRuntimeConfig defaults to demo when ACCOUNTING_RUNTIME_MODE is unset", () => {
  const config = readApiRuntimeConfig({});
  assert.equal(config.runtimeMode, "demo");
});

test("readApiRuntimeConfig accepts normal mode when properly configured", () => {
  const config = readApiRuntimeConfig({
    ACCOUNTING_RUNTIME_MODE: "normal",
    ADVISOR_TOOL_APPROVAL_SECRET: "production-only-secret",
  });
  assert.equal(config.runtimeMode, "normal");
});

test("readApiRuntimeConfig throws on an unknown ACCOUNTING_RUNTIME_MODE instead of falling back to demo", () => {
  assert.throws(
    () => readApiRuntimeConfig({ ACCOUNTING_RUNTIME_MODE: "production" }),
    /Unknown ACCOUNTING_RUNTIME_MODE "production"/,
  );
  // A typo'd "nromal" must never silently boot a production deploy as demo.
  assert.throws(() => readApiRuntimeConfig({ ACCOUNTING_RUNTIME_MODE: "nromal" }), /Unknown ACCOUNTING_RUNTIME_MODE/);
});

// ---------------------------------------------------------------------------
// §A N5b: SUPABASE_JWT_ALGS members are validated against the allowed union
// ---------------------------------------------------------------------------

// Fix (§A finding): Supabase's newer projects sign JWKS keys with ES256, not just RS256.
test("readApiRuntimeConfig defaults SUPABASE_JWT_ALGS to RS256 and ES256 when unset", () => {
  const config = readApiRuntimeConfig({ ACCOUNTING_RUNTIME_MODE: "demo" });
  assert.deepEqual(config.auth.jwtAlgs, DEFAULT_SUPABASE_JWT_ALGS);
});

test("readApiRuntimeConfig parses a custom comma-separated SUPABASE_JWT_ALGS", () => {
  const config = readApiRuntimeConfig({
    ACCOUNTING_RUNTIME_MODE: "demo",
    SUPABASE_JWT_ALGS: " RS256 , PS256 ,ES384",
  });
  assert.deepEqual(config.auth.jwtAlgs, ["RS256", "PS256", "ES384"]);
});

test("readApiRuntimeConfig throws on unknown SUPABASE_JWT_ALGS members", () => {
  // HS256 is symmetric and never valid for JWKS verification; R256 is a typo of RS256.
  assert.throws(
    () => readApiRuntimeConfig({ ACCOUNTING_RUNTIME_MODE: "demo", SUPABASE_JWT_ALGS: "RS256,HS256" }),
    /Unknown SUPABASE_JWT_ALGS value\(s\): HS256/,
  );
  assert.throws(
    () => readApiRuntimeConfig({ ACCOUNTING_RUNTIME_MODE: "demo", SUPABASE_JWT_ALGS: "R256" }),
    /Unknown SUPABASE_JWT_ALGS value\(s\): R256/,
  );
});

// ---------------------------------------------------------------------------
// §A N5c: PORT rejects NaN and out-of-range values
// ---------------------------------------------------------------------------

test("readApiRuntimeConfig defaults PORT to 3001 when unset and parses valid ports", () => {
  assert.equal(readApiRuntimeConfig({}).port, 3001);
  assert.equal(readApiRuntimeConfig({ PORT: "3005" }).port, 3005);
});

test("readApiRuntimeConfig throws on a non-numeric PORT", () => {
  assert.throws(() => readApiRuntimeConfig({ PORT: "not-a-port" }), /Invalid PORT "not-a-port"/);
});

test("readApiRuntimeConfig throws on out-of-range or fractional PORT values", () => {
  assert.throws(() => readApiRuntimeConfig({ PORT: "0" }), /Invalid PORT/);
  assert.throws(() => readApiRuntimeConfig({ PORT: "-1" }), /Invalid PORT/);
  assert.throws(() => readApiRuntimeConfig({ PORT: "65536" }), /Invalid PORT/);
  assert.throws(() => readApiRuntimeConfig({ PORT: "3001.5" }), /Invalid PORT/);
});

// ---------------------------------------------------------------------------
// §A N5d / Phase 1.1 (§A C8): tool-approval secret fails closed in normal mode
// ---------------------------------------------------------------------------

test("readApiRuntimeConfig keeps the demo tool-approval fallback in demo mode", () => {
  const config = readApiRuntimeConfig({
    ACCOUNTING_RUNTIME_MODE: "demo",
    ADVISOR_TOOL_APPROVAL_SECRET: undefined,
  });
  assert.equal(config.advisor.toolApprovalSecret, DEMO_ADVISOR_TOOL_APPROVAL_SECRET);
});

test("readApiRuntimeConfig fail-closes on missing tool-approval secret in normal mode", () => {
  assert.throws(
    () =>
      readApiRuntimeConfig({
        ACCOUNTING_RUNTIME_MODE: "normal",
        ADVISOR_TOOL_APPROVAL_SECRET: undefined,
      }),
    /ADVISOR_TOOL_APPROVAL_SECRET is required/,
  );
});

test("readApiRuntimeConfig fail-closes on demo tool-approval secret in normal mode", () => {
  assert.throws(
    () =>
      readApiRuntimeConfig({
        ACCOUNTING_RUNTIME_MODE: "normal",
        ADVISOR_TOOL_APPROVAL_SECRET: DEMO_ADVISOR_TOOL_APPROVAL_SECRET,
      }),
    /must not be the demo default/,
  );
});

test("readApiRuntimeConfig accepts a custom tool-approval secret in normal mode", () => {
  const config = readApiRuntimeConfig({
    ACCOUNTING_RUNTIME_MODE: "normal",
    ADVISOR_TOOL_APPROVAL_SECRET: "production-only-secret",
  });
  assert.equal(config.advisor.toolApprovalSecret, "production-only-secret");
});

// ---------------------------------------------------------------------------
// §A N5e: single structured boot posture log line
// ---------------------------------------------------------------------------

test("readApiRuntimeConfig stays side-effect free; describeBootPosture derives the demo posture", (t) => {
  // knowledge.ts re-reads config lazily — the boot line must come from
  // createApiRuntimeDependencies alone (covered in api-runtime.test.ts).
  const log = t.mock.method(console, "log", () => {});
  const config = readApiRuntimeConfig({ ACCOUNTING_RUNTIME_MODE: "demo" });
  assert.equal(log.mock.callCount(), 0);

  const posture = describeBootPosture(config);
  assert.equal(posture.component, "api.boot");
  assert.equal(posture.runtimeMode, "demo");
  assert.equal(posture.ledgerStore, "memory");
  assert.equal(posture.authEnabled, false);
  assert.equal(posture.corsPolicy, "wildcard");
  assert.equal(posture.rateLimitEnabled, true);
});

test("describeBootPosture reports the normal-mode posture without leaking secrets", () => {
  const config = readApiRuntimeConfig({
    ACCOUNTING_RUNTIME_MODE: "normal",
    ADVISOR_TOOL_APPROVAL_SECRET: "production-only-secret",
    SUPABASE_DB_URL: "postgres://postgres:hunter2@db.example.com:5432/app",
    SUPABASE_JWKS_URL: "https://project.supabase.co/auth/v1/keys",
    ACCOUNTING_CORS_ORIGINS: "https://app.example.com, https://admin.example.com",
    ALLOW_TEST_RESET: "true",
  });
  const posture = describeBootPosture(config);
  assert.equal(posture.runtimeMode, "normal");
  assert.equal(posture.ledgerStore, "postgres");
  assert.equal(posture.authEnabled, true);
  assert.equal(posture.corsPolicy, "allowlist");
  assert.equal(posture.corsOriginCount, 2);
  // WS-A5c: ALLOW_TEST_RESET must not disable the limiter outside demo mode.
  assert.equal(posture.rateLimitEnabled, true);
  const line = JSON.stringify(posture);
  assert.doesNotMatch(line, /hunter2|production-only-secret|postgres:\/\//);
});

test("describeBootPosture reports unavailable ledger store and disabled rate limit for demo test instances", () => {
  const normalWithoutDb = readApiRuntimeConfig({
    ACCOUNTING_RUNTIME_MODE: "normal",
    ADVISOR_TOOL_APPROVAL_SECRET: "production-only-secret",
  });
  assert.equal(describeBootPosture(normalWithoutDb).ledgerStore, "unavailable");

  const demoTestInstance = readApiRuntimeConfig({
    ACCOUNTING_RUNTIME_MODE: "demo",
    ALLOW_TEST_RESET: "true",
  });
  assert.equal(describeBootPosture(demoTestInstance).rateLimitEnabled, false);
});
