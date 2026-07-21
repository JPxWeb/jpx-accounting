import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { initTelemetry } from "../../services/api/src/telemetry";

// NOTE: test order matters within this file — the no-op assertions must run before the
// init-failure test, which (by design) sets OTEL_SERVICE_NAME on its way into the SDK.

test("initTelemetry is a no-op without APPLICATIONINSIGHTS_CONNECTION_STRING", async () => {
  assert.equal(process.env.OTEL_SERVICE_NAME, undefined, "test precondition: OTEL_SERVICE_NAME unset");

  for (const env of [
    {},
    { APPLICATIONINSIGHTS_CONNECTION_STRING: "" },
    { APPLICATIONINSIGHTS_CONNECTION_STRING: "   " },
  ]) {
    const status = await initTelemetry(env);
    assert.deepEqual(status, { enabled: false, reason: "no-connection-string" });
  }

  // The SDK path was never entered: the cloud-role env var (set immediately before the SDK
  // import) is still untouched.
  assert.equal(process.env.OTEL_SERVICE_NAME, undefined);
});

test("telemetry module is import-side-effect free: SDK is only loaded via dynamic import", () => {
  // Regression pin for the demo/local zero-overhead guarantee: a static
  // `import ... from "@azure/monitor-opentelemetry"` would load the whole OTel SDK graph
  // (and its globals) on every boot, even when telemetry is off.
  const source = readFileSync(new URL("../../services/api/src/telemetry.ts", import.meta.url), "utf8");
  assert.match(source, /await import\("@azure\/monitor-opentelemetry"\)/);
  assert.doesNotMatch(source, /^import .*"@azure\/monitor-opentelemetry"/m);
});

test("initTelemetry catches SDK init failure instead of throwing (boot must survive)", async () => {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    // Malformed connection string: useAzureMonitor throws synchronously while constructing
    // the exporter (verified against @azure/monitor-opentelemetry@1.18.2).
    const status = await initTelemetry({
      APPLICATIONINSIGHTS_CONNECTION_STRING: "definitely-not-a-connection-string",
    });
    assert.equal(status.enabled, false);
    assert.ok(status.enabled === false && status.reason === "init-failed");
    assert.ok(status.error.length > 0, "failure status carries the error message");

    const line = warnings.find((entry) => entry.includes("api.telemetry"));
    assert.ok(line !== undefined, "init failure emits a structured warn line");
    const parsed = JSON.parse(line) as Record<string, unknown>;
    assert.equal(parsed["level"], "warn");
    assert.equal(parsed["component"], "api.telemetry");
    assert.equal(typeof parsed["error"], "string");
  } finally {
    console.warn = originalWarn;
    // initTelemetry defaults the cloud role before importing the SDK; clean up for any
    // later test in this process.
    delete process.env.OTEL_SERVICE_NAME;
  }
});
