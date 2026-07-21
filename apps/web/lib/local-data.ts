/**
 * THE canonical enumeration of every persistent client-side store this app
 * writes (WS-C R12): what it is, where it lives, and whether sign-out clears
 * it. Three consumers keep it honest:
 *
 * 1. `clearAllLocalData()` — wired into sign-out (`lib/auth/session.ts`) so a
 *    departing user leaves no workspace data on the device.
 * 2. The retention settings page renders this registry verbatim as the
 *    local-data disclosure — the UI can never drift from the clearing code.
 * 3. `tests/unit/local-data-registry.test.ts` pins each key against the owning
 *    module's exported constant AND scans `apps/web` for storage-API usage, so
 *    a new localStorage/IndexedDB/CacheStorage writer fails the suite until it
 *    is enumerated here.
 *
 * This module is intentionally PURE (no "use client", no browser access at
 * module scope, no imports of client-only modules): it is imported by the
 * server-rendered retention page, by client code, and by node tests. Keys are
 * literal strings here; the pin test asserts they equal the owning modules'
 * exports, so drift breaks the build instead of the disclosure.
 */

import { STATIC_ASSET_CACHE_PREFIX } from "./service-worker-cache";

export type LocalDataStorageKind = "localStorage" | "sessionStorage" | "indexedDB" | "cacheStorage" | "cookie";

export type LocalDataEntry = {
  /** Stable id — doubles as the i18n leaf under `settings.retention.localData.entries.*`. */
  id: string;
  storage: LocalDataStorageKind;
  /** Storage key, IndexedDB database name, cache name prefix, or cookie name. */
  key: string;
  /** `prefix` entries cover dynamic suffixes (e.g. Supabase's `sb-<ref>-auth-token`). */
  match: "exact" | "prefix";
  clearedOnSignOut: boolean;
  /** Repo-relative modules that own writes to this store. */
  sources: readonly string[];
};

export const LOCAL_DATA_REGISTRY: readonly LocalDataEntry[] = [
  {
    id: "assistantThreads",
    storage: "localStorage",
    key: "jpx.accounting.assistantThreads.v2",
    match: "exact",
    clearedOnSignOut: true,
    sources: ["apps/web/lib/assistant-thread-storage.ts"],
  },
  {
    id: "assistantThreadsLegacy",
    storage: "localStorage",
    key: "jpx.accounting.assistantThreads.v1",
    match: "exact",
    clearedOnSignOut: true,
    sources: ["apps/web/lib/assistant-thread-storage.ts"],
  },
  {
    id: "dashboardLayout",
    storage: "localStorage",
    key: "jpx.accounting.dashboardLayout.v1",
    match: "exact",
    clearedOnSignOut: true,
    sources: ["apps/web/lib/dashboard-layout-storage.ts"],
  },
  {
    id: "onboarding",
    storage: "localStorage",
    key: "jpx.accounting.onboarding.v1",
    match: "exact",
    clearedOnSignOut: true,
    sources: ["apps/web/lib/onboarding/onboarding-storage.ts"],
  },
  {
    // next-themes' default storage key — apps/web/app/layout.tsx mounts
    // ThemeProvider without a custom storageKey (pinned by the registry test).
    id: "theme",
    storage: "localStorage",
    key: "theme",
    match: "exact",
    // Device appearance preference, no workspace data — kept on sign-out.
    clearedOnSignOut: false,
    sources: ["apps/web/app/layout.tsx"],
  },
  {
    id: "captureDraftsSession",
    storage: "sessionStorage",
    key: "jpx-accounting-drafts:session",
    match: "exact",
    clearedOnSignOut: true,
    sources: ["apps/web/lib/draft-queue.ts"],
  },
  {
    // One database, two object stores: `capture-drafts` (local-first capture
    // queue, may contain receipt files) and `evidence-blobs` (preview cache of
    // promoted evidence files).
    id: "captureDraftsDb",
    storage: "indexedDB",
    key: "jpx-accounting-drafts",
    match: "exact",
    clearedOnSignOut: true,
    sources: ["apps/web/lib/draft-queue.ts", "apps/web/lib/evidence-blob-cache.ts"],
  },
  {
    id: "staticAssetCache",
    storage: "cacheStorage",
    key: STATIC_ASSET_CACHE_PREFIX,
    match: "prefix",
    // Only same-origin static assets (never /api/ responses, never requests
    // carrying an authorization header — see sw.js) — still cleared for a
    // fully clean device on sign-out.
    clearedOnSignOut: true,
    sources: [
      "apps/web/public/sw.js",
      "apps/web/lib/service-worker-cache.ts",
      "apps/web/components/pwa/service-worker-registrar.tsx",
    ],
  },
  {
    id: "localeCookie",
    storage: "cookie",
    key: "NEXT_LOCALE",
    match: "exact",
    // Language preference, not account data — kept so the login screen renders
    // in the user's language after sign-out.
    clearedOnSignOut: false,
    sources: ["apps/web/components/settings/company-form.tsx"],
  },
  {
    // Supabase Auth persists the session as `sb-<project-ref>-auth-token`
    // (plus transient `sb-*` PKCE keys). `supabase.auth.signOut()` removes its
    // own key; this prefix sweep is defense-in-depth for orphaned entries.
    id: "supabaseSession",
    storage: "localStorage",
    key: "sb-",
    match: "prefix",
    clearedOnSignOut: true,
    sources: ["apps/web/lib/auth/supabase-client.ts"],
  },
];

function matchingKeys(store: Storage, entry: LocalDataEntry): string[] {
  if (entry.match === "exact") return [entry.key];
  const keys: string[] = [];
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (key !== null && key.startsWith(entry.key)) keys.push(key);
  }
  return keys;
}

/** Promise wrapper over `indexedDB.deleteDatabase`; resolves on `blocked` too — deletion completes once other tabs close. */
function deleteIndexedDb(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const request = window.indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Remove every registry entry marked `clearedOnSignOut` from this device.
 * Best-effort per store (private-mode/quota failures never abort the sweep).
 * Callers should follow with a hard navigation so in-memory state (React
 * Query caches) resets as well — see `signOutAndClearLocalData()`.
 */
export async function clearAllLocalData(): Promise<void> {
  if (typeof window === "undefined") return;

  for (const entry of LOCAL_DATA_REGISTRY) {
    if (!entry.clearedOnSignOut) continue;
    try {
      switch (entry.storage) {
        case "localStorage":
        case "sessionStorage": {
          const store = entry.storage === "localStorage" ? window.localStorage : window.sessionStorage;
          for (const key of matchingKeys(store, entry)) store.removeItem(key);
          break;
        }
        case "indexedDB": {
          await deleteIndexedDb(entry.key);
          break;
        }
        case "cacheStorage": {
          if (typeof caches === "undefined") break;
          const cacheNames = await caches.keys();
          const targets =
            entry.match === "prefix"
              ? cacheNames.filter((name) => name.startsWith(entry.key))
              : cacheNames.filter((name) => name === entry.key);
          await Promise.all(targets.map((name) => caches.delete(name)));
          break;
        }
        case "cookie": {
          // No cookie entry is cleared today; expire defensively if one ever is.
          document.cookie = `${entry.key}=; path=/; max-age=0`;
          break;
        }
      }
    } catch {
      // Best-effort: continue clearing the remaining stores.
    }
  }
}
