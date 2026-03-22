import { runtimeModeSchema, type RuntimeMode } from "@jpx-accounting/contracts";

export type ApiRuntimeConfig = {
  port: number;
  runtimeMode: RuntimeMode;
  allowTestReset: boolean;
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

export function readApiRuntimeConfig(env: NodeJS.ProcessEnv = process.env): ApiRuntimeConfig {
  const runtimeMode = runtimeModeSchema.safeParse(env.ACCOUNTING_RUNTIME_MODE ?? "demo");

  return {
    port: Number(env.PORT ?? 3001),
    runtimeMode: runtimeMode.success ? runtimeMode.data : "demo",
    allowTestReset: env.ALLOW_TEST_RESET === "true",
    azureOpenAi: {
      endpoint: normalizeOptionalValue(env.AZURE_OPENAI_ENDPOINT),
      apiKey: normalizeOptionalValue(env.AZURE_OPENAI_API_KEY),
      model: normalizeOptionalValue(env.AZURE_OPENAI_MODEL) ?? "gpt-5-mini",
    },
  };
}
