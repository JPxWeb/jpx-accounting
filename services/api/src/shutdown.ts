type ClosableServer = {
  close(callback?: (err?: Error) => void): unknown;
  closeIdleConnections?: () => void;
};

/** Minimal process surface for signal wiring — avoids requiring Process return chaining in tests. */
type ShutdownProcess = {
  once(signal: string, fn: () => void): void;
  exit(code: number): void;
};

export type GracefulShutdownOptions = {
  server: ClosableServer;
  closeDatabase: () => Promise<void>;
  /** Injectable for tests; defaults to the real process. */
  proc?: ShutdownProcess;
  /** Watchdog ceiling; must stay below the App Service stop grace period. */
  watchdogMs?: number;
};

/** Wires SIGTERM/SIGINT to drain: stop accepting connections, close the shared Postgres pool, exit 0. */
export function registerGracefulShutdown({
  server,
  closeDatabase,
  proc = process,
  watchdogMs = 10_000,
}: GracefulShutdownOptions): (signal: string) => Promise<void> {
  let draining = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (draining) return;
    draining = true;
    console.log(JSON.stringify({ level: "info", component: "api.shutdown", message: `received ${signal} — draining` }));
    const watchdog = setTimeout(() => proc.exit(1), watchdogMs);
    watchdog.unref();
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeIdleConnections?.();
    await closed;
    try {
      await closeDatabase();
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          component: "api.shutdown",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    proc.exit(0);
  };
  proc.once("SIGTERM", () => void shutdown("SIGTERM"));
  proc.once("SIGINT", () => void shutdown("SIGINT"));
  return shutdown;
}
