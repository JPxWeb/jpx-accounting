/**
 * Application Insights wiring (WS-A5 observability half).
 *
 * Bicep provisions the Application Insights resource and injects
 * `APPLICATIONINSIGHTS_CONNECTION_STRING` into the API App Service env; this module is
 * the sole consumer. Design constraints:
 *
 * - **Env-gated, zero overhead when off.** Without the connection string (demo/local/E2E),
 *   `initTelemetry()` returns immediately and the OpenTelemetry SDK graph is never loaded —
 *   the `@azure/monitor-opentelemetry` import below is dynamic, so merely importing this
 *   module has no side effects.
 * - **Never takes the service down.** Any init failure is caught and logged as a structured
 *   warn line (same JSON-line style as api.advisor / api.knowledge); boot proceeds untelemetered.
 * - **Bundle-safe.** The SDK is statically bundled by the root `bundle:api` esbuild step
 *   (--format=cjs) but only *executed* when the env var is present. Core-module (http)
 *   instrumentation still works in the bundle; instrumentation of inlined third-party
 *   packages (e.g. postgres-js) does not — acceptable for the MVP telemetry surface
 *   (requests, live metrics, standard metrics).
 */

/** Cloud role name shown in the Application Insights application map / live metrics. */
const CLOUD_ROLE_NAME = "jpx-api";

/** Fixed-ratio head sampling — keep ~20% of traces to bound ingestion cost. */
const SAMPLING_RATIO = 0.2;

export type TelemetryStatus =
  | { enabled: false; reason: "no-connection-string" }
  | { enabled: false; reason: "init-failed"; error: string }
  | { enabled: true };

/**
 * Initialize Azure Monitor OpenTelemetry when `APPLICATIONINSIGHTS_CONNECTION_STRING` is set.
 *
 * Call this FIRST at boot (before the Hono app is built). Absent connection string → no-op.
 * Never throws: failures resolve to `{ enabled: false, reason: "init-failed" }`.
 */
export async function initTelemetry(env: NodeJS.ProcessEnv = process.env): Promise<TelemetryStatus> {
  const connectionString = env.APPLICATIONINSIGHTS_CONNECTION_STRING?.trim();
  if (connectionString === undefined || connectionString === "") {
    return { enabled: false, reason: "no-connection-string" };
  }
  try {
    // Cloud role name maps from the OTel `service.name` resource attribute; the env-var
    // detector reads OTEL_SERVICE_NAME at init, which avoids importing @opentelemetry/resources
    // (an undeclared transitive) just to build a Resource object. Respect an explicit override.
    process.env.OTEL_SERVICE_NAME ??= CLOUD_ROLE_NAME;
    const { useAzureMonitor } = await import("@azure/monitor-opentelemetry");
    useAzureMonitor({
      azureMonitorExporterOptions: { connectionString },
      // tracesPerSecond (default 5) takes precedence over samplingRatio; 0 disables the
      // rate-limited sampler so the fixed ~20% ratio below actually applies (verified
      // against the installed @azure/monitor-opentelemetry@1.18.2 types).
      tracesPerSecond: 0,
      samplingRatio: SAMPLING_RATIO,
      enableLiveMetrics: true,
    });
    logTelemetry("info", "application insights initialized", {
      cloudRole: process.env.OTEL_SERVICE_NAME,
      samplingRatio: SAMPLING_RATIO,
    });
    return { enabled: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Observability must never take the API down — log and boot untelemetered.
    logTelemetry("warn", "application insights init failed; continuing without telemetry", {
      error: message,
    });
    return { enabled: false, reason: "init-failed", error: message };
  }
}

/** One structured telemetry log line (mirrors api.advisor's JSON-line style). */
function logTelemetry(level: "info" | "warn", message: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({ level, component: "api.telemetry", message, ...fields });
  if (level === "warn") console.warn(line);
  else console.log(line);
}
