import { createAiRuntime } from "@jpx-accounting/ai-core";
import type { AiProvider } from "@jpx-accounting/contracts";
import { createDocumentIntelligenceClient } from "@jpx-accounting/document-intelligence";
import type { LedgerStore } from "@jpx-accounting/domain";
import { DEFAULT_TENANT_SCOPE, MemoryLedgerStore } from "@jpx-accounting/domain";
import {
  closePostgresClient,
  createPostgresClient,
  PostgresLedgerStore,
  type PostgresClient,
} from "@jpx-accounting/persistence-postgres";

import { createBlobUploader } from "./blob";
import { describeBootPosture, derivePrepareFromPoolMode, type ApiRuntimeConfig } from "./config";
import { configureKnowledgeDatabaseClient } from "./knowledge";

/**
 * Transparency metadata for `GET /api/runtime-info` (advisory pivot Phase 5).
 * Derived once at boot from the same config the AI runtime factory reads:
 * demo → local-demo; normal + configured → azure-openai (+ model/endpoint
 * host); else unavailable. Never carries secrets.
 */
export type AiRuntimeMetadata = {
  provider: AiProvider;
  model?: string | undefined;
  endpointHost?: string | undefined;
};

function buildAiMetadata(config: ApiRuntimeConfig): AiRuntimeMetadata {
  if (config.runtimeMode === "demo") {
    return { provider: "local-demo" };
  }
  const { endpoint, apiKey, model } = config.azureOpenAi;
  // Mirrors createAiRuntime's selection: endpoint + apiKey → ResponsesAiRuntime.
  if (endpoint && apiKey) {
    let endpointHost: string | undefined;
    try {
      endpointHost = new URL(endpoint).host;
    } catch {
      endpointHost = undefined;
    }
    return { provider: "azure-openai", model, endpointHost };
  }
  return { provider: "unavailable" };
}

// Wires LedgerStore + AI implementations from `ApiRuntimeConfig`. Demo always uses MemoryLedgerStore; normal mode intentionally uses an unavailable stub until persistence lands.
export class LedgerStoreUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerStoreUnavailableError";
  }
}

export class UnavailableLedgerStore implements LedgerStore {
  constructor(private readonly reason: string) {}

  private fail(): never {
    throw new LedgerStoreUnavailableError(this.reason);
  }

  /** Readiness probe (WS-A5): fail-closed stores always reject, so /ready reports ledger=false. */
  async ping(): Promise<void> {
    return this.fail();
  }

  async createEvidence() {
    return this.fail();
  }

  async composeEvidence() {
    return this.fail();
  }

  async getEvidenceContext() {
    return this.fail();
  }

  async updateEvidenceExtraction() {
    return this.fail();
  }

  async importSie() {
    return this.fail();
  }

  async findReviewByVoucher() {
    return this.fail();
  }

  async getReviewFeed() {
    return this.fail();
  }

  async getReports() {
    return this.fail();
  }

  async getReportPack() {
    return this.fail();
  }

  async getSnapshot() {
    return this.fail();
  }

  async getEvents() {
    return this.fail();
  }

  async suggestVoucher() {
    return this.fail();
  }

  async applyReviewDecision() {
    return this.fail();
  }

  async answerAssistantQuestion() {
    return this.fail();
  }

  async runSimulation() {
    return this.fail();
  }

  async getCloseRun() {
    return this.fail();
  }

  async refreshComplianceAlerts() {
    return this.fail();
  }

  async getCompanySettings() {
    return this.fail();
  }

  async putCompanySettings() {
    return this.fail();
  }
}

/**
 * Readiness probe for /ready (WS-A5): a real check instead of the old
 * instanceof test. Stores exposing an optional `ping()` are probed for real
 * (PostgresLedgerStore runs SELECT 1; UnavailableLedgerStore rejects);
 * stores without one (MemoryLedgerStore) resolve as a no-op. `ping` stays a
 * structural seam rather than a `LedgerStore` interface member so the
 * interface in packages/domain/src/store.ts is untouched.
 */
export async function pingLedgerStore(store: LedgerStore): Promise<void> {
  const candidate = store as LedgerStore & { ping?: () => Promise<void> };
  if (typeof candidate.ping === "function") {
    await candidate.ping();
  }
}

/** No-op close for wiring that never opened a shared database client (demo mode, or normal mode without a runtime URL). */
async function closeNothing(): Promise<void> {}

export function createApiRuntimeDependencies(config: ApiRuntimeConfig) {
  // ONE structured boot log line (§A N5e): operators see the resolved posture without diffing env vars.
  console.log(JSON.stringify(describeBootPosture(config)));

  const blobUploader = createBlobUploader({
    accountName: config.azureStorage.accountName,
    containerName: config.azureStorage.containerName,
  });
  const documentIntelligence = createDocumentIntelligenceClient({
    endpoint: config.azureDocumentIntelligence.endpoint,
    apiKey: config.azureDocumentIntelligence.apiKey,
  });

  // Advisor chat wiring (Task 5.7): approval-signing secret + the Azure
  // OpenAI slice the normal-mode model factory reads. Same env surface as
  // ai-core — createApp decides per runtime mode whether to build the model.
  const advisor = {
    toolApprovalSecret: config.advisor.toolApprovalSecret,
    azureOpenAi: config.azureOpenAi,
  };

  if (config.runtimeMode === "demo") {
    // Reset any client injected by a previous call in the same process (relevant to tests that
    // construct dependencies repeatedly) — demo mode never talks to Postgres.
    configureKnowledgeDatabaseClient(null);
    return {
      runtimeMode: config.runtimeMode,
      corsPolicy: config.corsPolicy,
      store: new MemoryLedgerStore(),
      aiRuntime: createAiRuntime({
        runtimeMode: config.runtimeMode,
      }),
      blobUploader,
      documentIntelligence,
      aiMetadata: buildAiMetadata(config),
      advisor,
      jwksUrl: config.auth.jwksUrl,
      jwtAlgs: config.auth.jwtAlgs,
      closeDatabase: closeNothing,
    };
  }

  // Normal mode: ONE bounded PostgresClient (Task 3 connection ownership) shared by the ledger
  // store AND knowledge/vector retrieval — instead of each wiring path opening its own pool.
  // Otherwise stay fail-closed via UnavailableLedgerStore so /ready surfaces the misconfiguration
  // without crashing the boot.
  const runtimeUrl = config.database.runtimeUrl;
  const databaseClient: PostgresClient | undefined = runtimeUrl
    ? createPostgresClient({
        connectionString: runtimeUrl,
        prepare: derivePrepareFromPoolMode(config.database.poolMode),
        max: config.database.poolMax,
      })
    : undefined;

  // Inject the SAME client into knowledge.ts's vector retrieval instead of letting it open its
  // own second, never-closed pool.
  configureKnowledgeDatabaseClient(databaseClient ?? null);

  const store: LedgerStore = databaseClient
    ? new PostgresLedgerStore(databaseClient, DEFAULT_TENANT_SCOPE)
    : new UnavailableLedgerStore("Workspace data is unavailable in normal mode until DATABASE_URL is configured.");

  const closeDatabase = databaseClient ? () => closePostgresClient(databaseClient) : closeNothing;

  return {
    runtimeMode: config.runtimeMode,
    corsPolicy: config.corsPolicy,
    store,
    aiRuntime: createAiRuntime({
      runtimeMode: config.runtimeMode,
      endpoint: config.azureOpenAi.endpoint,
      apiKey: config.azureOpenAi.apiKey,
      model: config.azureOpenAi.model,
    }),
    blobUploader,
    documentIntelligence,
    aiMetadata: buildAiMetadata(config),
    advisor,
    jwksUrl: config.auth.jwksUrl,
    jwtAlgs: config.auth.jwtAlgs,
    /** Closes the shared Postgres pool; wired to SIGTERM/SIGINT via `registerGracefulShutdown` in `index.ts`. */
    closeDatabase,
  };
}
