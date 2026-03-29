import type { AccountingSuggestion, AssistantSession, Citation, RuntimeMode, Voucher } from "@jpx-accounting/contracts";
import { buildDeterministicSuggestion, evaluateVoucherRules } from "@jpx-accounting/domain";
import OpenAI from "openai";
import { z } from "zod";

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
};

export type AiRuntimeFactoryOptions = {
  runtimeMode: RuntimeMode;
  apiKey?: string | undefined;
  endpoint?: string | undefined;
  model?: string | undefined;
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
};

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
}

class ResponsesAiRuntime implements AiRuntime {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config: ResponsesAiRuntimeConfig) {
    this.model = config.model ?? "gpt-5-mini";
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
    });
  }

  return new UnavailableAiRuntime(
    "Assistant runtime is unavailable in normal mode because Azure OpenAI endpoint and API key are not configured.",
  );
}
