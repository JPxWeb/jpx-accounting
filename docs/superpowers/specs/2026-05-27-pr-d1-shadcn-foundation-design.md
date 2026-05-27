# PR-D1: shadcn/ui foundation — design spec

**Date:** 2026-05-27
**Status:** Approved (user sign-off in brainstorming pass)
**Scope:** First slice of the deferred PR-D Track A IA web port. Lands the shadcn/ui design-system foundation on `main` so future PRs (D2/D3) can refactor screens to use the primitives without a "missing deps" gate. **No screen refactors in D1.**

**Cross-reference:**

- [`docs/superpowers/plans/2026-05-27-deploy-to-main-port-plan.md`](../plans/2026-05-27-deploy-to-main-port-plan.md) — Phase 7 port survey (PR-D is the deferred web sprint)
- [`docs/DEV_STATUS.md`](../../DEV_STATUS.md) — current main vs deploy delta and remaining-work buckets
- `docs/superpowers/specs/2026-04-01-shadcn-setup-design.md` (on `deploy` branch) — original shadcn/ui setup spec authored 2026-04
- `docs/superpowers/specs/2026-04-15-unified-radius-design.md` (on `deploy` branch) — original radius spec

---

## 1. Purpose

The Phase 7 port (PR-A/B/C/#18) landed the data-layer surface area. The UI work that consumes that surface area is still on `deploy` and depends on the shadcn/ui ecosystem. Main currently has none of that ecosystem installed. PR-D1 ships the **foundation only** — deps, theme tokens, radius tokens, the primitive library, and the toaster mount — without refactoring any existing screens. Future PRs (D2: settings + company form; D3: today/books/digest IA) can then incrementally swap bespoke components for shadcn primitives without per-PR dep churn.

The user explicitly chose the "apply radius scale across existing screens" variant of D1 (with a visual inspection gate), so this spec includes that.

## 2. Non-goals

- Refactoring existing screens (`home-screen.tsx`, `app-shell.tsx` beyond radius-token CSS, etc.) to USE the shadcn primitives — that's D2/D3.
- Adding new IA routes (Today/Capture/Books/Reports/Settings sub-pages) — D2/D3.
- Wiring Auth UI (`apps/web/app/auth/` on deploy depended on `@supabase/ssr`, which main intentionally dropped in favor of postgres-js direct).
- Wiring `next-themes` `<ThemeProvider>` or a dark-mode toggle — deps install but no UX surface yet.
- Activating `nuqs` URL state on any screen — deps install, unused in D1.
- Wiring `react-hook-form` to the company-settings PUT route — deps install, unused in D1.
- Refreshing CONTRIBUTING.md or DEV_STATUS.md beyond a one-line "shadcn/ui foundation landed" note.

## 3. Target architecture

### 3.1 Dependencies (added to `apps/web/package.json`)

Deploy's shadcn build uses **`@base-ui/react`** (the BaseUI shadcn variant) — not classic Radix. `@radix-ui/react-slot` is still pulled in for the `asChild` slot pattern; everything else routes through `@base-ui/react`.

**Runtime:**

- `@base-ui/react` ^1.3.0 — primary base layer for shadcn primitives
- `@radix-ui/react-slot` ^1.2.4 — Slot for `asChild`
- `class-variance-authority` ^0.7.1 — CVA for variant typing
- `clsx` ^2.1.1 — className composition
- `tailwind-merge` ^3.5.0 — Tailwind class merging
- `tw-animate-css` ^1.4.0 — animation utility classes
- `lucide-react` ^1.7.0 — icon library
- `sonner` ^2.0.7 — toast notification system
- `next-themes` ^0.4.6 — installed for future dark-mode work (no provider wired in D1)
- `nuqs` ^2.8.9 — installed for future URL-state work
- `react-hook-form` ^7.75.0 — installed for future form work
- `@hookform/resolvers` ^5.2.2 — installed alongside RHF
- `react-hotkeys-hook` ^5.3.2 — installed for future keyboard-shortcut work
- `@tanstack/react-table` ^8.21.3 — installed for future table work

**Dev:**

- `shadcn` ^4.1.2 — CLI for future primitive additions

**Explicitly excluded:**

- `@supabase/ssr` — incompatible with main's `PostgresLedgerStore` direction

### 3.2 Theme + tokens

- `apps/web/components.json` — shadcn CLI config (mirrors deploy verbatim): `style: "base-nova"`, `baseColor: "neutral"`, `cssVariables: true`, `iconLibrary: "lucide"`, aliases `@/components`, `@/lib`, `@/components/ui`, `@/hooks`.
- `apps/web/tsconfig.json` — add `paths: { "@/*": ["./*"] }` so primitive imports `@/lib/utils` and `@/components/ui/*` resolve. Currently main inherits from `tsconfig.base.json` which only maps `@jpx-accounting/*` workspace aliases.
- `apps/web/app/globals.css` — append OKLCH-driven theme variables for light mode and `.dark` selector. Pattern: `--background`, `--foreground`, `--primary`, `--secondary`, `--card`, `--popover`, `--border`, `--input`, `--ring`, `--radius: 0.75rem`, sidebar tokens, chart tokens. Existing bespoke variables (`@theme` radius block, glass surfaces, focus rings, html/body gradients) **stay intact** — append, do not replace.
- Add imports at top of `globals.css` (after existing `@import` lines): `@import "tw-animate-css";` and `@import "shadcn/tailwind.css";` plus `@custom-variant dark (&:is(.dark *));`.

### 3.3 Radius system

> **Spec correction (post-exploration):** main `apps/web/app/globals.css` already declares a radius token scale (`--radius-sm: 6px` through `--radius-4xl: 32px`) inside an existing `@theme { ... }` block. Deploy did NOT remove this; it added a separate `--radius: 0.75rem` (the shadcn-conventional anchor) alongside. PR-D1 does the same — additive only.
>
> "Apply the new scale" therefore degenerates from "bulk refactor radius vars on existing components" to "make `--radius` and its derivatives resolve correctly so shadcn primitives render with consistent corners". Main's existing components keep their `--radius-sm/md/...` references unchanged.
>
> The visual inspection step (§6) verifies that the new `--radius` value harmonizes with main's existing scale rather than clashing.

- `apps/web/app/globals.css` — add `--radius: 0.75rem` to `:root` block (and its derivatives if shadcn primitives reference them).
- `packages/ui-tokens/styles.css` — no change in D1 (existing scale stays).
- No bulk-refactor of `app-shell.tsx`, `home-screen.tsx`, or shared `ui/*` in this PR.

### 3.4 Utilities

- `apps/web/lib/utils.ts` — `cn(...inputs: ClassValue[])` helper: `twMerge(clsx(inputs))`. shadcn primitives import this from `@/lib/utils`. If main already has a similar helper under another name, reuse rather than create.

### 3.5 Primitives (`apps/web/components/ui/`)

Main already has 7 bespoke files in `ui/` (`icons`, `metric-card`, `screen-header`, `section-label`, `skeleton`, `status-badge`, `unavailable-state`) — these **stay**. Deploy keeps them too, alongside the shadcn primitives. PR-D1 copies the shadcn primitives from deploy:

- `badge.tsx`
- `button.tsx`
- `card.tsx`
- `dialog.tsx`
- `form.tsx` (pairs with `react-hook-form`)
- `input.tsx`
- `kbd.tsx`
- `label.tsx`
- `select.tsx`
- `separator.tsx`
- `sheet.tsx`
- `sidebar.tsx`
- `sonner.tsx` (Toaster wrapper)
- `table.tsx` (pairs with `@tanstack/react-table`)
- `tabs.tsx`
- `toggle.tsx`
- `toggle-group.tsx`
- `tooltip.tsx`

The existing `skeleton.tsx` on main is bespoke (exports `ScreenSkeleton`). Deploy has both the shadcn skeleton AND `ScreenSkeleton`. **Merge:** replace main's `skeleton.tsx` with deploy's version which has both. Verify `ScreenSkeleton` is still exported.

Each primitive is deploy's version verbatim (deploy may have diverged from upstream shadcn registry; deploy's version is what production runs).

### 3.6 Toaster mount + skip-to-content link

- `apps/web/app/layout.tsx` — render `<Toaster />` from `sonner` inside the root layout (after the existing `<QueryProvider>` block). Also carry deploy's a11y "Skip to content" link (renders at top, hidden until focus). Use the `cn()` helper for the html className. NuqsAdapter is **not** wired in D1 (nuqs installs but has no consumer yet); deferred to D2.

This is the only real runtime change in D1 — all other primitives are dormant until consumers import them.

### 3.7 Tailwind config

Main has no `tailwind.config.ts` — it uses Tailwind 4's CSS-first config via `postcss.config.mjs` + `@theme` blocks in `globals.css`. PR-D1 keeps this approach. The new imports in `globals.css` (`tw-animate-css`, `shadcn/tailwind.css`) extend the theme without needing a JS config file.

## 4. Data flow / runtime behavior

**Static dependency graph only.** D1 doesn't introduce any new request paths, store calls, or AI runtime branches. The only runtime addition is the Sonner toaster mount in the root layout. No business logic is altered.

The radius-apply changes are pure CSS — they change visual radius values but not component identity, ARIA semantics, or interaction logic.

## 5. Error handling / failure modes

- **Dep install failure:** if `pnpm install` rejects any new package (peer-dep mismatch with React 19 / Next 16), abort the commit and downgrade or pin the offending package.
- **shadcn primitive type errors:** primitives are typed against the deps they import. If a primitive references a Radix component whose API changed between deploy's snapshot and the current published version, prefer matching the dep version deploy used.
- **Globals.css merge conflict:** main has bespoke CSS that conflicts with shadcn's full reset. Do not let shadcn overwrite — merge variable blocks, keep the bespoke selectors intact.
- **Visual regression on radius apply:** if Chrome DevTools inspection shows a screen looks worse, narrow the radius apply scope in Commit 2 (e.g. only globals.css + app-shell, defer home-screen.tsx to D2) and document the deferred file in the PR description.

## 6. Testing strategy

D1 introduces no new business logic, so:

- **Unit tests:** no new tests required. Existing `pnpm test:unit` suite (33/33) must still pass.
- **Typecheck:** `pnpm typecheck` + `pnpm typecheck:tests` must stay green. Primitives import from `@radix-ui/*`, `@tanstack/react-table`, `react-hook-form`, etc. — all need to install cleanly.
- **Build:** `pnpm build` (web + API) must succeed. Next.js will fail if a primitive references a missing dep.
- **E2E:** `pnpm test:e2e` Playwright suite must stay green (no spec changes expected, but a screen breaking visually could break a selector-based test).
- **Visual inspection (manual, user-requested):**
  1. `pnpm dev:web` in background after Commit 2
  2. Chrome DevTools MCP: navigate to `/` and `/today` (and any other extant routes)
  3. Computed-styles tab: confirm `--radius` resolves and `bg-background` cascades
  4. Visually compare radii — should be a coherent scale, not a regression
  5. Trigger a programmatic toast (`toast("test")` via console) to verify Sonner mounts
  6. axe quick check on at least one screen to confirm WCAG contrast isn't broken by the OKLCH change

## 7. Commit structure (matches Approach C from brainstorming)

**Commit 1: `feat(web): shadcn/ui foundation — deps, OKLCH theme, @/ alias, cn helper`**

- `apps/web/package.json` — add 15 deps per §3.1
- `apps/web/tsconfig.json` — add `@/*` paths
- `apps/web/components.json` — shadcn CLI config (base-nova / neutral / lucide)
- `apps/web/app/globals.css` — append shadcn imports + OKLCH `:root` vars + `--custom-variant dark` (bespoke `@theme` radius block and selectors preserved)
- `apps/web/lib/utils.ts` — `cn()` helper

Validate: `pnpm install` → `pnpm typecheck` → `pnpm typecheck:tests` → `pnpm build` → `pnpm dev:web` starts clean.

**Commit 2: `feat(web): shadcn primitives + Sonner toaster + skip-to-content link`**

- `apps/web/components/ui/*` — 18 shadcn primitives (per §3.5)
- `apps/web/components/ui/skeleton.tsx` — REPLACE with deploy's version (preserves `ScreenSkeleton`)
- `apps/web/app/layout.tsx` — Toaster mount + Skip-to-content link, use `cn()` for html className

Validate: full check chain + visual inspection (see §6).

## 8. Out of scope for D1 (explicitly deferred)

| Item                                                   | Why deferred                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Refactoring `home-screen.tsx` to use shadcn primitives | D2; D1 is dep + primitive availability only                                                 |
| Refactoring `app-shell.tsx` to use shadcn sidebar      | D2; the radius scale touches CSS only, structure stays main's bespoke layout                |
| Auth UI (`apps/web/app/auth/`)                         | Depends on `@supabase/ssr`, which main intentionally removed. Separate Auth plan when ready |
| nuqs URL state on screens                              | D2/D3; dep installs in D1, no consumer yet                                                  |
| React Hook Form on company-settings PUT                | D2; the API route from PR-B exists, no form UI yet                                          |
| Dark-mode toggle                                       | Future PR; `next-themes` dep installs but no `<ThemeProvider>` mounted                      |
| Cmd-K palette migration to shadcn `Command`            | D2/D3; current command-palette stays bespoke for D1                                         |

## 9. Risks + mitigations

| Risk                                                                                            | Likelihood | Mitigation                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tailwind 4 + shadcn CSS-vars compatibility break                                                | Low        | Deploy already runs this combo in production; if anything fails, downgrade Tailwind utilities to plain CSS for that primitive                                    |
| `globals.css` merge loses bespoke `.workspace-canvas` rules                                     | Medium     | Do not let prettier or shadcn CLI overwrite; manually merge variable blocks                                                                                      |
| Radius apply regresses a visual on a screen the user values                                     | Medium     | User-requested visual inspection gate. If a regression appears, scope down the apply in Commit 2 before push                                                     |
| Peer-dep conflicts with React 19 / Next 16 on one of the 14 new deps                            | Low        | Each dep is pinned to the same version deploy uses; deploy is proven against the same React/Next versions                                                        |
| Primitive file imports `@/lib/utils` but main's tsconfig has no `@/` alias                      | Medium     | Verify main's tsconfig paths include `@/*` mapping. If not, add it in `apps/web/tsconfig.json`                                                                   |
| Existing E2E test selectors break because a primitive renders different markup than the bespoke | Low        | D1 doesn't refactor screens — primitives are dormant. Only the toaster mount could affect markup at the root layout. Run E2E in CI; if a selector breaks, narrow |
| Bundle size grows ~150-300 KB                                                                   | Low impact | Tree-shakable; only imported primitives ship. Sonner + cmdk + Radix are individually small. Acceptable for what shadcn unlocks                                   |
| CodeRabbit flags ~16 new files as needing review                                                | High       | Expected; primitives are upstream-authored. Note in PR description that primitives match shadcn registry output                                                  |

## 10. Self-review (per brainstorming skill checklist)

- **Placeholder scan:** No TBDs or vague "implement details here". Concrete commit boundary, concrete dep list, concrete primitive list.
- **Internal consistency:** §3 dep list matches §7 commit boundary; §6 testing strategy matches §3 architecture; §8 deferred list does not contradict §1 purpose; §9 risks reference real sections.
- **Scope check:** Single PR, two commits, ~30 file additions + ~5 file modifications. Within a single implementation plan's reach. Does not need decomposition.
- **Ambiguity check:** The radius scale's "apply everywhere" was the main ambiguity; user disambiguated to "full apply with visual inspection". The primitive list's "phase 1" was the second; user disambiguated to "all foundation primitives". Both are pinned in §3 and §7.

---

**Approved 2026-05-27.** Ready for implementation plan (writing-plans skill).
