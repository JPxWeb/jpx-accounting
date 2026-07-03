# Advisory Pivot Implementation Plan (Master)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the 7-phase advisory pivot (spec: `docs/superpowers/specs/2026-07-03-advisory-pivot-design.md`) — one-shot UI consolidation plus the drag-&-drop advisory dashboard, real capture, deep reports, and the advisory layer — on branch `feat/advisory-pivot`.

**Architecture:** Braided sequence (approach C): lock a visual-regression net, freeze one token system, then build every new capability natively inside it. Append-only ledger + review gate are inviolable. Every phase ends deployable with `pnpm check` + E2E green.

**Tech stack:** Next.js 16.2 / React 19.2 / Tailwind 4.2 / shadcn (base-nova, @base-ui/react) / next-themes (installed, unmounted) / TanStack Query 5 + Table 8 / nuqs / Motion 12 / Recharts (to add) / @dnd-kit (to add, verify latest) / next-intl (to add) / Hono / Zod v4 / postgres-js / pnpm 10 / Node 24.

**Plan granularity note:** Phases 0–1 are fully detailed below. Phases 2–6 are scoped task lists whose first task is *expand this phase into a detailed plan against the then-current codebase*. This is deliberate: this repo's own 1,768-line Phase-7 plan went stale against a retired store and had to be re-baselined (see repo analysis 2026-07-03). Do not detail Phase 5 code against a Phase 1 codebase.

**Verification vocabulary used below:**
- `CHECK` = `pnpm check` (lint + format:check + typecheck + typecheck:tests + unit + build) passes
- `E2E` = `pnpm build && npx playwright test` passes (both projects)
- `E2E:file` = `pnpm build && npx playwright test tests/e2e/<file>` passes

---

## Phase 0 — Green (baseline + regression net)

### Task 0.1: Catalog current failures

**Files:** none (discovery)

- [ ] Run `pnpm install` then `pnpm check`. Record failures verbatim.
- [ ] Run `pnpm test:e2e:install` (Chromium) then `E2E`. Record failures — expected per repo analysis: axe violations on `/capture` (CI red since ~2026-05-28); possibly others.
- [ ] Write the failure catalog to `docs/superpowers/plans/phase-0-failure-catalog.md` (file, test name, error text). Commit: `chore(phase-0): failure catalog`.

### Task 0.2: Fix axe violations on /capture (and any other red tests)

**Files:** Modify: whichever `apps/web/components/capture/*.tsx` / `apps/web/components/screens/capture-screen.tsx` elements axe names; Test: existing `tests/e2e/capture.spec.ts` (a11y helpers in `tests/e2e/a11y-helpers.ts`)

- [ ] Reproduce: `E2E:file capture.spec.ts` → note each axe rule id (e.g. color-contrast, button-name, label).
- [ ] Fix at the component level (real labels/contrast/roles — no `axe.disableRules`). If contrast: fix via the token value, not a one-off class.
- [ ] `E2E:file capture.spec.ts` → PASS both projects.
- [ ] Any other red specs from 0.1: fix the app (or the test only if it asserts retired behavior — justify in commit body).
- [ ] `CHECK` + full `E2E` → green. Commit: `fix(a11y): capture axe violations; restore green E2E`.

### Task 0.3: Screenshot regression net (BEFORE any token work)

**Files:** Create: `tests/e2e/visual-regression.spec.ts`; Modify: `playwright.config.ts` (expect.toHaveScreenshot config), `package.json` (script `test:e2e:visual`)

- [ ] Add spec: for each route `/today`, `/capture`, `/books`, `/reports`, `/settings/company`: `await page.goto(route); await page.waitForLoadState('networkidle'); await expect(page).toHaveScreenshot(\`${name}.png\`, { fullPage: true, maxDiffPixelRatio: 0.02, mask: [page.locator('[data-visual-mask]')] });` Mask dynamic regions (timestamps, generated ids) by adding `data-visual-mask` attributes where needed.
- [ ] In `playwright.config.ts` add `expect: { toHaveScreenshot: { animations: 'disabled', caret: 'hide' } }` merged into existing expect block.
- [ ] Capture baselines: `npx playwright test tests/e2e/visual-regression.spec.ts --update-snapshots` (both projects). Verify a second plain run passes deterministically (re-run twice).
- [ ] Commit baselines: `test(visual): screenshot baselines for 5 core screens (pre-consolidation)`.

### Task 0.4: Truth pass on stale docs

**Files:** Modify: `CLAUDE.md` (AccountMenu/NotificationMenu section, settings-stub count), `docs/DEV_STATUS.md` (append advisory-pivot pointer)

- [ ] Fix the stale "Account & notification menus" bullet (components no longer exist in `app-shell.tsx`); correct settings stub count; add one line pointing to the new spec + this plan.
- [ ] Commit: `docs: correct stale CLAUDE.md sections; link advisory-pivot spec/plan`.

---

## Phase 1 — One-shot cleanup (token freeze → sweep → re-baseline)

### Task 1.1: Canonical token file (single source of truth)

**Files:** Modify: `packages/ui-tokens/styles.css` (full rewrite), `packages/ui-tokens/src/index.ts` (trim); Reference: current values documented in plan-time reads (globals.css lines 18–86, styles.css lines 1–89)

- [ ] Convert every current hex/rgba primitive to OKLCH literals with a one-off script (culori: `npx -y tsx -e "..."` or node + culori) so light mode stays visually identical. No eyeballing.
- [ ] Rewrite `packages/ui-tokens/styles.css` as three layers:
  1. **Primitives** (`:root`): OKLCH color ramp (teal accent ramp, neutral ramp, semantic bases for success/info/danger/warning), font stacks, `--radius: 0.75rem`, spacing, durations, shadow recipes.
  2. **Semantics** (`:root` + `.dark`): the full shadcn vocabulary (`--background`…`--sidebar-ring`, `--chart-1..5` — move them here FROM `apps/web/app/globals.css`) plus product semantics: `--positive`, `--negative`, `--pending`, `--confidence-high/medium/low`, `--surface-glass`, `--shadow-panel` etc. Legacy `--color-*` names kept as aliases mapped to semantics (`--color-text: var(--foreground)` etc.) so the sweep can be incremental within the phase.
  3. **Radius scale derived**: `--radius-sm: calc(var(--radius) - 4px); --radius-md: calc(var(--radius) - 2px); --radius-lg: var(--radius); --radius-xl: calc(var(--radius) + 4px); --radius-2xl: calc(var(--radius) + 10px); --radius-full: 9999px;` — the 3xl/4xl tiers are retired (see Task 1.4).
- [ ] `.dark` block: complete semantic remap (port globals.css lines 54–86, extend to the new product semantics + legacy aliases). Validate every text/background pair ≥4.5:1 and UI pair ≥3:1 in BOTH themes with a small script (culori contrast) — fix values that fail, document results in the commit body.
- [ ] Trim `packages/ui-tokens/src/index.ts` to fonts + brand constants only (delete duplicated hex colors/surfaces; grep consumers first: `formatters`/imports of `theme` — update them).
- [ ] `CHECK`; `E2E:file visual-regression.spec.ts` — expect PASS (values converted, not changed). Commit: `refactor(tokens): single OKLCH three-layer token source in ui-tokens`.

### Task 1.2: Slim globals.css to app CSS only

**Files:** Modify: `apps/web/app/globals.css`

- [ ] Delete the duplicated `@theme` radius block (lines 8–16) and the `:root`/`.dark` shadcn blocks (lines 18–86; now live in ui-tokens). Bridge instead: `@theme inline { --color-*: var(--*) …; --radius-*: var(--radius-*) }` per Tailwind 4 + shadcn convention.
- [ ] Re-express `.glass-chrome/.glass-panel*` and body gradient on semantic tokens (no literal rgba/hex) with dark-mode-correct values; keep utilities' names so existing classes keep working. Remove `color-scheme: light` pin (moves to next-themes in 1.3).
- [ ] `CHECK` + visual spec PASS (still light-identical). Commit: `refactor(css): globals.css consumes tokens; zero literal colors`.

### Task 1.3: Mount dark mode

**Files:** Modify: `apps/web/app/layout.tsx` (ThemeProvider from installed `next-themes`, `suppressHydrationWarning` on `<html>`), `apps/web/app/viewport.ts` or metadata export (drop pinned colorScheme; `themeColor` per scheme); Create: `apps/web/components/theme-toggle.tsx`; Modify: `apps/web/components/app-shell.tsx` (toggle placement in rail footer + mobile Settings), settings/about or company page (appearance section)

- [ ] Wrap layout in `<ThemeProvider attribute="class" defaultTheme="system" enableSystem>`; add toggle (system/light/dark, lucide icons, accessible label).
- [ ] Sweep for hardcoded light assumptions the tokens don't cover (`bg-white`, `text-black`, literal rgba in tsx): `grep -rn "bg-white\|text-black\|rgba(" apps/web/components apps/web/app --include=*.tsx` → migrate to semantic classes.
- [ ] Extend `tests/e2e/visual-regression.spec.ts`: duplicate the 5 screens with `page.emulateMedia({ colorScheme: 'dark' })` + set theme localStorage; capture DARK baselines (`--update-snapshots`, twice for determinism).
- [ ] `CHECK` + full `E2E`. Commit: `feat(theme): mount dark mode (next-themes), dark visual baselines`.

### Task 1.4: Radius + literal-value codemod sweep

**Files:** Modify: all `apps/web/**/*.tsx` matches; `eslint.config.mjs`

- [ ] Inventory: `grep -rn "rounded-\(2xl\|3xl\|4xl\)\|var(--color-" apps/web --include=*.tsx > /tmp/sweep.txt` (~122 arbitrary color classes / 37 radius files per analysis).
- [ ] Mapping (from the approved 2026-04-01 radius spec): page-level panels/cards → `rounded-xl`; modals/sheets → `rounded-2xl`; buttons/inputs/chips → `rounded-lg`; pills/dock → `rounded-full`. Apply mechanically (sed/codemod + hand-check each file).
- [ ] Replace arbitrary `[color:var(--color-*)]`-style classes with semantic Tailwind classes now available via the bridge (`text-muted-foreground`, `bg-card`, `text-positive` etc.).
- [ ] ESLint guardrail in `eslint.config.mjs` (no-restricted-syntax on JSXAttribute string patterns): forbid `rounded-3xl`, `rounded-4xl`, `bg-[#`, `text-[#`, `[color:var(--`, `[background:var(--`. Verify: `pnpm lint` fails on a planted violation, passes clean.
- [ ] Re-baseline visual spec (intentional diff — review the report HTML diff images first, confirm only radius/color-class changes). `CHECK` + `E2E`. Commit: `refactor(ui): unified radius scale + semantic color classes; lint-enforced`.

### Task 1.5: One icon system

**Files:** Modify: `apps/web/components/icons.tsx` (retire bespoke glyphs → re-export configured lucide), `app-shell.tsx` nav array, all bespoke-icon consumers

- [ ] Map each bespoke glyph to a lucide equivalent (Books≠Reports: e.g. `BookOpen` vs `ChartNoAxesColumn`; Today `Sun`/`House`, Capture `Camera`, Settings `Settings2`, Advisor `Sparkles`). Keep `icons.tsx` as the single import point exporting configured lucide components (size/strokeWidth 1.75 for brand feel) so consumers change minimally.
- [ ] `CHECK`; re-baseline visuals; commit: `refactor(icons): single lucide-based icon system`.

### Task 1.6: Dead-weight deletion + primitive adoption

**Files:** Delete: unused `apps/web/components/ui/*` (verify per-file with grep: sidebar.tsx, any of card/badge/dialog/sheet/tooltip/separator with zero imports); Modify: `app-shell.tsx` (capture sheet → `useDialogFocusTrap` from `apps/web/lib/focus-trap.ts`, or shadcn Dialog if strictly less code)

- [ ] For each `components/ui/*.tsx`: `grep -rn "from \"@/components/ui/<name>\"" apps/web` → zero hits ⇒ delete; hits ⇒ keep.
- [ ] Capture sheet: replace inline focus-trap logic with `useDialogFocusTrap(containerRef, open, onClose, initialFocusRef)` (project convention).
- [ ] Hand-rolled dialogs/badges in older screens: adopt kept primitives where it reduces code; skip where it inflates.
- [ ] `CHECK` + `E2E`; commit: `refactor(web): delete dead primitives; capture sheet uses shared focus trap`.

### Task 1.7: Brand + PWA assets

**Files:** Create: `apps/web/public/brand/logo.svg` (wordmark+mark), `apps/web/public/icons/icon-192.png|icon-512.png|icon-maskable-192.png|icon-maskable-512.png|apple-touch-icon.png`, `apps/web/public/og-image.png`, `apps/web/app/favicon.ico` (or icon.svg route convention), generation script `scripts/generate-brand-assets.mjs` (sharp — already allowlisted in pnpm-workspace); Modify: `apps/web/app/manifest.ts` (icons array, theme/bg colors from tokens, screenshots later), `apps/web/public/sw.js` (precache list → real paths), `apps/web/app/layout.tsx` (metadata icons/og)

- [ ] Design the mark in SVG: geometric ledger-mark motif (e.g. stacked strokes forming "J" + balance-line, teal on transparent; dark-mode variant with light stroke). Keep it minimal, own-drawn, no external assets.
- [ ] `node scripts/generate-brand-assets.mjs` renders all PNG sizes from the SVGs (maskable = 20% safe-zone padding).
- [ ] manifest.ts: add `icons` (with `purpose: "maskable"` entries), correct `theme_color`/`background_color` (both schemes), name/short_name/description repositioned (European advisory copy, not "Sweden-first").
- [ ] Verify installability: `E2E:file pwa-service-worker.spec.ts` + add assertion that manifest icons resolve 200.
- [ ] Commit: `feat(brand): logo, PWA icon set, maskable icons, og-image; installability fixed`.

### Task 1.8: Fix broken interactions

**Files:** Modify: `apps/web/components/books/general-ledger-view.tsx` (read `?account=` via nuqs, filter + highlight), `apps/web/components/books/journal-view.tsx` (read `?supplier=`), `apps/web/components/command-palette.tsx` (deep links → `/today?review=<id>` and make TodayScreen scroll-to/focus that card; remove `/#review-` anchors), `apps/web/app/api-proxy/[...path]/route.ts` (add PUT/PATCH/DELETE handlers), `apps/web/components/books/close-view.tsx` (remove permanently-disabled button + honest empty state), `apps/web/components/books/*` (empty states for all table views), journal voucher display (voucher number not raw id)

- [ ] Each fix gets a unit or E2E assertion where the seam allows (at minimum: extend `tests/e2e/navigation-and-share.spec.ts` to click trial-balance row → assert GL filtered; palette → review deep link lands focused).
- [ ] `CHECK` + `E2E`; commit: `fix(web): working drill-downs, palette deep links, proxy verb support, honest empty states`.

### Task 1.9: Advisor reachable (minimal wiring; rebuild comes in Phase 5)

**Files:** Modify: `apps/web/components/app-shell.tsx` (desktop rail advisor entry + `AdvisorIcon` from icons.tsx), `apps/web/components/command-palette.tsx` ("Ask advisor" action), `apps/web/components/screens/today-screen.tsx` (link from digest area)

- [ ] Add rail nav entry + palette action → `/assistant`. Mobile dock stays 5 tabs (spec §3); advisor reachable on mobile via palette + Today link.
- [ ] Extend `tests/e2e/assistant.spec.ts`: navigate via rail link (desktop) and via Today link (mobile project).
- [ ] `CHECK` + `E2E`; re-baseline visuals (rail changed). Commit: `feat(web): advisor surface wired into navigation`.

### Task 1.10: Phase-1 exit gate

- [ ] Full `CHECK` + full `E2E` (all specs, both projects, both themes) — green.
- [ ] `grep -rn "rounded-3xl\|rounded-4xl\|bg-\[#\|var(--color-" apps/web --include=*.tsx` → zero hits (aliases may remain inside ui-tokens styles.css only).
- [ ] Update `docs/DEV_STATUS.md` (Phase 1 complete). Commit: `chore: phase 1 exit — consolidated design system, regression-locked`.

---

## Phase 2 — Platform seams (scoped; expand first)

- [ ] **2.0 Expand this phase into detailed tasks against the post-Phase-1 codebase** (same file as this plan, appended, or `phase-2-detail.md` beside it). Scope to expand:
- [ ] 2.1 Workspace profile: `country`, `locale`, `currency`, `fiscalYearStart` in `packages/contracts` settings schemas + both stores + settings/company UI (Sweden defaults; regex validation becomes per-country strategy with Swedish `organisationsnummer` as first entry).
- [ ] 2.2 `Money`/formatting: `apps/web/components/money.tsx` (tabular mono, locale+currency from workspace) replacing `apps/web/lib/presentation.ts` hardcoded `sv-SE`/`' SEK'`; unit tests parameterized by locale.
- [ ] 2.3 next-intl: install, `apps/web/i18n/` message catalogs (en source, sv translated), `<html lang>` dynamic, sweep copy on shell + Today + Capture (long-tail screens may migrate in their own phases).
- [ ] 2.4 CoA registry in `packages/domain`: `CoaTemplate` type + `bas-2026.ts` (~60-account SMB subset incl. 15xx/24xx/25xx/26xx/3xxx/4xxx-7xxx classes) + lookup API; `buildPostingLines`/heuristics/`buildVat` consume registry constants, literals (2641/1930/6991) eliminated. Store parity tests.
- [ ] 2.5 VAT-regime model: rate table (25/12/6/0), direction, Swedish return-box mapping, deductibility metadata as data. Purchase-side wired; sales-side modeled + tested at domain level.
- [ ] 2.6 Exit gate: `CHECK` + `E2E`; DEV_STATUS updated; commits per task.

## Phase 3 — Real capture (scoped; expand first)

- [ ] 3.0 Expand (research current camera/file/paste APIs + idb patterns as needed).
- [ ] 3.1 Real intake: drop-zone (drag-&-drop desktop), `<input type=file accept capture>`, paste handler; real blobs into IndexedDB drafts; drafts show file preview.
- [ ] 3.2 Promotion: initUpload→uploadBlob→createEvidence with real name/MIME/SHA-256 (demo mode: stub uploader path exercised honestly).
- [ ] 3.3 Extraction persisted: `LedgerStore.updateEvidenceExtraction()` + `ExtractionRefreshed` event in BOTH stores + contracts + migration `0005_extraction.sql` (idempotent); extract route stores result; review suggestion regenerates from extracted fields; deterministic file-seeded stub for demo.
- [ ] 3.4 Evidence detail: preview, extracted fields, link to review/voucher; review Edit becomes real (line editor appends correction, never mutates).
- [ ] 3.5 share_target params consumed by CaptureScreen (E2E exists: navigation-and-share).
- [ ] 3.6 SIE: real 4E-subset import (#VER/#TRANS → ImportedVoucher events) + spec-valid export; golden-file unit tests.
- [ ] 3.7 Exit gate: capture→extract→review→post E2E covering the real loop.

## Phase 4 — Reports (scoped; expand first)

- [ ] 4.0 Expand. 4.1 Server-side `from/to` on report routes + shared nuqs period (Books+Reports one model). 4.2 P&L/BS from CoA class ranges in `packages/domain/projections` + `packages/reporting`; Swedish VAT boxes. 4.3 Recharts themed by `--chart-*`: KPI sparklines, in/out bars, cash-bridge waterfall (≤7 bars, per-bar drill). 4.4 Narrative block: computed facts (packages/reporting) → optional LLM phrasing → programmatic reconciliation guard → provenance chips. 4.5 Drill grammar: statement line → account drawer → voucher route → evidence. 4.6 Print-clean PDF pack (print CSS). 4.7 Exit gate incl. new visual baselines + axe on charts (data-table twins).

## Phase 5 — Advisory layer (scoped; expand first)

- [ ] 5.0 Expand (verify @dnd-kit latest + AI SDK 6 patterns via web/Context7 at expansion time).
- [ ] 5.1 Dashboard canvas on Today: widget registry (9 widgets per spec §3 table), @dnd-kit sortable grid, keyboard reordering, long-press mobile, add/remove picker, localStorage layout persistence, uniform widget chrome.
- [ ] 5.2 Observation engine in `packages/reporting`: deterministic detectors (cash trend/runway, expense z-score anomaly, VAT set-aside, deadline proximity, missing evidence, supplier spend spike) → `{severity,title,body,provenance[],action}`; ranked/bounded; unit-tested against seeded projections; digest slot consumes it.
- [ ] 5.3 Tax timeline: Swedish statutory calendar from workspace profile + computed amounts; Today widget + Reports/VAT surface.
- [ ] 5.4 Advisor chat rebuild: streaming, grounded in observations + retrieval; demo runtime answers deterministically from projections; `needsApproval`-style gate for any action creating review items.
- [ ] 5.5 RAG real: ingestion script → `knowledge.documents` (pgvector), `embed()` wired, bounded Swedish corpus (BAS guidance, Bokföringslagen key sections, Skatteverket VAT summaries); demo-mode keyword retrieval over same corpus; `/api/knowledge/query` returns real citations.
- [ ] 5.6 Trust surfaces: integrity chips ("Validated against BAS 2026 · hash chain intact"), confidence H/M/L + filter + batch-approve high-confidence, AI Act Art. 50 labeling (persistent AI-assistant marking; "AI-generated, reviewed by you on <date>" on exports), "About this AI" panel in settings/ai-posture.
- [ ] 5.7 Exit gate: dashboard E2E (drag persists, keyboard reorder), advisory E2E, visual baselines.

## Phase 6 — Polish & journey (scoped; expand first)

- [ ] 6.0 Expand. 6.1 Onboarding checklist widget + empty states previewing advice (all tabs). 6.2 Settings depth: all 8 sub-pages real content (fiscal-year form, ai-posture, compliance/integrity, retention, team honest state, integrations incl. Peppol-readiness card). 6.3 Copy sweep to European advisory positioning (shell marketing blocks, metadata, manifest). 6.4 Motion pass (Motion 12 + reduced-motion), view-transitions where cheap. 6.5 Full regression: CHECK, complete E2E, axe all screens, Lighthouse (PWA installable, a11y ≥95), fresh visual baselines. 6.6 Docs: CLAUDE.md/DEV_STATUS/CONVENTIONS refresh + `docs/DEPLOY_UNBLOCK.md` (exact Azure roleAssignments/write grant or Bicep restructure for owner). 6.7 Final commit + PR `feat/advisory-pivot` → main with full summary.

---

## Self-review (done at write time)

- **Spec coverage:** every spec §4 subsystem maps to a phase; §5 gates appear as exit tasks; §6 out-of-scope respected (no auth/bank-feed/Peppol-transport tasks). ✔
- **Placeholders:** Phases 2–6 are scoped-with-expansion-task by design (header note), not TBD; Phases 0–1 contain exact paths/commands. ✔
- **Type consistency:** new names introduced once (`updateEvidenceExtraction`, `ExtractionRefreshed`, `CoaTemplate`, widget registry) and reused verbatim. ✔
