import { createAiRuntime } from "@jpx-accounting/ai-core";
import type { LedgerStore } from "@jpx-accounting/domain";
import { MemoryLedgerStore } from "@jpx-accounting/domain";

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

export function isLedgerStoreOperational(store: LedgerStore): boolean {
  return !(store instanceof UnavailableLedgerStore);
}

export function createApiRuntimeDependencies(config: ApiRuntimeConfig) {
  if (config.runtimeMode === "demo") {
    return {
      runtimeMode: config.runtimeMode,
      corsPolicy: config.corsPolicy,
      store: new MemoryLedgerStore(),
      aiRuntime: createAiRuntime({
        runtimeMode: config.runtimeMode,
      }),
    };
  }

  return {
    runtimeMode: config.runtimeMode,
    corsPolicy: config.corsPolicy,
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
