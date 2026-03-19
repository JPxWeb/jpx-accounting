import OpenAI from "openai";
import { z } from "zod";

import type { AccountingSuggestion, AssistantSession, Citation, Voucher } from "@jpx-accounting/contracts";
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

class ResponsesAiRuntime implements AiRuntime {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor() {
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    this.model = process.env.AZURE_OPENAI_MODEL ?? "gpt-5-mini";

    if (!apiKey || !endpoint) {
      throw new Error("Azure OpenAI credentials are required for the Responses AI runtime.");
    }

    this.client = new OpenAI({
      apiKey,
      baseURL: `${endpoint.replace(/\/$/, "")}/openai/v1/`,
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

    const response = await (this.client.responses as any).create({
      model: this.model,
      input: prompt,
    });

    const rawText =
      response?.output_text ??
      response?.output?.[0]?.content?.[0]?.text ??
      "{\"answer\":\"No grounded answer could be produced.\"}";

    return {
      id: crypto.randomUUID(),
      question,
      answer: normalizeAnswer(rawText),
      status: "grounded" as const,
      citations,
    };
  }
}

export function createAiRuntime(): AiRuntime {
  // Production uses Azure Responses, but the factory intentionally degrades to a deterministic local runtime for development and demos.
  if (process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT) {
    return new ResponsesAiRuntime();
  }

  return new LocalAiRuntime();
}
