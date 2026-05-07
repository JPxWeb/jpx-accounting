import OpenAI from "openai";
import { z } from "zod";

import type { AccountingSuggestion, AssistantSession, Citation, RuntimeMode, Voucher } from "@jpx-accounting/contracts";
import { buildDeterministicSuggestion, evaluateVoucherRules } from "@jpx-accounting/domain";

const answerSchema = z.object({
  answer: z.string(),
});

function normalizeAnswer(rawText: string) {
  try {
    const parsed = answerSchema.safeParse(JSON.parse(rawText));
    if (parsed.success) {
      return parsed.data.answer;
    }
  } catch {
    // Fall back to raw text because model responses can drift even when we request JSON.
  }

  return rawText.trim() || "No grounded answer could be produced.";
}

export type AiRuntime = {
  suggestPosting(voucher: Voucher): Promise<AccountingSuggestion>;
  answerQuestion(question: string, citations: Citation[]): Promise<AssistantSession>;
  /**
   * Embed one or more strings into vectors for grounded retrieval (pgvector / Azure AI Search).
   * Defaults to `text-embedding-3-small` (1536 dims). The migration in 0003_pgvector.sql declares
   * `halfvec(1536)` to match. Switching to `text-embedding-3-large` (3072 dims) requires a column-
   * type bump first — surface that as a deliberate choice, not a silent default.
   */
  embed(input: EmbedInput): Promise<EmbedResult>;
};

export type EmbedInput = {
  texts: string[];
  /** Override the model. Default: `text-embedding-3-small`. */
  model?: string | undefined;
};

export type EmbedResult = {
  model: string;
  dimensions: number;
  vectors: number[][];
};

export type AiRuntimeFactoryOptions = {
  runtimeMode: RuntimeMode;
  apiKey?: string | undefined;
  endpoint?: string | undefined;
  model?: string | undefined;
  /** Optional override for the embedding model; default: `text-embedding-3-small`. */
  embeddingModel?: string | undefined;
};

export class AiRuntimeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiRuntimeUnavailableError";
  }
}

type ResponsesAiRuntimeConfig = {
  apiKey: string;
  endpoint: string;
  model?: string | undefined;
  embeddingModel?: string | undefined;
};

const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_EMBEDDING_DIMS = 1536;

/**
 * Deterministic mock embedding for demo/offline. Pads or truncates a string-hash-derived vector
 * to the target dimension so callers exercising the indexing path get stable values per input.
 */
function mockEmbed(text: string, dims: number): number[] {
  const out = new Array<number>(dims);
  let seed = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    seed = Math.imul(seed ^ text.charCodeAt(i), 16777619) >>> 0;
  }
  for (let i = 0; i < dims; i += 1) {
    seed = Math.imul(seed, 16807) >>> 0;
    out[i] = ((seed & 0xffff) / 0xffff) * 2 - 1;
  }
  return out;
}

class LocalAiRuntime implements AiRuntime {
  // The local runtime keeps the product interactive in development and during offline demos before Azure credentials are present.
  async suggestPosting(voucher: Voucher) {
    return buildDeterministicSuggestion(voucher, evaluateVoucherRules(voucher));
  }

  async answerQuestion(question: string, citations: Citation[]) {
    return {
      id: crypto.randomUUID(),
      question,
      answer:
        "Local AI fallback is active. In production this response is grounded through Azure AI Search retrieval and Azure OpenAI Responses.",
      status: "grounded" as const,
      citations,
    };
  }

  async embed(input: EmbedInput): Promise<EmbedResult> {
    const model = input.model ?? DEFAULT_EMBEDDING_MODEL;
    return {
      model,
      dimensions: DEFAULT_EMBEDDING_DIMS,
      vectors: input.texts.map((text) => mockEmbed(text, DEFAULT_EMBEDDING_DIMS)),
    };
  }
}

class UnavailableAiRuntime implements AiRuntime {
  constructor(private readonly reason: string) {}

  private fail(): never {
    throw new AiRuntimeUnavailableError(this.reason);
  }

  async suggestPosting(_voucher: Voucher): Promise<AccountingSuggestion> {
    return this.fail();
  }

  async answerQuestion(_question: string, _citations: Citation[]): Promise<AssistantSession> {
    return this.fail();
  }

  async embed(_input: EmbedInput): Promise<EmbedResult> {
    return this.fail();
  }
}

/** False when AI was not configured (`UnavailableAiRuntime` in normal mode). */
export function isAiRuntimeOperational(runtime: AiRuntime): boolean {
  return !(runtime instanceof UnavailableAiRuntime);
}

class ResponsesAiRuntime implements AiRuntime {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly embeddingModel: string;

  constructor(config: ResponsesAiRuntimeConfig) {
    this.model = config.model ?? "gpt-5-mini";
    this.embeddingModel = config.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: `${config.endpoint.replace(/\/$/, "")}/openai/v1/`,
    });
  }

  async suggestPosting(voucher: Voucher) {
    return buildDeterministicSuggestion(voucher, evaluateVoucherRules(voucher));
  }

  async answerQuestion(question: string, citations: Citation[]) {
    const prompt = [
      "You are an internal Swedish accounting copilot.",
      "Always stay grounded in supplied sources and never imply that the answer is a posted accounting action.",
      `Question: ${question}`,
      `Sources:\n${citations.map((citation) => `- ${citation.title}: ${citation.excerpt}`).join("\n")}`,
      "Return concise plain JSON with an 'answer' field.",
    ].join("\n\n");

    const response = await this.client.responses.create({
      model: this.model,
      input: prompt,
    });

    const rawText = response.output_text || '{"answer":"No grounded answer could be produced."}';

    return {
      id: crypto.randomUUID(),
      question,
      answer: normalizeAnswer(rawText),
      status: "grounded" as const,
      citations,
    };
  }

  async embed(input: EmbedInput): Promise<EmbedResult> {
    const model = input.model ?? this.embeddingModel;
    const response = await this.client.embeddings.create({
      model,
      input: input.texts,
    });
    const vectors = response.data.map((entry) => entry.embedding);
    const dimensions = vectors[0]?.length ?? 0;
    return { model, dimensions, vectors };
  }
}

export function createAiRuntime(config: AiRuntimeFactoryOptions): AiRuntime {
  if (config.runtimeMode === "demo") {
    return new LocalAiRuntime();
  }

  if (config.apiKey && config.endpoint) {
    return new ResponsesAiRuntime({
      apiKey: config.apiKey,
      endpoint: config.endpoint,
      model: config.model,
      embeddingModel: config.embeddingModel,
    });
  }

  return new UnavailableAiRuntime(
    "Assistant runtime is unavailable in normal mode because Azure OpenAI endpoint and API key are not configured.",
  );
}
