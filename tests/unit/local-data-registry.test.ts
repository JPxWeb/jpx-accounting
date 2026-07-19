import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ASSISTANT_THREADS_LEGACY_STORAGE_KEY,
  ASSISTANT_THREADS_STORAGE_KEY,
} from "../../apps/web/lib/assistant-thread-storage";
import { DASHBOARD_LAYOUT_STORAGE_KEY } from "../../apps/web/lib/dashboard-layout-storage";
import { DRAFT_QUEUE_DB_NAME, DRAFT_QUEUE_SESSION_STORAGE_KEY } from "../../apps/web/lib/draft-queue";
import { clearAllLocalData, LOCAL_DATA_REGISTRY } from "../../apps/web/lib/local-data";
import { ONBOARDING_STORAGE_KEY } from "../../apps/web/lib/onboarding/onboarding-storage";
import { STATIC_ASSET_CACHE_PREFIX, staticAssetCacheName } from "../../apps/web/lib/service-worker-cache";

// ---------------------------------------------------------------------------
// WS-C R12: the local-data registry is THE disclosed list of persistent client
// stores — sign-out clears from it, the retention page renders it. These pins
// keep it honest: keys must equal the owning modules' constants, and any NEW
// storage-writing module fails the scan until it is enumerated.
// ---------------------------------------------------------------------------

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const webRoot = path.join(repoRoot, "apps", "web");

function entry(id: string) {
  const found = LOCAL_DATA_REGISTRY.find((candidate) => candidate.id === id);
  assert.ok(found, `registry entry ${id} must exist`);
  return found;
}

test("registry keys match the owning modules' exported storage constants", () => {
  assert.equal(entry("assistantThreads").key, ASSISTANT_THREADS_STORAGE_KEY);
  assert.equal(entry("assistantThreadsLegacy").key, ASSISTANT_THREADS_LEGACY_STORAGE_KEY);
  assert.equal(entry("dashboardLayout").key, DASHBOARD_LAYOUT_STORAGE_KEY);
  assert.equal(entry("onboarding").key, ONBOARDING_STORAGE_KEY);
  assert.equal(entry("captureDraftsSession").key, DRAFT_QUEUE_SESSION_STORAGE_KEY);
  assert.equal(entry("captureDraftsDb").key, DRAFT_QUEUE_DB_NAME);
  assert.equal(entry("staticAssetCache").key, STATIC_ASSET_CACHE_PREFIX);
  // The live service-worker cache name must fall under the disclosed prefix.
  assert.ok(staticAssetCacheName.startsWith(STATIC_ASSET_CACHE_PREFIX));
});

test("registry pins the complete disclosed list — additions/removals must be conscious", () => {
  // Update this fixture ONLY together with lib/local-data.ts, the retention
  // page disclosure strings (en+sv `settings.retention.localData.entries.*`),
  // and — if clearing semantics change — the sign-out flow.
  assert.deepEqual(
    LOCAL_DATA_REGISTRY.map(
      (row) => `${row.storage}|${row.key}|${row.match}|${row.clearedOnSignOut ? "cleared" : "kept"}`,
    ),
    [
      "localStorage|jpx.accounting.assistantThreads.v2|exact|cleared",
      "localStorage|jpx.accounting.assistantThreads.v1|exact|cleared",
      "localStorage|jpx.accounting.dashboardLayout.v1|exact|cleared",
      "localStorage|jpx.accounting.onboarding.v1|exact|cleared",
      "localStorage|theme|exact|kept",
      "sessionStorage|jpx-accounting-drafts:session|exact|cleared",
      "indexedDB|jpx-accounting-drafts|exact|cleared",
      `cacheStorage|${STATIC_ASSET_CACHE_PREFIX}|prefix|cleared`,
      "cookie|NEXT_LOCALE|exact|kept",
      "localStorage|sb-|prefix|cleared",
    ],
  );
  // Ids are unique (they key the i18n disclosure strings).
  assert.equal(new Set(LOCAL_DATA_REGISTRY.map((row) => row.id)).size, LOCAL_DATA_REGISTRY.length);
});

test("every registry source module exists on disk", () => {
  for (const row of LOCAL_DATA_REGISTRY) {
    assert.ok(row.sources.length > 0, `${row.id} must name at least one source module`);
    for (const source of row.sources) {
      assert.ok(existsSync(path.join(repoRoot, source)), `${row.id}: source ${source} does not exist`);
    }
  }
});

// ---------------------------------------------------------------------------
// Source scan: any module using persistent-storage APIs must be enumerated in
// the registry (or explicitly allowlisted here with a reason).
// ---------------------------------------------------------------------------

const STORAGE_API_PATTERNS: readonly RegExp[] = [
  /\blocalStorage\s*\.\s*(?:getItem|setItem|removeItem|clear|key)\b/,
  /\bsessionStorage\s*\.\s*(?:getItem|setItem|removeItem|clear|key)\b/,
  /\bindexedDB\s*\.\s*(?:open|deleteDatabase)\b/,
  /\bopenDB\s*\(/,
  /\bcaches\s*\.\s*(?:open|delete|keys|match)\b/,
];

const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs"]);
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".next", ".turbo"]);

/** The clearing implementation itself touches every store by design. */
const SCAN_ALLOWLIST = new Set(["apps/web/lib/local-data.ts"]);

/** One pruned walk of apps/web sources, shared by every scan test. */
let sourceCache: Map<string, string> | undefined;

function readWebSources(): Map<string, string> {
  if (sourceCache) return sourceCache;
  sourceCache = new Map();
  const pending = [webRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (directory === undefined) break;
    for (const dirent of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, dirent.name);
      if (dirent.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(dirent.name)) pending.push(absolute);
        continue;
      }
      if (!dirent.isFile() || !SCANNED_EXTENSIONS.has(path.extname(dirent.name))) continue;
      const relativeToRepo = path.relative(repoRoot, absolute).replaceAll(path.sep, "/");
      sourceCache.set(relativeToRepo, readFileSync(absolute, "utf8"));
    }
  }
  return sourceCache;
}

function collectStorageApiFiles(): string[] {
  const hits: string[] = [];
  for (const [file, source] of readWebSources()) {
    if (STORAGE_API_PATTERNS.some((pattern) => pattern.test(source))) {
      hits.push(file);
    }
  }
  return hits.sort();
}

test("every storage-API-using module in apps/web is enumerated in the registry", () => {
  const declared = new Set<string>(SCAN_ALLOWLIST);
  for (const row of LOCAL_DATA_REGISTRY) {
    for (const source of row.sources) declared.add(source);
  }

  const undeclared = collectStorageApiFiles().filter((file) => !declared.has(file));
  assert.deepEqual(
    undeclared,
    [],
    `New persistent-storage usage found. Add these modules to LOCAL_DATA_REGISTRY (lib/local-data.ts) ` +
      `with their keys, wire clearing semantics, and extend the retention disclosure (en+sv): ${undeclared.join(", ")}`,
  );
});

test("registry assumptions about third-party storage stay true at source level", () => {
  // `theme` is next-themes' DEFAULT storage key — a custom storageKey prop on
  // ThemeProvider would silently break the disclosure.
  const layoutSource = readFileSync(path.join(webRoot, "app", "layout.tsx"), "utf8");
  assert.match(layoutSource, /<ThemeProvider(?![^>]*storageKey)/);

  // The NEXT_LOCALE cookie is written by the company settings form.
  const companyFormSource = readFileSync(path.join(webRoot, "components", "settings", "company-form.tsx"), "utf8");
  assert.match(companyFormSource, /NEXT_LOCALE=/);

  // Supabase Auth persistence stays confined to lib/auth (Rule 28 adjacency):
  // its sb-* localStorage keys are covered by the supabaseSession entry.
  const supabaseImports = collectFilesImporting("@supabase/supabase-js");
  assert.ok(supabaseImports.length > 0, "expected the auth lib to import @supabase/supabase-js");
  const escapees = supabaseImports.filter((file) => !file.startsWith("apps/web/lib/auth/"));
  assert.deepEqual(
    escapees,
    [],
    `@supabase/supabase-js imports must stay in apps/web/lib/auth/: ${escapees.join(", ")}`,
  );
});

function collectFilesImporting(specifier: string): string[] {
  const hits: string[] = [];
  for (const [file, source] of readWebSources()) {
    if (source.includes(`from "${specifier}"`)) {
      hits.push(file);
    }
  }
  return hits.sort();
}

test("clearAllLocalData is a safe no-op outside the browser", async () => {
  // Node has no `window` — the sweep must return without touching anything.
  await assert.doesNotReject(clearAllLocalData());
});
