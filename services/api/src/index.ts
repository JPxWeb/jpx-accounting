import { serve } from "@hono/node-server";

import { createApp } from "./app";
import { readApiRuntimeConfig } from "./config";
import { createApiRuntimeDependencies } from "./runtime";
import { initTelemetry } from "./telemetry";

// Telemetry first (WS-A5): no-op without APPLICATIONINSIGHTS_CONNECTION_STRING, and initTelemetry
// never throws — an init failure logs a structured warn and boot continues untelemetered. Fire and
// forget (no top-level await: the esbuild --format=cjs deploy bundle cannot express it), so the SDK
// loads concurrently with app wiring instead of delaying first listen.
void initTelemetry();

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
    // Azure App Service routes inbound traffic to PORT; bind all interfaces, not loopback-only.
    hostname: "0.0.0.0",
  },
  (info) => {
    console.log(`JPX Accounting API (${config.runtimeMode}) listening on http://${info.address}:${info.port}`);
  },
);
