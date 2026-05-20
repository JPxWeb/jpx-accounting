import { createAiRuntime } from "@jpx-accounting/ai-core";
import { MemoryLedgerStore } from "@jpx-accounting/domain";
import type { SupabaseClient } from "@jpx-accounting/supabase-client";
import { createServiceClient } from "@jpx-accounting/supabase-client";

import type { ApiRuntimeConfig } from "./config";
import { createLedgerStore, type LedgerStoreScope } from "./store-factory";

export class LedgerStoreUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerStoreUnavailableError";
  }
}

export const LEDGER_STORE_UNAVAILABLE_REASON =
  "Workspace data is unavailable in normal mode until a non-demo LedgerStore implementation is configured.";

export function createApiRuntimeDependencies(config: ApiRuntimeConfig) {
  const demoStoreRef = { current: new MemoryLedgerStore() };
  const supabase =
    config.runtimeMode === "normal" && config.supabase.url && config.supabase.secretKey
      ? createServiceClient({
          url: config.supabase.url,
          serviceRoleKey: config.supabase.secretKey,
        })
      : null;

  const aiRuntime =
    config.runtimeMode === "demo"
      ? createAiRuntime({ runtimeMode: config.runtimeMode })
      : createAiRuntime({
          runtimeMode: config.runtimeMode,
          endpoint: config.azureOpenAi.endpoint,
          apiKey: config.azureOpenAi.apiKey,
          model: config.azureOpenAi.model,
        });

  return {
    runtimeMode: config.runtimeMode,
    demoStoreRef,
    supabase: supabase as SupabaseClient | null,
    aiRuntime,
    createLedgerStore: (scope: LedgerStoreScope) =>
      createLedgerStore(
        {
          runtimeMode: config.runtimeMode,
          supabase,
          demoStoreRef,
        },
        scope,
      ),
  };
}
