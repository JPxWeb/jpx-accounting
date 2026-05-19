import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type { SupabaseClient } from "@supabase/supabase-js";

export type SupabaseClientConfig = {
  url: string;
  serviceRoleKey: string;
  publishableKey?: string | undefined;
};

/**
 * Creates a Supabase admin client using the service role / secret key.
 * This client bypasses RLS — use only on the server side.
 */
export function createServiceClient(config: SupabaseClientConfig): SupabaseClient {
  return createClient(config.url, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Creates a Supabase client scoped to a specific user's JWT.
 * RLS policies apply when using the publishable (anon) key.
 */
export function createScopedClient(config: SupabaseClientConfig, accessToken: string): SupabaseClient {
  const apiKey = config.publishableKey ?? config.serviceRoleKey;
  return createClient(config.url, apiKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}
