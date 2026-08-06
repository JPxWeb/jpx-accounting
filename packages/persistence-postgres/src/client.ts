import postgres from "postgres";

export type PostgresClient = ReturnType<typeof postgres>;

/** Identifies this app's connections in `pg_stat_activity` — helps distinguish it from other clients sharing a provider. */
const DEFAULT_APPLICATION_NAME = "jpx-accounting";

export type PostgresClientConfig = {
  /** Postgres URL — direct, session-pooler, or transaction-pooler. Provider-neutral: any PostgreSQL 15-17 server. */
  connectionString: string;
  /**
   * Set to false when connecting through a transaction-mode pooler (e.g. Supavisor port 6543);
   * named prepared statements are not supported there. Default: true (direct / session mode).
   * Callers derive this from their own pool-mode concept (e.g. `derivePrepareFromPoolMode` in
   * services/api/src/config.ts) — this package stays provider/app-env-name agnostic.
   */
  prepare?: boolean;
  /** Max pool size. Defaults to 10 — App Service is a long-lived single-instance process. */
  max?: number;
  /** `application_name` reported to the server (visible in `pg_stat_activity`). Default: "jpx-accounting". */
  applicationName?: string;
};

export function createPostgresClient(config: PostgresClientConfig): PostgresClient {
  const { connectionString, prepare = true, max = 10, applicationName = DEFAULT_APPLICATION_NAME } = config;
  return postgres(connectionString, {
    prepare,
    max,
    connection: { application_name: applicationName },
    // Most managed providers require SSL; postgres-js auto-detects sslmode=require from the URL
    // but we set the connect timeout explicitly so a hung TCP handshake fails fast at boot.
    connect_timeout: 10,
  });
}

export async function closePostgresClient(client: PostgresClient): Promise<void> {
  await client.end({ timeout: 5 });
}
