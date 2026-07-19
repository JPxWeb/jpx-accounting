/**
 * Public surface of the auth MVP (WS-C R12). All `@supabase/supabase-js`
 * imports stay inside this directory — see supabase-client.ts for the
 * confinement rationale and the documented limitations.
 */
export { getSupabaseAccessToken, isAuthConfigured } from "./supabase-client";
export {
  signInWithPassword,
  signOutAndClearLocalData,
  signUpWithPassword,
  useAuthSession,
  type AuthActionResult,
  type AuthSessionSnapshot,
} from "./session";
