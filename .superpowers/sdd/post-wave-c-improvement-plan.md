# Post–Wave C Improvement Plan (amended)

**Basis:** `main` @ `a649ec3` (PR #38 merged 2026-08-06T21:26+02:00).
**Amended:** 2026-08-08, after three sibling investigations landed (API hang, console/domain barrel, browser smoke).
**Amended (research):** 2026-08-08 — Context7 / vendor docs folded into P0-1…P0-4 (`/reactjs/react.dev`,
`/vercel/next.js` @ v16.2.9 matching repo `next@16.2.12`, Node.js v24 `fs.watch` API). Plan only — no
product fixes, nothing committed.
**Amended (research lock-check):** 2026-08-08 — re-verified locked findings; strengthened P0-1…P0-3 where
gaps were found (`Object.is` on both snapshots, no-`useMemo`-in-provider, `serverExternalPackages`
non-overlap, api-client/`server-only` caveat, Serwist+Option B SW, unregister+cache clear).
**Status:** plan only — no fixes implemented, nothing committed.

Evidence sources: the working tree; the eight `.superpowers/sdd/wave-*.md` reports; `docs/DEV_STATUS.md`;
the unmerged `docs/post-wave-c-improvement-brainstorm` branch (read via `git show`); the sibling
findings listed below; and Context7 vendor docs cited under each relevant P0.

## Headline

**The app is currently unusable in local dev.** Every `(shell)` route renders "This page couldn't load".
Three defects stack: a service worker cache-firsting stale `/_next/static/` chunks in dev, a client bundle
that should never have contained `MemoryLedgerStore`, and — the actual blocker — an unstable
`useSyncExternalStore` snapshot in `OnboardingProvider` that drives React into "Maximum update depth
exceeded" on every shell route. Clearing the SW removes the module-factory error but the onboarding loop
remains, so **P0-1 below is the only item that restores a usable app.**

---

## Sibling findings folded in (treat as verified)

| Source                     | Finding                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `d4c1be93` (API hang)      | Parallel `pnpm dev` (Turbopack + `tsx watch` in one tree) never binds :3001 on Windows. Sequential `pnpm dev:api` then `pnpm dev:web` works; `/health` returns 200 in demo.                                                                                                                                                |
| `f106c2ee` (console)       | Domain-barrel diagnosis confirmed. Additional amplifier: the service worker registers under `pnpm dev` (`NEXT_PUBLIC_DISABLE_SW` unset) and cache-firsts `/_next/static/`. `build:e2e` no longer sets `DISABLE_SW` though docs still claim it does.                                                                        |
| `b2bbffdd` (browser smoke) | App unusable. After clearing the SW the module-factory error clears, but `OnboardingProvider`'s `getServerSnapshot` path loops → Maximum update depth → error boundary on all shell routes. Nav never hydrates; no api-proxy traffic. The React script-tag warning appears only on first load — cascade, not a root cause. |

---

## P0 — Restore a working app (strictly ordered)

### P0-1 · `OnboardingProvider` unstable snapshot → infinite render loop **[verified, exact site]**

**Problem.**

```35:37:apps/web/components/onboarding/onboarding-context.tsx
  const onboardingSnapshot = useSyncExternalStore(subscribeOnboardingStorage, loadOnboardingState, () =>
    loadOnboardingState(),
  );
```

`loadOnboardingState()` returns a **fresh object on every call** whenever a stored value exists:

```42:45:apps/web/lib/onboarding/onboarding-storage.ts
export function loadOnboardingState(): OnboardingState {
  if (typeof window === "undefined") return EMPTY_STATE;
  return parseOnboardingState(window.localStorage.getItem(ONBOARDING_STORAGE_KEY));
}
```

`parseOnboardingState` returns `JSON.parse(...)` — a new identity each time. `useSyncExternalStore`
re-renders whenever `getSnapshot()` is not `Object.is`-equal to the previous value, so the provider
re-renders forever: "Maximum update depth exceeded". `OnboardingShell` wraps `(shell)/layout.tsx`, so the
loop takes down every shell route, which is exactly the observed symptom.

**Why CI never caught it.** `parseOnboardingState(null)` returns the module-level `EMPTY_STATE` constant —
a stable identity. So the loop only fires once `jpx.accounting.onboarding.v1` exists in localStorage.
Playwright starts each test from a clean browser context with empty storage, so E2E always takes the stable
branch. This is a testable prediction: seed that key before navigating and the loop reproduces in
Playwright too.

**Best practices (Context7 / vendor docs) — locked.**

- **`Object.is` stability for both snapshots** ([react.dev `useSyncExternalStore`](https://react.dev/reference/react/useSyncExternalStore)):
  while the store is unchanged, repeated `getSnapshot()` **and** `getServerSnapshot()` calls **must**
  return the same value under `Object.is`. Fresh identity → infinite loop / "result of `getSnapshot`
  should be cached".
- **Anti-pattern:** `JSON.parse(...)` / allocating a **new object on every** `getSnapshot` call (exactly
  what `parseOnboardingState` does today when a key exists). Never “fix” this with `useMemo` inside
  the React provider — memo in the consumer cannot satisfy the store contract.
- **`getServerSnapshot` → module `EMPTY_STATE` only:** used for SSR HTML **and** client hydration; it
  must be `Object.is`-identical across server render and the hydration pass. Export a module-level
  function that returns the module constant `EMPTY_STATE` (same pattern as `DEFAULT_LAYOUT`).
  **Never** call `loadOnboardingState()` (or touch `localStorage` / `window`) from the server /
  hydration snapshot path — even behind `typeof window` checks inside that helper.
- **Cache in the external-store module**, not in the provider: keep the last-parsed snapshot (keyed by
  raw localStorage string) inside `onboarding-storage.ts`; invalidate on write. Do **not** paper over
  instability with `useMemo` / `useState` in `OnboardingProvider`.
- **Align `dashboard-layout-storage.ts`:** that file is the in-repo reference (`cache` +
  `getServerSnapshot → DEFAULT_LAYOUT`). Keep onboarding identical to it, and verify the dashboard
  helper still obeys the same `Object.is` rules (no regression to parse-every-call).

**Approach.** Copy / keep aligned with the caching pattern already in
`apps/web/lib/dashboard-layout-storage.ts`:

```38:50:apps/web/lib/dashboard-layout-storage.ts
let cache: { raw: string | null; layout: DashboardLayout } | null = null;

function readLayout(): DashboardLayout {
  const raw = window.localStorage.getItem(DASHBOARD_LAYOUT_STORAGE_KEY);
  if (!cache || cache.raw !== raw) {
    cache = { raw, layout: parseLayout(raw) };
  }
  return cache.layout;
}

function getServerSnapshot(): DashboardLayout {
  return DEFAULT_LAYOUT;
}
```

Cache the parsed onboarding state per raw string in `onboarding-storage.ts` (external-store module),
invalidate it inside `writeOnboardingState`, and replace the inline third argument with a
**module-level** `getServerSnapshot` that returns `EMPTY_STATE` only — never `loadOnboardingState()`
during SSR/hydration. Wire the provider as
`useSyncExternalStore(subscribe, loadOnboardingState, getServerSnapshot)`. While in there, audit the
other `useSyncExternalStore` call sites for the same hazard: `hooks/use-mobile.ts` and
`getting-started-widget.tsx:61` both return primitives (safe), `lib/auth/session.ts:60-75` needs a
look, and confirm `dashboard-layout-storage.ts` stays the aligned reference.

**Verification.** Unit test asserting `loadOnboardingState()` returns an identical reference across calls
when storage is unchanged, and a fresh reference after a write. Playwright regression that seeds
`jpx.accounting.onboarding.v1` in `addInitScript` and asserts `/today` renders. Manual: all five shell
routes load and the nav hydrates.

**Size:** S for the fix, M including the storage-seeded regression test.

> If sibling RCA agent `2c222368` reports a different or additional site, fold its file:line in — but the
> defect above is confirmed independently and is sufficient to explain the observed failure.

---

### P0-2 · The domain barrel drags `MemoryLedgerStore` into the browser bundle **[verified]**

**Problem.** Client components import `deriveBookedAt`, `isValidCalendarDay`, and `localTodayIso` from
`@jpx-accounting/domain`. Those live in `store-shared.ts`, but the barrel does **not** export
`./store-shared` — it exports `./store`, which re-exports them:

```71:87:packages/domain/src/store.ts
// Re-export shared helpers for in-package `./store` importers (simulation, etc.)
// and keep `@jpx-accounting/domain` barrel coverage via `export * from "./store-shared"`.
export {
  DEMO_ACTOR_ID,
  InvalidReviewEditError,
  ReviewBlockedError,
  buildPostingLines,
  deriveBookedAt,
  // …
};
```

The only browser path to `deriveBookedAt` therefore runs through `store.ts`, which pulls in `compliance`,
`simulation`, `sie/parse`, `reports/pack`, `store-planning`, and the whole `MemoryLedgerStore` class.
`apps/web/components/today/review-edit-sheet.tsx` is a `"use client"` file doing exactly this at lines 4-10.
Four client modules are affected: `review-edit-sheet.tsx`, `review-card.tsx`, `use-dashboard-data.ts`, and
`reports/tax-timeline-row.tsx`.

**Why it matters.** Wave Hygiene (F-5) broke the `store` ↔ `store-planning` cycle to keep this graph clean;
the barrel undoes half that work for every web consumer. It is also the module Turbopack was invalidating
when it reported "module factory is not available" — a stale-SW amplifier (P0-3) turned a latent bundling
mistake into a hard failure.

**Best practices (Context7 / vendor docs) — locked.**

- **Barrel files** (Next.js [local development](https://nextjs.org/docs/app/guides/local-development)
  - [package bundling](https://nextjs.org/docs/app/guides/package-bundling)): barrels that re-export many
    modules force the compiler to parse them for side-effects; prefer importing from specific modules /
    subpaths. `optimizePackageImports` helps webpack for known barrels; **Turbopack already analyzes
    barrels**, so it is not a substitute for keeping `MemoryLedgerStore` off the client entry graph.
    Cite both guides when implementing — local-dev barrels for the DX/compile cost, package-bundling for
    how workspace packages are actually bundled.
- **Subpath `exports` LOCKED preferred** (Next/Turbopack import-conditions fixtures): structure the
  package with an explicit `@jpx-accounting/domain/store` subpath (optional `browser` / `node`
  conditions later) rather than a single fat `"."` barrel. **Barrel reorder alone = non-fix** —
  adding `store-shared` to the barrel while `export * from "./store"` remains still evaluates
  `store.ts` for every consumer of `@jpx-accounting/domain`.
- **`transpilePackages` keep; do not overlap `serverExternalPackages`**
  ([`transpilePackages`](https://nextjs.org/docs/app/api-reference/config/next-config-js/transpilePackages)
  / package-bundling + Next webpack config conflict check): `apps/web/next.config.ts` already lists
  `@jpx-accounting/domain` (and siblings) under `transpilePackages` — **keep that**. Do **not** also put
  those workspace packages in `serverExternalPackages`; Next throws when the two lists overlap, and
  externalizing the domain package would fight the monorepo transpile path. Transpile does **not**
  tree-shake an eager `./store` re-export — fix the export surface.
- **Optional `server-only` on `store.ts` caveat:** marking `packages/domain/src/store.ts` with
  `import "server-only"` is optional hardening after the subpath split, **but** `packages/api-client`
  constructs `new MemoryLedgerStore()` for the demo fallback and is itself in `transpilePackages` for
  the web app. Adding `server-only` without first moving that demo path to a **dynamic import** (or a
  server-only entry) will break the client bundle. Subpath-first; `server-only` only after the
  api-client demo store import is safe.

**Approach.** **Subpath LOCKED (vendor-aligned):** keep `./store` out of the public `"."` barrel and
expose `@jpx-accounting/domain/store` for server consumers (extend `packages/domain/package.json`
`exports`), with `export * from "./store-shared"` on the barrel so client helpers resolve without
evaluating `store.ts`. Treat barrel-reorder-while-`./store`-stays as a **non-fix**. Naming
(`/store` vs `/store-shared`) can be bikeshed lightly, but the shape is settled. Add a seam grep gate
in `scripts/check-seams.sh` asserting no `"use client"` file reaches `MemoryLedgerStore`. Defer
optional `server-only` until api-client’s demo `MemoryLedgerStore` path is dynamically imported (or
otherwise kept off the static client graph).

**Verification.** `pnpm check`; new seam gate green; `.next` client chunk sizes compared before and after;
functional E2E through `pnpm build:e2e`; dev console clean when opening the review edit sheet.

**Size:** M

---

### P0-3 · Service worker registers in development and cache-firsts `/_next/static/` **[verified]**

**Problem.** The registrar only skips registration when the build-time flag is set:

```23:41:apps/web/components/pwa/service-worker-registrar.tsx
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    // Debug and e2e builds actively unregister prior workers so cache-policy changes are applied immediately.
    if (webRuntimeConfig.disableServiceWorker) {
      // …unregister…
      return;
    }
    // …
    void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  }, []);
}
```

`webRuntimeConfig.disableServiceWorker` is `process.env.NEXT_PUBLIC_DISABLE_SW === "true"`
(`apps/web/lib/runtime-config.ts:25`), which nothing sets under `pnpm dev`. So dev sessions run a service
worker that cache-firsts `/_next/static/`, serving chunk URLs that Turbopack has already invalidated —
which is what makes the module-factory error sticky across reloads and forces a manual SW clear.

**Secondary: docs drift on `build:e2e`.** The root script no longer inlines the flag —

```36:36:package.json
    "build:e2e": "cross-env NEXT_PUBLIC_ACCOUNTING_RUNTIME_MODE=demo NEXT_PUBLIC_API_BASE_URL=/api-proxy corepack pnpm build",
```

— while `docs/archive/superpowers/plans/phase-0-failure-catalog.md:29` still states that `build:e2e` sets
`NEXT_PUBLIC_DISABLE_SW=true`. One of the two is wrong and both are load-bearing for anyone debugging
E2E cache behavior.

**Best practices (Context7 / vendor docs) — locked.**

- **Never register in development** — ecosystem default for **Serwist** and **`next-pwa`** (and
  successors): disable SW generation/registration when `NODE_ENV === "development"`; exercise
  offline/caching only against `next start` / production builds. Next’s own PWA guide
  ([progressive-web-apps](https://nextjs.org/docs/app/guides/progressive-web-apps)) does not bless a
  cache-first SW against hot-reloading `/_next/static/` in `next dev`.
- **`runtime-config` disable predicate (OR):**
  `disableServiceWorker = process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_DISABLE_SW === "true"`
  (or equivalent). Dev is always off; the public flag remains for e2e/debug builds that need it.
- **Do not weaken prod cache-first on hashed `/_next/static/`.** Production hashed assets are meant to be
  long-lived / cache-first; the bug is registering that policy under `next dev`, not the prod strategy.
  Fix registration gating — do **not** “solve” this by turning prod static caching into network-only.
- **Next.js router cache policy** (internal `router-server`): in **development**, `/_next/static/` is
  served with `Cache-Control: no-cache, must-revalidate`; production uses long-lived `immutable`. A
  cache-first SW on those URLs in dev directly contradicts Next’s own policy.
- **PWA guide:** serve `sw.js` itself with `Cache-Control: no-cache, no-store, must-revalidate`;
  registration examples use `{ scope: "/", updateViaCache: "none" }` (already present).
- **Keep unregister + cache clear when disabled:** the existing
  `unregisterServiceWorkers()` path (unregister all registrations **and** `caches.delete` for
  `jpx-accounting-static-*`) must remain the disabled branch so toggling the flag / entering dev clears
  sticky stale chunks. Do not replace “disabled” with a silent no-op that leaves an old SW installed.

**Approach.** **Never register a SW in development** — implement the OR in `runtime-config.ts` above so
dev never depends on remembering an env var; keep `NEXT_PUBLIC_DISABLE_SW` for explicit e2e/debug;
when disabled, **keep** the current unregister + `jpx-accounting-static-*` cache clear. Optionally align
`sw.js` response headers with the PWA guide's `no-store` if not already covered. Leave prod’s
cache-first for hashed `/_next/static/` alone.

**`build:e2e` — recommendation LOCKED: Option B**, unless the suite flakes on SW:

- **Option B (preferred):** leave `NEXT_PUBLIC_DISABLE_SW` **off** for `build:e2e` / hashed `next start`
  so production-like caching stays exercised; **fix the archived docs**
  (`docs/archive/superpowers/plans/phase-0-failure-catalog.md` and any twin claims) that still say
  `build:e2e` sets the flag. Dev is already covered by the `NODE_ENV` half of the OR.
- **Option A (fallback):** restore `NEXT_PUBLIC_DISABLE_SW=true` on `build:e2e` **and** adapt
  `tests/e2e/pwa-service-worker.spec.ts` so the registrar’s unregister-on-mount path cannot race the
  spec that registers the SW itself — only if Option B proves flaky.

**Verification.** Fresh dev profile: no SW registration, no `jpx-accounting-static-*` cache entries, and a
Turbopack recompile is picked up without a manual clear. E2E green under Option B (or Option A if
flakes force the fallback); archive docs match the script.

**Size:** S

---

### P0-4 · Parallel `pnpm dev` never binds :3001 on Windows **[verified by sibling]**

**Problem.** Turbopack and `tsx watch` co-starting in one tree under `pnpm --parallel` leaves the API
never listening. Sequential start works and `/health` returns 200 in demo mode.

```9:11:package.json
    "dev": "corepack pnpm --filter @jpx-accounting/web --filter @jpx-accounting/api --parallel run dev",
    "dev:web": "corepack pnpm --filter @jpx-accounting/web dev",
    "dev:api": "corepack pnpm --filter @jpx-accounting/api dev",
```

`services/api/src/index.ts` has no top-level await and no blocking I/O before `serve()`, so this is runner
and watcher contention, not app wiring.

**Best practices (Context7 / vendor docs).**

- **Node.js `fs.watch` (v24 API):** recursive directory watches are platform-sensitive; on Windows the API
  watches the directory rather than individual files, can emit `EPERM` on deletions, and **`filename` may
  be `null`**. Recent Node adds an `ignore` option (glob / RegExp / function) — use it so a co-located
  Turbopack `.next` tree does not flood the API watcher when both processes share one workspace.
- No vendor doc mandates `pnpm --parallel` for web+API; sequential start-with-health-gate is a normal
  monorepo pattern when watchers contend.

**Approach.** Ship the documented workaround first (two terminals: `pnpm dev:api`, then `pnpm dev:web`) in
`AGENTS.md` under the Windows environment notes, since that is what unblocks people today. Then pick one
durable fix, in this preference order given the Node guidance: (1) scope the API watcher with an
**`ignore` for `.next` / `node_modules` / web artifacts** if `tsx watch` / underlying `fs.watch` exposes
it; (2) a sequential dev script that starts the API and waits for `/health` before launching web;
(3) plain `tsx` without `watch` for the API (cheapest, costs hot-reload).

**Verification.** Five consecutive cold `pnpm dev` runs where `GET http://localhost:3001/health` answers
within a fixed budget; then confirm an API source edit still hot-reloads if `watch` is retained.

**Size:** S for docs plus the ignore-list attempt; M if the dev script is restructured around a health gate.

---

### P0-5 · Widen the console guard so this class of failure fails CI **[verified]**

**Problem.** The single console assertion in the suite only fails on hydration and intl noise, and Playwright
runs against `next start`:

```41:51:tests/e2e/dashboard.spec.ts
function isHydrationOrIntlNoise(text: string): boolean {
  return /hydrat/i.test(text) || /FORMATTING_ERROR/.test(text);
}

test("/today renders with a clean console: no hydration mismatch, no intl formatting errors", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error" && message.type() !== "warning") return;
```

Neither "Maximum update depth exceeded" nor "module factory is not available" matches that predicate, which
is a large part of why a completely unusable app passed a green E2E run.

**Approach.** Invert the predicate: fail on any `console.error` and any `pageerror`, with a short commented
allowlist. Extend past `/today` to the review edit sheet, `/capture`, and the advisor. Pair it with the
storage-seeded onboarding case from P0-1 so the loop is covered in its triggering state, not just from a
clean profile. Separately add a lightweight dev-mode smoke (dev server, one page load, console assertion),
since CI builds production and dev-only regressions are structurally invisible to it.

**Verification.** The widened guard fails on today's tree before P0-1 through P0-3 land and passes after, in
both desktop and Pixel 7 projects.

**Size:** S for the predicate, M including the dev smoke.

---

### P0-6 · React script-tag warning — demoted **[cascade]**

Appears only on first load and disappears once the render loop is gone, per the browser smoke. Re-check
after P0-1 and P0-2; if it survives, name the emitting component (`apps/web/app/layout.tsx` has no `<script>`
and no `dangerouslySetInnerHTML`, so it is library-injected — most likely `next-themes` or the SW registrar)
and either fix placement or record it in the P0-5 allowlist with the upstream issue linked. Do not silence it
before the emitter is named. **Size:** S

---

## P1 — Trust and product-regression risk

### P1-1 · Deploy′ owner package is the hard CD blocker

Six human-owned items, none started: `GHCR_PULL_TOKEN` is empty and fails the web-container step of every
deploy; Storage RBAC (Blob Delegator + Data Contributor on the API managed identity) is ungranted so
User-Delegation SAS returns 403; hosted migrations `0005`–`0008` are unapplied; production
`ADVISOR_TOOL_APPROVAL_SECRET` is still the baked-in demo default; `WEBSITES_CONTAINER_STOP_TIME_LIMIT` is
unset and the Azure platform default is **5 s**, not 30 — which can SIGKILL the `closeDatabase` drain on
every restart; and no live auth or Azure advisor smoke has ever run. **Do not re-dispatch Deploy until the
GHCR token exists** — it will fail identically. Verification: live smoke on the deployed normal environment
(capture → blob preview → approve, plus one authenticated advisor stream). **Size:** M, human-led.

### P1-2 · GitHub Actions is not delivering `pull_request` / `push` events

CI for PR #38 and for the merge to `main` had to be driven by `workflow_dispatch`; the automatic events never
queued. The deploy workflow triggers on a green `workflow_run` on `main`, so it cannot fire at all. Investigate
org-level Actions delivery; verify by pushing a trivial commit and confirming CI queues unassisted. **Size:** S

### P1-3 · Docs truth has drifted again by one full wave

`docs/DEV_STATUS.md:3` reads "Last reviewed: 2026-08-06 (repo-health Waves A–C landed via PR #35…)" and its
status block covers Waves 0 and A–C only. Nothing mentions the post–Wave C swarm that landed in PR #38: the
D′ `blockedReason` gate, G′ `Unavailable*` peripherals, Share′ S-fail, E-1/E-2/E-4/E-5, or Hygiene
F-5/F-6/F-7/F-10. `AGENTS.md` points every agent at DEV_STATUS as "current truth", so the next session reads
a stale ledger and risks re-doing landed work. Append a dated PR #38 entry and fold the open list from
`wave-finish-report.md` into "Open follow-ups". **Size:** S

### P1-4 · No Postgres conformance test for the `blockedReason` gate

The D′ gate is unit-tested against `MemoryLedgerStore` and the planner. `PostgresLedgerStore` shares the
planner so it is likely correct, but store parity is an absolute invariant and the Postgres side is asserted
by inference. Add a case to `postgres-ledger.test.ts`; verify under `pnpm db:test`. **Size:** S

### P1-5 · Visual baselines unreviewed since the integrate wave

PR #38 changed user-facing surfaces (blocked-review Accept/Edit gate, Share auth-required banner,
retrieval-degrade banner, review AI marker, `UnavailableState` i18n) and the integrate report records visual
as "not run". Run the visual spec, review every diff image by hand, then re-baseline deliberately for both
`-win32` and `-linux`. Never blind-update. **Size:** S–M

### P1-6 · `extractionPending` UI and compliance ack/dismiss are both unbuilt

Two half-states the API implies but the product does not deliver. D′ explicitly scoped out the
`extractionPending` badge, so in normal mode a blocked review 409s with disabled buttons and no positive
explanation. Separately, `acknowledged` and `dismissed` are reserved slots in `complianceAlertSchema` that
both stores preserve across refresh, yet no route and no store method ever writes them — both halves are
unbuilt, as `DEV_STATUS.md:104` also says. Independently shippable. **Size:** M each

### P1-7 · Normal-mode Azure paths typechecked but never executed

The `createAzure` + `streamText` advisor path and the new `Unavailable*` blob/DocIntel wiring have unit and
mock coverage only. This is a consequence of P1-1, not separate work, but it should be stated as a known risk
and it sets the acceptance criteria for the Deploy′ smoke. **Size:** M, gated on P1-1

---

## P2 — Hygiene and debt

| #    | Item                              | Evidence                                                                                                                                                                                                  | Approach                                                                                                                                                                                                                | Size           |
| ---- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| P2-1 | EOL policy (brainstorm F-4)       | `.gitattributes` has exactly one line, the SIE fixture exemption; the integrate run failed `format:check` on 421 files under Windows `core.autocrlf=true`                                                 | Add `* text=auto eol=lf` **above** the SIE line (last match wins), add explicit `endOfLine: "lf"` to `.prettierrc.json` as documentation, then one deliberate `git add --renormalize .` commit, alone on its own branch | S, high churn  |
| P2-2 | Eight untracked wave reports      | `.superpowers/sdd/*.md`; `.superpowers/` is absent from `.gitignore`                                                                                                                                      | Decide once: promote the durable ones into `docs/`, or gitignore the directory                                                                                                                                          | S              |
| P2-3 | Two stale stashes                 | `stash@{0}` is a one-line `.claude/scheduled_tasks.lock` change; `stash@{1}` is a one-line `next-env.d.ts` change — the console guard it was named for already landed                                     | Both throwaway. Drop them                                                                                                                                                                                               | S              |
| P2-4 | Unmerged brainstorm branch        | `docs/post-wave-c-improvement-brainstorm` is 2 ahead / 13 behind `origin/main`, carrying `docs/findings.md` (54 lines) and the 458-line brainstorm — neither on `main`                                    | `findings.md` is the "never re-research this" log and is worth keeping. Land both as a docs PR with a STATUS banner noting Approach A is largely executed, then delete the branch                                       | S              |
| P2-5 | Caret→exact + pnpm catalogs (F-9) | `save-exact` only affects future adds; `apps/web/package.json` still carries `^` on `next-intl`, `@base-ui/react`, RHF, `nuqs`, `lucide-react`, and ~10 more                                              | One-shot pin pass plus a `catalog:` entry for `zod`/`ai`/`next`; Renovate `rangeStrategy: pin` holds the line after                                                                                                     | M              |
| P2-6 | `check:corpus` not in CI          | `check:seams` is now wired with ripgrep installed (`ee3e323`); `check:corpus` is not                                                                                                                      | Add it once the corpus fact re-verification is done                                                                                                                                                                     | S              |
| P2-7 | Misleading surface area           | Ghost `packages/supabase-client/` gitignored but still on disk; `GET /api/reports/general-ledger` is the trial-balance handler under a second name; 7 of 19 ledger event types reserved and never emitted | Delete the ghost directory; document or collapse the alias; annotate reserved events in `REPO_MAP.md`                                                                                                                   | S              |
| P2-8 | Platform bets                     | React Compiler off; no `X-Accel-Buffering: no` on SSE paths; no Zod `z.never().optional()` tenant tripwires; `app.ts` split (G-3) skipped by design                                                       | Park all four; G-3 stays skipped                                                                                                                                                                                        | M each, parked |

---

## Explicit non-goals

- **Do not** rewrite the hash chain, weaken append-only semantics, or route AI output around
  `applyReviewDecision`. The review gate is the only path to a posted voucher.
- **Do not** boot-fail on missing blob/DocIntel config — `Unavailable*` plus `/ready.checks.*` is the
  established pattern and it landed in G′.
- **Do not** delete `apps/web/components/advisor/tool-approval.ts` — vercel/ai#13670 is still open through
  AI SDK 7.0.55.
- **Do not** "fix" the onboarding loop by deleting `OnboardingProvider`, converting it to
  `useState`+`useEffect` (ESLint `react-hooks/set-state-in-effect` forbids it), or disabling onboarding.
  The defect is snapshot identity, nothing more.
- **Do not** blind-run `prettier --write` across the tree or blind-update visual snapshots.
- **Do not** re-dispatch the Deploy workflow before `GHCR_PULL_TOKEN` exists.
- **Do not** touch `@hono/zod-openapi` / Phase E.4 — blocked on honojs/middleware#1177.
- **Do not** start Plat-2 tenant middleware; blocked on an unmade decision about provisioning
  `org_id`/`workspace_id` into Supabase JWT claims.
- **No** greenfield product work (SIE `#IB`/`#UB`, bank CSV, Fortnox) this cycle.
- **No** framework majors: no `next@16.3`, no `hono@5`, no `@hono/node-server@2`.

---

## Sequencing

### Session 1 — make the app run again (one owner, strictly sequential)

1. **P0-1 `OnboardingProvider`.** Cache the parsed onboarding state per raw string, hoist the server
   snapshot, audit the other `useSyncExternalStore` sites. Verify by hand that all five shell routes render
   with a pre-seeded `jpx.accounting.onboarding.v1` key. Nothing else can be observed until this lands.
2. **P0-2 domain barrel.** Subpath export shape (settled): add `@jpx-accounting/domain/store`, keep
   `store-shared` on the public barrel, repoint the four client modules, add the seam gate.
3. **P0-3 SW in dev.** Never register in development (`NODE_ENV || NEXT_PUBLIC_DISABLE_SW`); keep
   unregister+cache clear when disabled; leave prod hashed `/_next/static/` cache-first alone. Prefer
   **Option B** for `build:e2e` (flag off + fix archive docs); fall back to Option A only if flakes.
4. **P0-5 console guard.** Widen it last so it can be validated against a tree that is actually clean, and
   include the storage-seeded onboarding case.

Close the session with `pnpm check` plus functional E2E via `pnpm build:e2e`. **P0-4** (the parallel-dev hang)
runs in parallel on a second owner — it touches only `package.json` scripts and `AGENTS.md`, so it shares no
files with the above. **P0-6** is a re-check at the end, not a task.

### Session 2 — cheap trust and truth

P1-3 (DEV_STATUS entry for PR #38) and P2-4 (land `findings.md` plus the brainstorm) as one small docs PR —
highest value per minute on the list, and it stops the next agent reading a stale ledger. Alongside: P1-4
(Postgres conformance case) and P1-2 (why Actions is not delivering events, which gates all of Deploy′).
Sweep P2-2 and P2-3 while in the tree.

### Session 3 — visual and deploy

P1-5 (run visuals, review every diff by hand, re-baseline both platforms). Then hand P1-1 to the owner;
nothing else in P1 can be verified until the deployed environment exists.

### Later, deliberately isolated

P2-1 (the renormalize commit) on its own branch with no other changes. P2-5 likewise. P1-6's two items are
ordinary product work and slot in wherever there is capacity.

### Decisions needed before Session 2

- ~~Domain barrel shape~~ — **settled LOCKED: subpath export** (`@jpx-accounting/domain/store` +
  barrel exports `store-shared` only). Barrel-reorder alone is a non-fix. Optional `server-only` on
  `store.ts` only after api-client demo `MemoryLedgerStore` is dynamic-import-safe.
- ~~`build:e2e` × `NEXT_PUBLIC_DISABLE_SW`~~ — **settled LOCKED: Option B** (leave flag off for hashed
  `next start`; fix archive docs). Fall back to Option A (restore flag + adapt
  `pwa-service-worker.spec.ts`) only if Option B flakes. Dev disable via `NODE_ENV` OR is independent
  and settled.
- Does `.superpowers/sdd/` get promoted into `docs/` or gitignored?
- Is Deploy′ being picked up this week? P1-7 and half of P1-1's value hang on it.
