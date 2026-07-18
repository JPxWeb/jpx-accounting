import { createAiRuntime } from "@jpx-accounting/ai-core";
import type { AiProvider } from "@jpx-accounting/contracts";
import { createDocumentIntelligenceClient } from "@jpx-accounting/document-intelligence";
import type { LedgerStore } from "@jpx-accounting/domain";
import { MemoryLedgerStore } from "@jpx-accounting/domain";
import { createPostgresClient, PostgresLedgerStore } from "@jpx-accounting/persistence-postgres";

import { createBlobUploader } from "./blob";
import { describeBootPosture, type ApiRuntimeConfig } from "./config";

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
    };
  }

  // Normal mode: prefer real Postgres if SUPABASE_DB_URL is configured. Otherwise stay fail-closed
  // via UnavailableLedgerStore so /ready surfaces the misconfiguration without crashing the boot.
  const store: LedgerStore = config.supabase.databaseUrl
    ? new PostgresLedgerStore(
        createPostgresClient({
          connectionString: config.supabase.databaseUrl,
          // Supavisor transaction-mode pooler (port 6543) does not support named prepared statements.
          prepare: !config.supabase.poolerTransactionMode,
        }),
        { organizationId: "org_jpx", workspaceId: "workspace_main" },
      )
    : new UnavailableLedgerStore("Workspace data is unavailable in normal mode until SUPABASE_DB_URL is configured.");

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
  };
}
