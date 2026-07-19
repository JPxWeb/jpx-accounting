"use client";

/**
 * Auth session store + actions (WS-C R12 auth MVP).
 *
 * One module-scoped snapshot consumed through `useSyncExternalStore` (repo
 * convention — mirrors `hooks/use-mobile.ts` / `dashboard-layout-storage.ts`;
 * `useState`+`useEffect` mirroring trips react-hooks/set-state-in-effect).
 * Supabase's `onAuthStateChange` is the single writer: it fires
 * `INITIAL_SESSION` after restoring the persisted session, then
 * `SIGNED_IN`/`SIGNED_OUT`/`TOKEN_REFRESHED` for the app's lifetime, so the
 * subscription is started once and deliberately never torn down.
 */

import type { Session } from "@supabase/supabase-js";
import * as React from "react";

import { clearAllLocalData } from "../local-data";
import { getSupabaseAuthClient, isAuthConfigured } from "./supabase-client";

export type AuthSessionSnapshot =
  | { status: "disabled"; session: null }
  | { status: "loading"; session: null }
  | { status: "signed-out"; session: null }
  | { status: "signed-in"; session: Session };

const DISABLED_SNAPSHOT: AuthSessionSnapshot = { status: "disabled", session: null };
const LOADING_SNAPSHOT: AuthSessionSnapshot = { status: "loading", session: null };
const SIGNED_OUT_SNAPSHOT: AuthSessionSnapshot = { status: "signed-out", session: null };

let snapshot: AuthSessionSnapshot = isAuthConfigured() ? LOADING_SNAPSHOT : DISABLED_SNAPSHOT;
const listeners = new Set<() => void>();
let watcherStarted = false;

function setSessionSnapshot(session: Session | null) {
  snapshot = session ? { status: "signed-in", session } : SIGNED_OUT_SNAPSHOT;
  for (const listener of [...listeners]) listener();
}

function startSessionWatcher() {
  if (watcherStarted) return;
  const supabase = getSupabaseAuthClient();
  if (!supabase) return;
  watcherStarted = true;
  // Supabase delivers INITIAL_SESSION asynchronously after subscribe, so this
  // never notifies during a React render/event handler (CONVENTIONS Rule 29).
  supabase.auth.onAuthStateChange((_event, session) => {
    setSessionSnapshot(session);
  });
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  startSessionWatcher();
  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot(): AuthSessionSnapshot {
  return snapshot;
}

function getServerSnapshot(): AuthSessionSnapshot {
  // SSR cannot know the persisted session; render the pre-hydration shape.
  return isAuthConfigured() ? LOADING_SNAPSHOT : DISABLED_SNAPSHOT;
}

/**
 * Current auth session as an external-store subscription. `disabled` when the
 * NEXT_PUBLIC_SUPABASE_* env is absent (auth UI must render nothing), `loading`
 * until Supabase restores the persisted session, then `signed-in`/`signed-out`.
 */
export function useAuthSession(): AuthSessionSnapshot {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export type AuthActionResult = {
  /** Raw provider error message (English, from Supabase) — shown verbatim under an i18n'd headline. */
  error?: string;
  /** Sign-up only: account created but Supabase's email-confirmation gate is still pending. */
  needsEmailConfirmation?: boolean;
};

const AUTH_NOT_CONFIGURED: AuthActionResult = { error: "Authentication is not configured." };

export async function signInWithPassword(email: string, password: string): Promise<AuthActionResult> {
  const supabase = getSupabaseAuthClient();
  if (!supabase) return AUTH_NOT_CONFIGURED;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? { error: error.message } : {};
}

/**
 * Email+password sign-up. Follows Supabase's project defaults: with email
 * confirmation enabled the response carries a user but NO session — the caller
 * shows the check-your-inbox notice. No in-app confirm/resend UX yet.
 */
export async function signUpWithPassword(email: string, password: string): Promise<AuthActionResult> {
  const supabase = getSupabaseAuthClient();
  if (!supabase) return AUTH_NOT_CONFIGURED;
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: error.message };
  return data.session ? {} : { needsEmailConfirmation: true };
}

/**
 * Sign out AND clear this device's workspace data (`clearAllLocalData()` —
 * advisor threads, capture drafts, evidence blobs, layouts; see
 * `lib/local-data.ts` for the full disclosed registry). Local data is cleared
 * even when the network revocation fails: the session is gone either way, and
 * leaving financial drafts behind on a shared device is the worse failure.
 * Callers should follow with a HARD navigation (`window.location.assign`) so
 * in-memory caches (React Query holds ledger snapshots) reset too.
 */
export async function signOutAndClearLocalData(): Promise<AuthActionResult> {
  const supabase = getSupabaseAuthClient();
  if (!supabase) return AUTH_NOT_CONFIGURED;
  const { error } = await supabase.auth.signOut();
  await clearAllLocalData();
  return error ? { error: error.message } : {};
}
