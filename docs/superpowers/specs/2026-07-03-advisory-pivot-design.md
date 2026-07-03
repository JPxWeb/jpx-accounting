# JPX Accounting — Advisory Pivot Design

**Date:** 2026-07-03 · **Status:** Approved (full-autonomy overnight build authorized)
**Grounding:** two research workflows (15 agents, repo analysis + mid-2026 UX/market/regulatory/tech research). Key citations inline; full transcripts in session workflow journals.

## 1. Product definition

JPX Accounting becomes an **AI advisory reporting app for European small businesses**, Sweden as the deep reference market. The centerpiece is an **interactive drag-&-drop advisory dashboard**: a widget canvas the owner arranges, fed by generated observations, deadlines, and traversable financials — with chat as the drill-down channel, never the front door.

The existing spine is retained and surfaced as a feature: append-only hash-chained event ledger, "AI suggests, never mutates" review gate, Zod contracts, projection-derived reports. Research verdict: this is the exact pattern set the 2025–26 winners converged on (Intuit business feed, Runway Ambient Intelligence, Puzzle Accuracy Reviews, Xero JAX Assure), and the hash chain matches what Spain's Verifactu now mandates.

### Locked product decisions (owner-approved 2026-07-03)

1. Sweden-first deep; country/CoA/VAT abstractions built, only Sweden populated
2. Capture-first AND real SIE import
3. Regulation-grounded advisory (bounded Swedish corpus, computed citations)
4. SMB founder self-serve; accountant free-seat designed-for (seams, not full surface)
5. Auth/multi-tenancy deferred-lite: own-use first; workspace model shaped, login later
6. Strict human gate on every posting + batch-approve for high-confidence; no auto-posting
7. Free hand on production; CD fix deferred to a note (needs Azure `roleAssignments/write` or Bicep restructure — owner action)
8. Azure OpenAI primary; `ai-core` factory stays provider-agnostic
9. "JPX Accounting" name survives; copy repositioned from "Sweden-first teams" to European advisory
10. English source copy via `next-intl` + Swedish catalog; all formatting locale-driven
11. **Compliance corners may be rounded for own-use launch** — but AI Act Article 50 labeling, the review gate, and append-only integrity are kept (they're cheap and they ARE the brand)

## 2. Design principles (research-derived, governing every screen)

1. **Ambient digest/dashboard is the flagship AI surface; chat is drill-down** (Intuit/Runway/Sage convergence)
2. **The review gate is the product** — "Draft by AI — awaiting your approval" stated visibly, one-tap approve/edit/reject
3. **Provenance computed from projections, never LLM-asserted** — every AI claim deep-links to voucher/evidence/account/rule (NN/g: decorative citations are worse than none)
4. **Confidence is categorical (High/Medium/Low) with an action path** — filter, batch-approve, correct
5. **Narrative first, numbers one tap away** — generated commentary above statements, every figure programmatically reconciled
6. **Every number traversable**: report → account → voucher → evidence, one interaction grammar (drawer for breakdowns, routes for entities, nuqs-preserved URL state)
7. **Deadlines are first-class objects** — calm, dated, source-linked (FreeAgent Tax Timeline reference); no fear-mongering
8. **Chart discipline**: bars, lines, waterfalls only; mobile-first tap-not-hover; 3–5 KPIs per screen; cash-bridge waterfall is the hero non-accountant view
9. **One canonical token file** — OKLCH three-layer, dark mode as semantic remap, tabular mono for all money as the signature element, red strictly for negative/error
10. **Consolidation sequence is strict**: baselines BEFORE token changes → freeze + lint enforcement → sweep → visual-regression gate
11. **Accessibility at the token layer** (EAA/WCAG 2.1 AA is law since June 2025): 4.5:1 text both themes, never color-alone, keyboard-operable drilldowns, reduced-motion degradation
12. **Tap budgets by frequency**: capture ≤3 taps fire-and-forget, review confirm ≤2, glance ≤2; reports may be deep
13. **Named integrity layer**: surface the hash chain + BAS validation as visible "checked" chips ("Validated against BAS 2026 · hash chain intact")
14. **AI is dismissible; value before configuration** — demo sandbox first, progressive profiling, per-feature opt-outs

## 3. Information architecture & user journey

5-tab IA retained: **Today / Capture / Books / Reports / Settings** — plus **Advisor** reachable from shell (nav slot on desktop rail, Cmd-K, and deep links; NOT a 6th mobile dock tab — mobile keeps 5 + capture pill).

### Today = the drag-&-drop advisory dashboard (the headline)

A widget canvas, rearrangeable via drag-&-drop (@dnd-kit or equivalent verified current lib; keyboard-sortable for EAA), layout persisted (localStorage per workspace now; settings-backed later). Widget library v1:

| Widget          | Content                                                                 | Drill target           |
| --------------- | ----------------------------------------------------------------------- | ---------------------- |
| Cash position   | balance + sparkline + runway phrase ("kassan räcker till oktober")      | Books/GL 19xx          |
| Review queue    | pending count, top item, one-tap approve, batch-approve high-confidence | inline + Today feed    |
| Tax timeline    | next VAT/employer/F-skatt deadlines with computed amounts               | Reports/VAT            |
| Observations    | top-3 ranked generated insights, each with provenance chips             | linked entity          |
| Result (P&L)    | period result + delta + mini bar                                        | Reports/P&L            |
| Cash bridge     | mini waterfall (opening → drivers → closing)                            | Reports full waterfall |
| VAT status      | current period position, amount to set aside                            | Reports/VAT            |
| Recent activity | latest events (posted, imported, extracted)                             | Books/journal          |
| Integrity       | hash-chain status, event count, last verification                       | Settings/compliance    |

Widget grammar: uniform card chrome (identical radius/padding/header/drag-handle), add/remove via a widget picker, reset-to-default. Drag on desktop + long-press on mobile; full keyboard reordering.

The @digest parallel route becomes the **observation engine's** delivery surface inside the dashboard (ranked, bounded, dated) rather than a separate static rail block.

### Journey (target, research-derived)

1. Demo sandbox explorable before any setup (demo runtime = onboarding asset)
2. First open: dashboard with onboarding-checklist widget; empty states preview the advice data will unlock
3. First capture ≤3 taps: drag-&-drop file / camera / share_target → fire-and-forget async extraction
4. First review: visible AI gate — highlighted extracted fields, matched BAS account, H/M/L badge, provenance chips
5. Progressive company setup only when needed (orgnr at first posting, VAT period at first VAT calc)
6. Weekly habit loop: glance dashboard → clear reviews ≤2 taps each → deadline awareness
7. Month-end: "Hur gick det?" narrative report → drill to any voucher → export SIE/PDF
8. Escalation: advisor chat for "why" questions; accountant handoff packaged later

## 4. Architecture

### 4.1 Design system (Phase 1 — the one-shot cleanup)

- **Single token source**: `packages/ui-tokens` emits one CSS file (OKLCH primitives → semantic aliases → Tailwind `@theme inline` bridge). All three legacy layers (glass utilities, ad-hoc shadcn vars, hex duplicates) collapse into it.
- **Radius**: one `--radius` with calc-derived steps (`sm/md/lg/xl`), executing the approved 2026-04-01 radius spec. Codemod maps the current rounded-\* soup onto the scale.
- **Dark mode**: mount ThemeProvider (class strategy), remove `colorScheme:'light'` pin, semantic remap only — no per-component `dark:` overrides. OS-respecting + manual override in Settings.
- **Typography/identity**: Manrope + IBM Plex Mono kept; **tabular mono for all monetary values** enforced via a `Money` component (locale-aware, currency from workspace); semantic money colors (`--positive/--negative/--pending`) and confidence ramp tokens.
- **Icons**: lucide everywhere (components.json already declares it); bespoke `icons.tsx` glyphs retired or redrawn as lucide-conformant; unique icons per nav item.
- **Enforcement**: ESLint bans `bg-[#`, arbitrary `var(--color-*)` classes, and raw rounded-\* outside the scale. CI-gated.
- **Brand/PWA assets**: proper logo mark, favicon set, apple-touch, maskable manifest icons (installability fixed), og-image, sw precache list corrected.
- **Regression net**: Playwright `toHaveScreenshot` baselines for Today/Capture/Books/Reports/Settings, both projects (desktop + Pixel 7), both themes, captured BEFORE token changes; axe checks kept green.
- **Dead weight**: delete unused shadcn primitives (sidebar.tsx et al.) or adopt them where screens hand-roll equivalents (dialogs, badges); capture sheet switches to `useDialogFocusTrap`.
- **Broken interactions fixed**: Books drill-down params actually filter targets; palette deep links point at real routes; api-proxy forwards PUT/PATCH/DELETE; review Edit becomes a real editor (Phase 3); "Refresh close run" either works or is removed.

### 4.2 Platform seams (Phase 2)

- **Workspace profile**: `country`, `locale`, `currency`, `fiscalYear` added to workspace settings contract + stores. Sweden defaults. All formatters (`presentation.ts`) consume it; literal `' SEK'`/`sv-SE` removed.
- **i18n**: `next-intl`; English source catalog, Swedish catalog shipped; `<html lang>` from locale. Copy sweep replaces hardcoded JSX strings on all touched screens (long-tail screens may lag; acceptable).
- **CoA registry**: `packages/domain` gains a chart-of-accounts registry keyed by country profile; BAS 2026 (expanded beyond the current 11 accounts to a practical ~60-account SMB subset) as the first template. `buildPostingLines` and heuristics consume the registry, not literals.
- **VAT-regime model**: rate table (25/12/6/0), direction (input/output), box mapping for the Swedish VAT return; deductibility rules as data. Only purchase-side wired end-to-end initially; sales-side modeled.
- **Auth**: deferred. Runtime keeps demo identity; contracts carry actor/workspace so nothing new hardcodes `org_jpx`.

### 4.3 Real capture (Phase 3)

- Capture tiles become real: file input + **drag-&-drop drop-zone** (desktop) + camera (`capture` attr) + paste handler; drafts hold real blobs in IndexedDB.
- Promotion pipeline: `initUpload` → `uploadBlob` → `createEvidence` with true filename/MIME/hash → `/api/evidence/:id/extract` → **extraction persisted** via new `LedgerStore.updateEvidenceExtraction()` + `ExtractionRefreshed` event (both stores) → review suggestion regenerated from extracted fields.
- Demo mode: StubDocumentIntelligence returns deterministic plausible fields derived from the file (name/size-seeded), so the full loop is honest in demo.
- share_target params consumed by CaptureScreen; evidence detail shows file preview + extracted fields + link to resulting review/voucher.
- **SIE import made real**: parse #VER/#TRANS into ImportedVoucher events (bounded: SIE 4E subset), export brought to spec-valid SIE 4.

### 4.4 Reports that report (Phase 4)

- Server-side `from/to` period params on report routes; Books and Reports share the nuqs `?period=` model (one period system).
- **P&L (resultatrapport)** and **Balance sheet (balansrapport)** from BAS class ranges; VAT report with Swedish box mapping.
- **Recharts** themed from `--chart-*` tokens: KPI row with sparklines, monthly in/out bars, **cash-bridge waterfall** (opening → top drivers → closing, ≤7 bars, per-bar drill).
- **Narrative block**: generated commentary (what changed, why, what to watch) whose figures are computed by `packages/reporting` and reconciled programmatically before display; LLM (when configured) only phrases — numbers come from projections. Provenance chips per sentence.
- Drill grammar everywhere: statement line → account drawer → voucher route → evidence route.
- Exports: SIE + print-clean PDF report pack (browser print CSS first).

### 4.5 Advisory layer (Phase 5)

- **Observation engine** (`packages/reporting` extension): deterministic detectors over projections — cash trend/runway, expense anomalies (z-score vs trailing months), VAT set-aside, deadline proximity, missing-evidence, unusual supplier spend. Each emits `{severity, title, body, provenance[], action}`; ranked, bounded (top N), dated. LLM optionally rewrites phrasing; facts stay computed.
- **Tax timeline**: Swedish statutory calendar (moms per period config, arbetsgivaravgifter, F-skatt, årsredovisning) computed from workspace profile with amounts from projections.
- **Advisor chat**: `/assistant` rebuilt on the observation + retrieval context; wired into shell (rail slot + Cmd-K "Ask advisor" + deep links from widgets). Streaming via AI SDK 6 pattern (`needsApproval` for any action that would create a review item); demo runtime answers deterministically from projections so the surface works without Azure.
- **RAG**: pgvector wiring completed — `embed()` gets callers, `knowledge.documents` gets an ingestion script + query path; seeded with a bounded Swedish corpus (BAS account guidance, key Bokföringslagen sections, Skatteverket VAT deductibility summaries — the two existing citations expand to a real set). Demo mode: keyword retrieval over the same corpus.
- **Trust surfaces**: named integrity layer chips; "About this AI" panel in Settings (model/provider/region, human-approval statement, AI Act Article 50 labeling: persistent "AI assistant" marking on advisor/digest/narrative surfaces, "AI-generated, reviewed by you on [date]" lines on exports).
- Confidence tiers (H/M/L) on suggestions + filter + batch-approve high-confidence in review queue.

### 4.6 Settings depth (folded into phases)

fiscal-year (real form, drives timeline), ai-posture (opt-outs, About-this-AI), compliance (integrity status, retention statement), team (invite stub honestly labeled + accountant-seat design), integrations (Peppol readiness advisory card + email-intake address placeholder), retention/about (real content). No header-only stubs remain.

## 5. Error handling & quality gates

- Every phase ends: `pnpm check` green (lint, format, typecheck, typecheck:tests, unit, build) + E2E suite (including new screenshot + axe baselines) green locally.
- Visual changes verified against updated baselines; intentional diffs re-baselined explicitly, never blindly.
- Store parity: every `LedgerStore` change lands in Memory + Postgres together with contract tests (CONVENTIONS.md rules).
- Append-only invariant: no UI edits history in place; corrections append (compliance regression guard).
- Demo mode remains fully functional offline — every new surface has a demo-runtime path.
- CD/Azure: NOT in scope overnight (needs owner's RBAC action). A `docs/DEPLOY_UNBLOCK.md` note records the exact grant/Bicep change required.

## 6. Out of scope (explicitly)

Real login/auth UI · multi-workspace switching · bank feeds (PSD2) · Peppol transport · accountant collaboration surface (designed-for only) · non-Swedish CoA/VAT population · server-persisted dashboard layouts · push notifications · Verifactu/KSeF artifacts · paid-tier plumbing.

## 7. Phase sequence (approach C — braided)

| Phase | Name             | Delivers                                                                                                                          |
| ----- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Green            | axe fixes, E2E green, screenshot baselines captured, stale CLAUDE.md corrections                                                  |
| 1     | One-shot cleanup | token freeze, radius, dark mode, icons, brand/PWA assets, dead-code deletion, broken-interaction fixes, lint enforcement          |
| 2     | Platform seams   | workspace profile, i18n (en+sv), CoA registry, VAT-regime model, locale formatting                                                |
| 3     | Real capture     | drag-&-drop/file/camera intake, extraction persisted, evidence preview, SIE import/export real                                    |
| 4     | Reports          | P&L/BS/VAT boxes, charts, waterfall, narrative, unified periods, drill grammar, exports                                           |
| 5     | Advisory         | drag-&-drop dashboard widgets, observation engine, tax timeline, advisor chat wired, RAG seeded, trust surfaces, confidence tiers |
| 6     | Polish & journey | onboarding/empty states, copy sweep, final visual pass, full regression, docs refresh                                             |

Each phase = one or more commits on `feat/advisory-pivot`; app deployable after every phase.
