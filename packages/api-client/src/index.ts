import type {
  AssistantRequest,
  AssistantSession,
  EvidenceCreateResult,
  EvidenceCreateInput,
  ReviewTask,
  ReviewDecisionInput,
  SimulationRun,
  SimulationRequest,
  WorkspaceSnapshot,
} from "@jpx-accounting/contracts";
import { MemoryLedgerStore } from "@jpx-accounting/domain";

type RequestOptions = RequestInit & { json?: unknown };

async function request<T>(baseUrl: string, path: string, options?: RequestOptions): Promise<T> {
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
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

export class AccountingApiClient {
  // Keeping a local fallback store makes the UI previewable even when the Hono API is not running yet.
  private readonly fallbackStore = new MemoryLedgerStore();

  constructor(private readonly baseUrl?: string) {}

  async getSnapshot() {
    if (!this.baseUrl) return this.fallbackStore.getSnapshot();
    return request<WorkspaceSnapshot>(this.baseUrl, "/api/workspace");
  }

  async createEvidence(input: EvidenceCreateInput) {
    if (!this.baseUrl) return this.fallbackStore.createEvidence(input);
    return request<EvidenceCreateResult>(this.baseUrl, "/api/evidence", { method: "POST", json: input });
  }

  async approveReview(reviewId: string, input: ReviewDecisionInput): Promise<ReviewTask | undefined> {
    if (!this.baseUrl) return this.fallbackStore.applyReviewDecision(reviewId, "approve", input);
    return request<ReviewTask>(this.baseUrl, `/api/reviews/${reviewId}/approve`, { method: "POST", json: input });
  }

  async askAssistant(input: AssistantRequest): Promise<AssistantSession> {
    if (!this.baseUrl) return this.fallbackStore.answerAssistantQuestion(input.question);
    return request<AssistantSession>(this.baseUrl, "/api/assistant/sessions", { method: "POST", json: input });
  }

  async runSimulation(input: SimulationRequest): Promise<SimulationRun> {
    if (!this.baseUrl) return this.fallbackStore.runSimulation(input);
    return request<SimulationRun>(this.baseUrl, "/api/simulations/run", { method: "POST", json: input });
  }
}

export function createAccountingApiClient(baseUrl?: string) {
  return new AccountingApiClient(baseUrl);
}
