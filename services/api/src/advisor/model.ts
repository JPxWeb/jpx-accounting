import { createAzure } from "@ai-sdk/azure";
import type { LanguageModel } from "ai";

/**
 * Azure OpenAI wiring for the advisor chat (Task 5.7, normal mode). Reads the
 * same AZURE_OPENAI_* config slice as ai-core's ResponsesAiRuntime — one env
 * surface, two consumers (finding 13): ai-core keeps `embed()` + the legacy
 * deterministic answers, the advisor chat streams through AI SDK 7.
 */
export type AdvisorModelConfig = {
  /** Azure OpenAI resource endpoint, e.g. `https://<resource>.openai.azure.com`. */
  endpoint?: string | undefined;
  apiKey?: string | undefined;
  /** Deployment name; defaults to the same model ai-core falls back to. */
  model?: string | undefined;
};

/** Mirrors ai-core's ResponsesAiRuntime default so both AI paths agree. */
const DEFAULT_ADVISOR_MODEL = "gpt-5-mini";

/**
 * Create the advisor's language model via `createAzure` (Responses API by
 * default in @ai-sdk/azure v4 — the provider's plain call form). Returns
 * `undefined` when endpoint/apiKey are missing so the chat route can answer
 * an honest 503 instead of failing mid-stream.
 */
export function createAdvisorModel(config: AdvisorModelConfig): LanguageModel | undefined {
  if (!config.endpoint || !config.apiKey) {
    return undefined;
  }
  const azure = createAzure({
    // `{baseURL}/v1{path}` is the resolved Azure OpenAI v1 URL — matching
    // ai-core's `${endpoint}/openai/v1/` base for the same resource.
    baseURL: `${config.endpoint.replace(/\/$/, "")}/openai`,
    apiKey: config.apiKey,
  });
  return azure(config.model ?? DEFAULT_ADVISOR_MODEL);
}
