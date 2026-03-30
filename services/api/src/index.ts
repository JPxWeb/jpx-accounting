import { serve } from "@hono/node-server";

import { createApp } from "./app";
import { readApiRuntimeConfig } from "./config";
import { createApiRuntimeDependencies } from "./runtime";

const config = readApiRuntimeConfig();
const { store, aiRuntime, runtimeMode } = createApiRuntimeDependencies(config);
const app = createApp({
  store,
  aiRuntime,
  runtimeMode,
  allowTestReset: config.allowTestReset,
  supabaseUrl: config.supabase.url,
  supabaseServiceRoleKey: config.supabase.serviceRoleKey,
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
