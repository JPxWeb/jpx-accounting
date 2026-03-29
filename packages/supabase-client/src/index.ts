import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type { SupabaseClient } from "@supabase/supabase-js";

export type SupabaseClientConfig = {
  url: string;
  serviceRoleKey: string;
};

/**
 * Creates a Supabase admin client using the service role key.
 * This client bypasses RLS — use only on the server side.
 */
export function createServiceClient(config: SupabaseClientConfig): SupabaseClient {
  return createClient(config.url, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Creates a Supabase client scoped to a specific user's JWT.
 * RLS policies will apply based on the token's claims.
 */
export function createScopedClient(config: SupabaseClientConfig, accessToken: string): SupabaseClient {
  return createClient(config.url, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}
