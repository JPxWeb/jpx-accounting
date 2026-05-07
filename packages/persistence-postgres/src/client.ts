import postgres from "postgres";

export type PostgresClient = ReturnType<typeof postgres>;

export type PostgresClientConfig = {
  /** Postgres URL — direct (5432) or Supavisor session/transaction. */
  connectionString: string;
  /**
   * Set to false when connecting through Supavisor's transaction-mode pooler (port 6543);
   * named prepared statements are not supported there. Default: true (direct / session mode).
   */
  prepare?: boolean;
  /** Max pool size. Defaults to 10 — App Service is a long-lived single-instance process. */
  max?: number;
};

export function createPostgresClient(config: PostgresClientConfig): PostgresClient {
  const { connectionString, prepare = true, max = 10 } = config;
  return postgres(connectionString, {
    prepare,
    max,
    // Supabase requires SSL; postgres-js auto-detects sslmode=require from the URL but we set
    // the connect timeout explicitly so a hung TCP handshake fails fast at boot.
    connect_timeout: 10,
  });
}

export async function closePostgresClient(client: PostgresClient): Promise<void> {
  await client.end({ timeout: 5 });
}
