import { serve } from "@hono/node-server";

import { createApp } from "./app";
import { readApiRuntimeConfig } from "./config";
import { createApiRuntimeDependencies } from "./runtime";

const config = readApiRuntimeConfig();
const { createLedgerStore, aiRuntime, runtimeMode, demoStoreRef } = createApiRuntimeDependencies(config);
const app = createApp({
  runtimeMode,
  aiRuntime,
  createLedgerStore,
  demoStoreRef,
  apiConfig: config,
  allowTestReset: config.allowTestReset,
  supabaseUrl: config.supabase.url,
  supabaseSecretKey: config.supabase.secretKey,
});

serve(
  {
    fetch: app.fetch,
    port: config.port,
  },
  (info) => {
    console.log(`JPX Accounting API (${runtimeMode}) listening on http://localhost:${info.port}`);
  },
);
