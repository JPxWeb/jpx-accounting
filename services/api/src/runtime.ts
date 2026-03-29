import { createAiRuntime } from "@jpx-accounting/ai-core";
import type { LedgerStore } from "@jpx-accounting/domain";
import { MemoryLedgerStore, SupabaseLedgerStore } from "@jpx-accounting/domain";
import { createServiceClient } from "@jpx-accounting/supabase-client";

import type { ApiRuntimeConfig } from "./config";

export class LedgerStoreUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerStoreUnavailableError";
  }
}

class UnavailableLedgerStore implements LedgerStore {
  constructor(private readonly reason: string) {}

  private fail(): never {
    throw new LedgerStoreUnavailableError(this.reason);
  }

  createEvidence() {
    return this.fail();
  }

  composeEvidence() {
    return this.fail();
  }

  getEvidenceContext() {
    return this.fail();
  }

  findReviewByVoucher() {
    return this.fail();
  }

  getReviewFeed() {
    return this.fail();
  }

  getReports() {
    return this.fail();
  }

  getSnapshot() {
    return this.fail();
  }

  getEvents() {
    return this.fail();
  }

  suggestVoucher() {
    return this.fail();
  }

  applyReviewDecision() {
    return this.fail();
  }

  answerAssistantQuestion() {
    return this.fail();
  }

  runSimulation() {
    return this.fail();
  }

  getCloseRun() {
    return this.fail();
  }
}

export function createApiRuntimeDependencies(config: ApiRuntimeConfig) {
  if (config.runtimeMode === "demo") {
    return {
      runtimeMode: config.runtimeMode,
      store: new MemoryLedgerStore(),
      aiRuntime: createAiRuntime({
        runtimeMode: config.runtimeMode,
      }),
    };
  }

  if (config.supabase.url && config.supabase.serviceRoleKey) {
    const serviceClient = createServiceClient({
      url: config.supabase.url,
      serviceRoleKey: config.supabase.serviceRoleKey,
    });

    return {
      runtimeMode: config.runtimeMode,
      store: new SupabaseLedgerStore(serviceClient, {
        organizationId: "org_default",
        workspaceId: "workspace_main",
      }),
      aiRuntime: createAiRuntime({
        runtimeMode: config.runtimeMode,
        endpoint: config.azureOpenAi.endpoint,
        apiKey: config.azureOpenAi.apiKey,
        model: config.azureOpenAi.model,
      }),
    };
  }

  return {
    runtimeMode: config.runtimeMode,
    store: new UnavailableLedgerStore(
      "Workspace data is unavailable in normal mode until a non-demo LedgerStore implementation is configured.",
    ),
    aiRuntime: createAiRuntime({
      runtimeMode: config.runtimeMode,
      endpoint: config.azureOpenAi.endpoint,
      apiKey: config.azureOpenAi.apiKey,
      model: config.azureOpenAi.model,
    }),
  };
}
