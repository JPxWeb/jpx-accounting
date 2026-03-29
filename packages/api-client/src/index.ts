import type {
  AssistantRequest,
  AssistantSession,
  EvidenceCreateInput,
  EvidenceCreateResult,
  ReviewDecisionInput,
  ReviewTask,
  RuntimeMode,
  SimulationRequest,
  SimulationRun,
  WorkspaceSnapshot,
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
    const payload = await response.json().catch(() => undefined as { error?: string; message?: string } | undefined);
    throw new AccountingApiError(
      response.status,
      payload?.error ?? payload?.message ?? `Request failed: ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as T;
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
    if (this.fallbackStore) return await this.fallbackStore.getSnapshot();
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return request<WorkspaceSnapshot>(this.baseUrl, "/api/workspace");
  }

  async createEvidence(input: EvidenceCreateInput) {
    if (this.fallbackStore) return await this.fallbackStore.createEvidence(input);
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return request<EvidenceCreateResult>(this.baseUrl, "/api/evidence", { method: "POST", json: input });
  }

  async approveReview(reviewId: string, input: ReviewDecisionInput): Promise<ReviewTask | undefined> {
    if (this.fallbackStore) return await this.fallbackStore.applyReviewDecision(reviewId, "approve", input);
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return request<ReviewTask>(this.baseUrl, `/api/reviews/${reviewId}/approve`, { method: "POST", json: input });
  }

  async askAssistant(input: AssistantRequest): Promise<AssistantSession> {
    if (this.fallbackStore) return await this.fallbackStore.answerAssistantQuestion(input.question);
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return request<AssistantSession>(this.baseUrl, "/api/assistant/sessions", { method: "POST", json: input });
  }

  async runSimulation(input: SimulationRequest): Promise<SimulationRun> {
    if (this.fallbackStore) return await this.fallbackStore.runSimulation(input);
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return request<SimulationRun>(this.baseUrl, "/api/simulations/run", { method: "POST", json: input });
  }
}

export function createAccountingApiClient(options: AccountingApiClientOptions) {
  return new AccountingApiClient(options);
}
