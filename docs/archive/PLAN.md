> **Archived 2026-07-18 — fully landed.** The stabilization sweep this plan describes (explicit runtime modes, real `LedgerStore` interface, DI in the API, PWA/service-worker fixes, repo hygiene) shipped; current state lives in [`../architecture.md`](../architecture.md) and [`../DEV_STATUS.md`](../DEV_STATUS.md).

# Pilot-Ready Stabilization Sweep

## Summary

- Target this phase at `pilot-ready` quality, not just internal dev cleanup.
- Keep the current feature scope and stack, but harden the scaffold so the next phase starts from a clean, trustworthy base.
- Main issues to address before moving on:
  - silent failure risk in local draft capture when IndexedDB is unavailable
  - service worker caches dynamic same-origin GET requests, which can stale accounting data
  - reports and some headers still compress poorly on mobile
  - financial amounts are rounded too aggressively for accounting UX
  - architectural drift exists between docs and code (`LedgerStore` is documented but not implemented)
  - demo fallbacks are implicit instead of intentional
  - repo hygiene is weak (`pnpm-lock.yaml` ignored, `*.tsbuildinfo` not ignored, artifact/debug clutter not covered)

## Key Changes

### 1. Runtime and architecture hardening

- Introduce an explicit runtime mode:
  - `ACCOUNTING_RUNTIME_MODE=normal|demo`
  - `NEXT_PUBLIC_ACCOUNTING_RUNTIME_MODE=normal|demo`
- In `normal` mode:
  - web must use the real API path
  - missing backend/runtime config must show a clear unavailable state, not synthetic data
  - AI runtime must fail closed if required provider config is missing
- In `demo` mode:
  - `MemoryLedgerStore` and local AI fallback remain available intentionally
  - demo posture should be visible in the UI chrome so it is never mistaken for live behavior
- Add a real `LedgerStore` interface in the domain package and make `MemoryLedgerStore` implement it.
- Refactor API construction to dependency injection:
  - `createApp({ store, aiRuntime, runtimeMode })`
  - remove mutable module-level singleton assumptions
- Align docs with code:
  - either implement the documented abstraction now or stop claiming it exists
  - mark scaffold-only behavior explicitly in architecture/readme docs

### 2. PWA and browser-behavior fixes

- Rewrite service worker caching policy to be safe by default:
  - cache only immutable shell assets such as `/_next/static/*`, manifest, icons, and other versioned static assets
  - never cache `/api-proxy/*`, `/api/*`, HTML app routes, or authenticated/dynamic responses
  - add cache versioning and old-cache cleanup on activate
- Keep service worker disabled in e2e by default, but add a dedicated SW-enabled smoke path to verify runtime behavior.
- Add an explicit unregister path for development/debug builds if service worker policy changes.

### 3. UX and design cleanup

- Keep the new adaptive shell, but finish the remaining coherence pass:
  - add `aria-current="page"` and clearer active/inactive semantics to navigation
  - make capture sheet a real dialog with `role="dialog"`, `aria-modal`, focus trap, `Escape` close, initial focus, and return-focus behavior
- Move share-target ingestion out of the shell layout:
  - root layout should stay minimal
  - shell layout should only wrap the main app routes
  - `/share` should render as a focused capture surface without dock/rail chrome
- Finish mobile-first reporting:
  - report metric strips collapse to 1-2 columns on narrow widths
  - trial balance rows switch to stacked labeled cards on mobile instead of fixed 3-column compression
  - screen-header side content must reflow cleanly on small screens
- Introduce shared presentation helpers:
  - `formatMoney` with 2 decimals and Swedish numeric formatting plus explicit `SEK`
  - shared short-date formatter
  - optional percent/confidence formatter
- Remove all financial `Math.round` display shortcuts from UI/reporting surfaces.
- Align manifest/theme values and design tokens so chrome colors are consistent across browser UI, PWA, and app surfaces.

### 4. Capture and offline resilience

- Replace the current one-path IndexedDB draft save with a draft queue adapter:
  - primary storage: IndexedDB
  - fallback: in-memory/session-backed temporary queue for the active tab
  - if both are unavailable, show a visible error toast/banner instead of failing silently
- Add explicit success and failure states for capture actions.
- Keep “local-first capture” behavior, but make the reason and state visible to the user.

### 5. Code sanity and dependency cleanup

- Remove unused dependencies now rather than carrying them forward:
  - `@tanstack/react-form` should be removed until real form usage lands
- Add a small `config` layer for web and API runtime flags instead of scattered `process.env` reads.
- Keep comments only where decisions are non-obvious:
  - runtime mode behavior
  - service worker caching exclusions
  - fallback queue behavior
  - injected store/AI boundaries
- Clean repository hygiene:
  - stop ignoring `pnpm-lock.yaml`
  - ignore `*.tsbuildinfo`, `artifacts/`, and `pw-debug*.log`
  - ensure generated files do not live as source-of-truth artifacts

## Public Interfaces / Types

- Add `LedgerStore` interface to the domain package and standardize store methods around it.
- Add shared runtime config contract:
  - `ACCOUNTING_RUNTIME_MODE`
  - `NEXT_PUBLIC_ACCOUNTING_RUNTIME_MODE`
- No user-facing API endpoint additions are required for this sweep.
- No domain behavior changes to posting rules are planned; this phase is correctness/polish/hardening only.

## Test Plan

- Unit tests:
  - money/date formatter behavior
  - draft queue fallback behavior when IndexedDB fails
  - `LedgerStore` contract tests against `MemoryLedgerStore`
  - service-worker cache matching helper logic
- API tests:
  - app startup behavior differs correctly between `normal` and `demo`
  - no synthetic data is returned in `normal` mode when config is missing
- Browser tests:
  - capture sheet keyboard flow, focus trap, and escape close
  - mobile reports have no horizontal overflow
  - share target renders outside the main shell and remains focused on ingestion
  - amounts render with decimals everywhere relevant
  - runtime-mode banner/state is visible in demo mode
- PWA tests:
  - with service worker enabled, workspace/report GETs are never served stale from cache after a mutation
  - static assets do cache and survive refresh
- Visual regression:
  - baseline screenshots for `/`, `/reports`, `/assistant`, `/settings`, and `/share`
  - run on at least one desktop and one mobile project
- Accessibility:
  - add `@axe-core/playwright` checks on all primary routes
  - verify tab order, visible focus, and dialog semantics

## Assumptions and Defaults

- This sweep does not include Supabase persistence, Blob upload wiring, OCR integration, or AI Search ingestion.
- The goal is to make the current scaffold trustworthy and clean before more features are added.
- The stack remains `Next.js 16 + React 19.2 + Hono + Tailwind v4 + Motion`.
- Fallback behavior will remain available only in explicit `demo` mode, not as silent default behavior.
- The share target is treated as a capture surface, not a normal in-app content page.
