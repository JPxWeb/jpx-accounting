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
    /** Full JWKS URL — typically `${SUPABASE_URL}/auth/v1/keys`. When set, /api/* mutations require a valid JWT. */
    jwksUrl?: string | undefined;
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
  const runtimeMode = runtimeModeSchema.safeParse(env.ACCOUNTING_RUNTIME_MODE ?? "demo");

  const mode = runtimeMode.success ? runtimeMode.data : "demo";

  return {
    port: Number(env.PORT ?? 3001),
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
      jwksUrl: normalizeOptionalValue(env.SUPABASE_JWKS_URL),
    },
    advisor: {
      toolApprovalSecret: resolveAdvisorToolApprovalSecret(mode, env.ADVISOR_TOOL_APPROVAL_SECRET),
    },
  };
}
