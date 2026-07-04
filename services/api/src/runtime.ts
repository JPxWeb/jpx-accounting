import { createAiRuntime } from "@jpx-accounting/ai-core";
import { createDocumentIntelligenceClient } from "@jpx-accounting/document-intelligence";
import type { LedgerStore } from "@jpx-accounting/domain";
import { MemoryLedgerStore } from "@jpx-accounting/domain";
import { createPostgresClient, PostgresLedgerStore } from "@jpx-accounting/persistence-postgres";

import { createBlobUploader } from "./blob";
import type { ApiRuntimeConfig } from "./config";

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

export function isLedgerStoreOperational(store: LedgerStore): boolean {
  return !(store instanceof UnavailableLedgerStore);
}

export function createApiRuntimeDependencies(config: ApiRuntimeConfig) {
  const blobUploader = createBlobUploader({
    accountName: config.azureStorage.accountName,
    containerName: config.azureStorage.containerName,
  });
  const documentIntelligence = createDocumentIntelligenceClient({
    endpoint: config.azureDocumentIntelligence.endpoint,
    apiKey: config.azureDocumentIntelligence.apiKey,
  });

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
      jwksUrl: config.auth.jwksUrl,
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
    jwksUrl: config.auth.jwksUrl,
  };
}
