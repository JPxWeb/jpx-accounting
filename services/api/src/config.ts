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
};

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
  };
}
