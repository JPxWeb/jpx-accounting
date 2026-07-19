import { runtimeModeSchema, type RuntimeMode } from "@jpx-accounting/contracts";

export type CorsRuntimePolicy = { kind: "wildcard" } | { kind: "allowlist"; origins: string[] };

export type ApiRuntimeConfig = {
  port: number;
  runtimeMode: RuntimeMode;
  allowTestReset: boolean;
  corsPolicy: CorsRuntimePolicy;
  azureOpenAi: {
    endpoint?: string | undefined;
    apiKey?: string | undefined;
    model?: string | undefined;
  };
  supabase: {
    /** Direct Postgres connection string (port 5432) or Supavisor session-mode URL. */
    databaseUrl?: string | undefined;
    /**
     * Set to true when the URL points at Supavisor transaction-mode (port 6543);
     * named prepared statements are not supported there, so postgres-js must run with prepare:false.
     */
    poolerTransactionMode: boolean;
  };
  azureStorage: {
    accountName?: string | undefined;
    containerName?: string | undefined;
  };
  azureDocumentIntelligence: {
    endpoint?: string | undefined;
    apiKey?: string | undefined;
  };
  auth: {
    /**
     * Full JWKS URL — typically `${SUPABASE_URL}/auth/v1/keys`. When set, ALL /api/* routes
     * (runtime-info excepted) require a valid JWT. REQUIRED in normal mode (WS-C R12 fail-closed);
     * optional in demo, where the scaffold stays auth-free.
     */
    jwksUrl?: string | undefined;
    /**
     * Asymmetric algorithms the JWKS verifier accepts (comma-separated via SUPABASE_JWT_ALGS).
     * Defaults to RS256 + ES256: Supabase's original asymmetric default plus its newer signing-key
     * default — a hardcoded RS256-only allowlist would 401 every legitimate user once a project's
     * JWKS rotates to ES256.
     */
    jwtAlgs?: SupabaseJwtAlgorithm[] | undefined;
  };
  advisor: {
    /**
     * HMAC secret for AI SDK tool-approval signing (`experimental_toolApprovalSecret`):
     * the server signs each streamed approval request and verifies the signature when
     * the approval is replayed, so clients cannot forge approvals. The demo default
     * keeps local/offline runs working; production sets ADVISOR_TOOL_APPROVAL_SECRET.
     */
    toolApprovalSecret: string;
  };
};

/** Demo fallback for ADVISOR_TOOL_APPROVAL_SECRET — not a production credential. */
export const DEMO_ADVISOR_TOOL_APPROVAL_SECRET = "jpx-demo-advisor-tool-approval-secret";

/** Mirrors `hono/jwk`'s `AsymmetricAlgorithm` union — kept local so config.ts stays framework-import-free. */
export const SUPABASE_JWT_ALGORITHMS = [
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
  "EdDSA",
] as const;

export type SupabaseJwtAlgorithm = (typeof SUPABASE_JWT_ALGORITHMS)[number];

function isSupabaseJwtAlgorithm(value: string): value is SupabaseJwtAlgorithm {
  return (SUPABASE_JWT_ALGORITHMS as readonly string[]).includes(value);
}

/** RS256 covers Supabase's original asymmetric keys; ES256 covers its newer default. */
export const DEFAULT_SUPABASE_JWT_ALGS: SupabaseJwtAlgorithm[] = ["RS256", "ES256"];

function normalizeOptionalValue(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveCorsPolicy(runtimeMode: RuntimeMode, originsEnv?: string): CorsRuntimePolicy {
  // Demo stays permissive for local dev; normal mode requires ACCOUNTING_CORS_ORIGINS when browsers call the API directly (see docs/CONTRIBUTING.md).
  if (runtimeMode === "demo") {
    return { kind: "wildcard" };
  }
  const origins =
    originsEnv
      ?.split(",")
      .map((segment) => segment.trim())
      .filter(Boolean) ?? [];
  return { kind: "allowlist", origins };
}

/**
 * Normal mode requires SUPABASE_JWKS_URL (WS-C R12, extending the W1 fail-closed
 * pattern): without it every /api/* route would serve real ledger data to
 * unauthenticated callers. Demo mode stays auth-free by design — the in-memory
 * scaffold holds no real records and E2E depends on the open surface.
 */
function resolveJwksUrl(runtimeMode: RuntimeMode, jwksUrlEnv?: string): string | undefined {
  const jwksUrl = normalizeOptionalValue(jwksUrlEnv);
  if (runtimeMode === "normal" && jwksUrl === undefined) {
    throw new Error(
      "SUPABASE_JWKS_URL is required when ACCOUNTING_RUNTIME_MODE=normal. " +
        "Fail closed: without JWKS verification every /api/* route would accept unauthenticated traffic. " +
        "Set it to ${SUPABASE_URL}/auth/v1/keys (or run demo mode for auth-free scaffolding).",
    );
  }
  return jwksUrl;
}

/**
 * Comma-separated SUPABASE_JWT_ALGS → trimmed list; falls back to DEFAULT_SUPABASE_JWT_ALGS
 * when unset/empty. Fail closed on unknown members (§A N5): a typo like "R256" would
 * otherwise ride along until the verifier rejects every token at request time.
 */
function resolveJwtAlgs(algsEnv?: string): SupabaseJwtAlgorithm[] {
  const algs =
    algsEnv
      ?.split(",")
      .map((segment) => segment.trim())
      .filter(Boolean) ?? [];
  if (algs.length === 0) {
    return [...DEFAULT_SUPABASE_JWT_ALGS];
  }
  const unknown = algs.filter((alg) => !isSupabaseJwtAlgorithm(alg));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown SUPABASE_JWT_ALGS value(s): ${unknown.join(", ")}. ` +
        `Allowed asymmetric algorithms: ${SUPABASE_JWT_ALGORITHMS.join(", ")}.`,
    );
  }
  return algs.filter(isSupabaseJwtAlgorithm);
}

/**
 * Fail closed on typos (§A N5): an unknown ACCOUNTING_RUNTIME_MODE must never silently
 * demote a production deploy to demo (the previous behavior). Unset still defaults to demo.
 */
function resolveRuntimeMode(modeEnv?: string): RuntimeMode {
  const raw = normalizeOptionalValue(modeEnv);
  if (raw === undefined) {
    return "demo";
  }
  const parsed = runtimeModeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Unknown ACCOUNTING_RUNTIME_MODE ${JSON.stringify(raw)} — expected "demo" or "normal".`);
  }
  return parsed.data;
}

/** PORT must be a whole TCP port; NaN or out-of-range values throw instead of booting on garbage (§A N5). */
function resolvePort(portEnv?: string): number {
  const raw = normalizeOptionalValue(portEnv);
  if (raw === undefined) {
    return 3001;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT ${JSON.stringify(raw)} — expected an integer between 1 and 65535.`);
  }
  return port;
}

/**
 * Resolved boot posture for the single structured boot log line (§A N5e) —
 * emitted once by `createApiRuntimeDependencies` in runtime.ts, NOT here:
 * `readApiRuntimeConfig` is also re-read lazily (knowledge.ts) and must stay
 * side-effect free. Derivable from config alone — never carries secrets or
 * connection strings.
 */
export function describeBootPosture(config: ApiRuntimeConfig) {
  return {
    level: "info",
    component: "api.boot",
    message: "resolved runtime posture",
    runtimeMode: config.runtimeMode,
    ledgerStore: config.runtimeMode === "demo" ? "memory" : config.supabase.databaseUrl ? "postgres" : "unavailable",
    authEnabled: config.auth.jwksUrl !== undefined,
    corsPolicy: config.corsPolicy.kind,
    corsOriginCount: config.corsPolicy.kind === "allowlist" ? config.corsPolicy.origins.length : 0,
    // Must mirror the app.ts limiter gate: the ALLOW_TEST_RESET bypass applies in demo mode only.
    rateLimitEnabled: !(config.allowTestReset && config.runtimeMode === "demo"),
  };
}

/**
 * Demo mode keeps the baked-in default so offline advisor runs work without env
 * wiring. Normal mode fail-closes: a missing or demo-default secret would let
 * attackers forge HMAC-signed tool approvals on the streamText path.
 */
function resolveAdvisorToolApprovalSecret(runtimeMode: RuntimeMode, envValue?: string): string {
  const configured = normalizeOptionalValue(envValue);

  if (runtimeMode === "normal") {
    if (!configured) {
      throw new Error(
        "ADVISOR_TOOL_APPROVAL_SECRET is required when ACCOUNTING_RUNTIME_MODE=normal. " +
          "Fail closed: the demo default would let anyone forge HMAC-signed tool approvals.",
      );
    }
    if (configured === DEMO_ADVISOR_TOOL_APPROVAL_SECRET) {
      throw new Error(
        "ADVISOR_TOOL_APPROVAL_SECRET must not be the demo default when ACCOUNTING_RUNTIME_MODE=normal. " +
          "Set a unique high-entropy secret before deploying.",
      );
    }
    return configured;
  }

  return configured ?? DEMO_ADVISOR_TOOL_APPROVAL_SECRET;
}

export function readApiRuntimeConfig(env: NodeJS.ProcessEnv = process.env): ApiRuntimeConfig {
  const mode = resolveRuntimeMode(env.ACCOUNTING_RUNTIME_MODE);

  const config: ApiRuntimeConfig = {
    port: resolvePort(env.PORT),
    runtimeMode: mode,
    allowTestReset: env.ALLOW_TEST_RESET === "true",
    corsPolicy: resolveCorsPolicy(mode, env.ACCOUNTING_CORS_ORIGINS),
    azureOpenAi: {
      endpoint: normalizeOptionalValue(env.AZURE_OPENAI_ENDPOINT),
      apiKey: normalizeOptionalValue(env.AZURE_OPENAI_API_KEY),
      model: normalizeOptionalValue(env.AZURE_OPENAI_MODEL),
    },
    supabase: {
      databaseUrl: normalizeOptionalValue(env.SUPABASE_DB_URL),
      poolerTransactionMode: env.SUPABASE_POOLER_TRANSACTION_MODE === "true",
    },
    azureStorage: {
      accountName: normalizeOptionalValue(env.AZURE_STORAGE_ACCOUNT),
      containerName: normalizeOptionalValue(env.AZURE_STORAGE_CONTAINER),
    },
    azureDocumentIntelligence: {
      endpoint: normalizeOptionalValue(env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT),
      apiKey: normalizeOptionalValue(env.AZURE_DOCUMENT_INTELLIGENCE_API_KEY),
    },
    auth: {
      jwksUrl: resolveJwksUrl(mode, env.SUPABASE_JWKS_URL),
      jwtAlgs: resolveJwtAlgs(env.SUPABASE_JWT_ALGS),
    },
    advisor: {
      toolApprovalSecret: resolveAdvisorToolApprovalSecret(mode, env.ADVISOR_TOOL_APPROVAL_SECRET),
    },
  };

  return config;
}
