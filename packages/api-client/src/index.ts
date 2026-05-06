// Browser/RN-friendly client against the Accounting API HTTP surface. Responses are validated with Zod schemas from `@jpx-accounting/contracts`
// when `baseUrl` is set — the demo in-memory fallback returns the same domain shapes directly (still contract-aligned).

import type { ZodType } from "zod";

import type {
  AssistantRequest,
  AssistantSession,
  EvidenceCreateInput,
  ReviewDecisionInput,
  ReviewTask,
  RuntimeMode,
  SimulationRequest,
  SimulationRun,
} from "@jpx-accounting/contracts";
import {
  assistantSessionSchema,
  evidenceCreateResultSchema,
  reviewTaskSchema,
  simulationRunSchema,
  workspaceSnapshotSchema,
} from "@jpx-accounting/contracts";
import { MemoryLedgerStore } from "@jpx-accounting/domain";

type RequestOptions = RequestInit & { json?: unknown };
type AccountingApiClientOptions = {
  baseUrl?: string | undefined;
  runtimeMode: RuntimeMode;
};

export class AccountingApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(detail);
    this.name = "AccountingApiError";
  }
}

async function parseJsonBody<T>(response: Response, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new AccountingApiError(response.status, "Accounting API returned invalid JSON.");
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AccountingApiError(502, "Accounting API response did not match the shared contract.");
  }

  return parsed.data;
}

async function requestJson<T>(baseUrl: string, path: string, schema: ZodType<T>, options?: RequestOptions): Promise<T> {
  const init: RequestInit = {
    headers: {
      "content-type": "application/json",
      ...(options?.headers ?? {}),
    },
  };

  if (options?.method !== undefined) {
    init.method = options.method;
  }

  if (options?.body !== undefined) {
    init.body = options.body;
  } else if (options?.json !== undefined) {
    init.body = JSON.stringify(options.json);
  }

  const response = await fetch(`${baseUrl}${path}`, init);

  if (!response.ok) {
    const payload = await response.json().catch(() => undefined as { error?: string; message?: string } | undefined);
    throw new AccountingApiError(
      response.status,
      payload?.error ?? payload?.message ?? `Request failed: ${response.status} ${response.statusText}`,
    );
  }

  return parseJsonBody(response, schema);
}

export class AccountingApiClient {
  private readonly fallbackStore?: MemoryLedgerStore;

  constructor(private readonly options: AccountingApiClientOptions) {
    if (options.runtimeMode === "demo" && !options.baseUrl) {
      // Demo mode keeps the scaffold usable without booting the API so preview flows stay intentional rather than accidental.
      this.fallbackStore = new MemoryLedgerStore();
    }
  }

  private get baseUrl() {
    return this.options.baseUrl;
  }

  async getSnapshot() {
    if (this.fallbackStore) return this.fallbackStore.getSnapshot();
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return requestJson(this.baseUrl, "/api/workspace", workspaceSnapshotSchema);
  }

  async createEvidence(input: EvidenceCreateInput) {
    if (this.fallbackStore) return this.fallbackStore.createEvidence(input);
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return requestJson(this.baseUrl, "/api/evidence", evidenceCreateResultSchema, { method: "POST", json: input });
  }

  async approveReview(reviewId: string, input: ReviewDecisionInput): Promise<ReviewTask | undefined> {
    if (this.fallbackStore) return this.fallbackStore.applyReviewDecision(reviewId, "approve", input);
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return requestJson(this.baseUrl, `/api/reviews/${reviewId}/approve`, reviewTaskSchema, {
      method: "POST",
      json: input,
    });
  }

  async askAssistant(input: AssistantRequest): Promise<AssistantSession> {
    if (this.fallbackStore) return this.fallbackStore.answerAssistantQuestion(input.question);
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return requestJson(this.baseUrl, "/api/assistant/sessions", assistantSessionSchema, {
      method: "POST",
      json: input,
    });
  }

  async runSimulation(input: SimulationRequest): Promise<SimulationRun> {
    if (this.fallbackStore) return this.fallbackStore.runSimulation(input);
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return requestJson(this.baseUrl, "/api/simulations/run", simulationRunSchema, { method: "POST", json: input });
  }
}

export function createAccountingApiClient(options: AccountingApiClientOptions) {
  return new AccountingApiClient(options);
}
