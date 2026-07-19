"use client";

/**
 * Supabase Auth browser client (WS-C R12 auth MVP).
 *
 * THE confinement seam for `@supabase/supabase-js` (CONVENTIONS Rule 28
 * adjacency): the package is policy-sanctioned for AUTH ONLY — ledger writes
 * stay on postgres-js server-side — so every supabase-js import lives in
 * `apps/web/lib/auth/`. Grep gate:
 * `grep -rn "@supabase/supabase-js" apps/web | grep -v "lib/auth"` must be empty.
 *
 * Configuration comes from `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`
 * (build-time inlined). When either is absent, auth is DISABLED: every entry
 * point here degrades to undefined, the login/account UI hides itself, and the
 * demo experience stays byte-identical — E2E depends on that.
 *
 * Known limitations (documented, not hidden): email confirmation and password
 * recovery follow Supabase's hosted defaults — there is no in-app confirm/reset
 * UX yet, and no OAuth/social providers. Sessions persist in localStorage under
 * Supabase's own `sb-<project-ref>-auth-token` key (enumerated in
 * `lib/local-data.ts`).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function normalizeOptionalValue(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

const supabaseUrl = normalizeOptionalValue(process.env.NEXT_PUBLIC_SUPABASE_URL);
const supabaseAnonKey = normalizeOptionalValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

export const supabaseAuthConfig =
  supabaseUrl !== undefined && supabaseAnonKey !== undefined
    ? { url: supabaseUrl, anonKey: supabaseAnonKey }
    : undefined;

/** True when both NEXT_PUBLIC_SUPABASE_* vars are set — the auth UI renders only then. */
export function isAuthConfigured(): boolean {
  return supabaseAuthConfig !== undefined;
}

let client: SupabaseClient | undefined;

/**
 * Lazy singleton auth client; `undefined` when auth is not configured.
 * Safe to import from SSR-rendered client components: nothing touches
 * browser storage until a call actually happens in the browser.
 */
export function getSupabaseAuthClient(): SupabaseClient | undefined {
  if (!supabaseAuthConfig) return undefined;
  client ??= createClient(supabaseAuthConfig.url, supabaseAuthConfig.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return client;
}

/**
 * Current session's access token for `Authorization: Bearer` threading —
 * wired into the api-client's `getAuthToken` seam. Resolved per request
 * (never cached here): `getSession()` returns the live, refreshed-if-expired
 * token. Undefined when auth is off or nobody is signed in, so demo mode and
 * signed-out browsing send unauthenticated requests exactly as before.
 */
export async function getSupabaseAccessToken(): Promise<string | undefined> {
  const supabase = getSupabaseAuthClient();
  if (!supabase) return undefined;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token;
}
