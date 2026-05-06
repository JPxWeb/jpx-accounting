import { serve } from "@hono/node-server";

import { createApp } from "./app";
import { readApiRuntimeConfig } from "./config";
import { createApiRuntimeDependencies } from "./runtime";

// Loads `ApiRuntimeConfig`, builds Hono app wiring, and starts @hono/node-server. Local dev uses tsx (`pnpm dev:api`).
const config = readApiRuntimeConfig();
const runtime = createApiRuntimeDependencies(config);
const app = createApp({
  ...runtime,
  allowTestReset: config.allowTestReset,
});

serve(
  {
    fetch: app.fetch,
    port: config.port,
  },
  (info) => {
    console.log(`JPX Accounting API (${config.runtimeMode}) listening on http://localhost:${info.port}`);
  },
);
