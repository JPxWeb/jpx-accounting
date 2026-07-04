# Phase 5 — Advisory layer: detailed execution plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Checkbox syntax for tracking. Verification vocabulary: `CHECK` = `pnpm check`; `E2E` = `pnpm test:e2e`; `E2E:file <f>` = `pnpm build:e2e && npx playwright test tests/e2e/<f>`; `INTEG` = `pnpm test:integration` with `SUPABASE_DB_URL` set (or documented manual smoke, Rules 2/14).

**Baseline verified against branch `feat/advisory-pivot` on 2026-07-04** (HEAD `b53a2f6`, Phases 0–4 Waves 1–3 landed: `ReportPack` contract + `GET /api/reports/pack?period=`, unified period model, `usePeriodScope`, narrative facts + KPI helpers, snapshot `packets`, workspace profile with `fiscalYearStart`, next-intl `common/shell/palette/today/evidence/capture/books/reports` namespaces, migrations 0001–0004). **Phase 4 Wave 4 (charts/drill/print) lands before Phase 5 web tasks.** Tech decisions LOCKED by `docs/superpowers/plans/2026-07-04-phase-5-tech-memo.md`: `@dnd-kit/react@0.5.0` + `@dnd-kit/helpers@0.5.0` (pin exact), AI SDK 7 (`ai@7.0.15`, `@ai-sdk/react@4.0.16`, `@ai-sdk/azure@4.0.7`, pin exact), popover API for new menus, `localStorage`+`BroadcastChannel`+`useSyncExternalStore` layout store, raw `document.startViewTransition()` feature-detected.

## Findings that correct the scope description (read before executing)

1. **The api-proxy BUFFERS and strips stream headers — the advisor transport would hang through it as-is.** `apps/web/app/api-proxy/[...path]/route.ts` does `new Response(await response.arrayBuffer(), …)` and its response-header allowlist drops `x-vercel-ai-ui-message-stream`. Decision: **fix the proxy pass-through** (return `response.body` directly + extend the allowlist) — one same-origin transport path for all modes. Streaming pass-through is byte-identical for every existing route.
2. **Assistant/knowledge routes verified:** `POST /api/assistant/sessions` exists (no `/api/assistant`); `POST /api/knowledge/query` is a placeholder returning `citations: []` with an answer string that `tests/e2e/api.spec.ts` pins (`toContain("Azure AI Search")`) — that pin MUST be rewritten with 5.7 (Rule 5). `/api/advisor/chat` is new. `POST /api/assistant/sessions` + `LedgerStore.answerAssistantQuestion` + snapshot `assistantExamples` stay untouched this phase (api.spec pins survive); retirement queued for Phase 6.
3. **Confidence tiers already exist with different thresholds** (`filter-types.ts`: H ≥ 0.95, M ≥ 0.80). Replace via ONE shared `confidenceBand()` (0.85/0.6). Seed review confidence 0.86 → High under the new mapping → batch-approve exercisable in demo E2E. Deliberate.
4. **`/today` is load-bearing for four E2E specs.** Coexistence: nuqs `?view=` (`dashboard` default); the full review queue (extracted whole with ALL testids and J/K/Y/N/E/B hotkeys intact) renders at `?view=queue`; a present `?review=` param FORCES queue view (palette-deeplink passes unmodified). home.spec/review-edit.spec update gotos to `/today?view=queue`. Review hotkeys stay queue-scoped (must not fight dnd-kit's keyboard sensor).
5. **All six detectors run client-side on EXISTING queries — no observations endpoint.** Snapshot journal + packets + pack cover everything. Caveat: SIE-imported vouchers have no voucher rows → missing-evidence covers captured vouchers only (documented).
6. **Integrity/recent-activity need NO store change**: `getEvents()` exists on all stores. `GET /api/integrity` composes a summary in the route via a pure domain function; api-client fallback path does the same offline. Zero `LedgerStore` interface changes → zero parity burden.
7. **Hash-chain verification checks LINKAGE, not payload recomputation.** Postgres jsonb normalizes key order → recomputed `JSON.stringify(payload)` is not byte-stable. `summarizeEventIntegrity` verifies `previousHash === predecessor.eventHash` (+ genesis) — detects removal/reordering/insertion; canonical-serialization payload-tamper detection is a documented future note.
8. **Tax rules as scoped were partly wrong — verified against Skatteverket 2026-07-04.** SMB (≤ 40 MSEK): monthly AND quarterly moms due the **12th of the SECOND month** after the period (Jan/Aug → 17th). Yearly (no EU trade) = 26th of second month after FY end (Dec → 27th). Arbetsgivardeklaration + F-skatt = 12th monthly (17th Jan/Aug). Årsredovisning (AB) = 7 months after FY end (ÅRL 8 kap. 3 §). Encode as data with verbatim source strings; > 40 MSEK variant + public-holiday shifts out of scope (weekend→Monday IS implemented).
9. **`vatPeriod` and `aiPosture` need NO migration** (org-level jsonb + Zod defaults). `0005` stays free.
10. **Offline demo is a supported path and `useChat` needs an HTTP endpoint.** The deterministic advisor turn is built ONCE in a new pure package **`packages/advisor`** (deps: contracts + reporting only — NOT ai-core, whose `openai` import must never reach the web bundle) and adapted twice: API route wraps it in UI-message SSE; the web wires a small custom `ChatTransport` replaying the same parts client-side when fallbackStore is active. One brain, two thin adapters.
11. **Wave-4 collision management:** tasks touching `reports-screen.tsx`/print header (5.10) execute only AFTER the Phase-4 exit commit; dashboard mini-visuals do NOT import the reports chart kit — widgets use dependency-free inline SVG (`mini-sparkline`/`mini-bars`), keeping the Today chunk recharts-free.
12. **Removing the @digest rail block changes shell markup on EVERY screen** → all visual baselines re-capture at the exit gate (books/capture diffs are shell-only). `ambient-digest` testid dies (grep: zero spec consumers).
13. **ai-core seam (adopted):** ai-core keeps `embed()` + deterministic legacy answers; advisor CHAT routes through AI SDK 7 `@ai-sdk/azure` in `services/api/src/advisor/`. Both read the same `AZURE_OPENAI_*` env.
14. **`POST /api/advisor/chat` inherits the mutation middleware stack** (rate limiter pre-stream, JWT when configured). No special-casing.
15. **Tax-timeline amounts:** only VAT deadlines have a computable amount (pack box 49) — the VAT widget/timeline fetch ONE extra pack keyed by `currentVatPeriodToken(...)` through the EXISTING pack endpoint. Employer/F-skatt render date-only (`amountRef: null`, honest).
16. **`scripts/ingest-knowledge.mjs` runs under `tsx`** (workspace TS imports); root script `"ingest:knowledge"`; Rule 4 `pathToFileURL` isMain.

## Invariants honored throughout

- **Append-only + review gate inviolable**: no new event types; the advisor's `proposeReviewAction` tool executes the EXISTING `applyReviewDecision(reviewId, "approve", {actorId, notes, edited})` and ONLY after explicit human tool-approval.
- **No `LedgerStore` interface change** → no parity tasks.
- **Demo fully offline for every new surface** (dashboard client-computed; advisor via client demo transport; knowledge via bundled corpus + BM25-lite; integrity via fallback getEvents).
- **Deterministic by construction**: detectors, timeline, retrieval ranking, demo advisor turn are pure functions with injected `today`.
- **Widgets share queries**: `["workspace"]`, `["reports","pack",<token>]`, `["company-settings"]`, `["integrity"]`; only new GETs are `/api/integrity` + `/api/runtime-info`.
- No testid renames except the queue-view relocation + `ambient-digest` deletion. Rule 16 explicit 422/403 branches. All copy in en+sv. Every task ends `CHECK` green.

## Task dependency graph

```
Wave 1 (parallel): Track C: 5.1 (contracts+confidenceBand) → 5.2 (tax calendar) → 5.3 (observation engine)
                   Track K: 5.4 (corpus + packages/advisor)
                   Track W: 5.5 (dnd deps + layout store + grid + chrome + picker)
                   Track A: 5.6 (integrity + runtime-info) — after 5.1
Wave 2: 5.7 (advisor server + knowledge + proxy streaming) — after 5.3+5.4+5.6
        5.8 (Today = dashboard) — after 5.2+5.3+5.5+5.6
        5.9 (advisor client) — after 5.7
Wave 3: 5.10 (trust surfaces) — after 5.8 AND Phase-4 exit commit ∥ 5.11 (RAG normal mode) — after 5.4+5.7
        5.12 (exit gate)
```

---

## Task 5.1 — Contracts + shared vocabulary (atomic)

**Files — Modify:** `packages/contracts/src/index.ts`, `packages/domain/src/rules.ts`, `tests/unit/contracts-settings.test.ts`. **Create:** `tests/unit/confidence-band.test.ts`.

- [ ] `vatPeriodSchema = z.enum(["monthly","quarterly","yearly"])`; `workspaceProfileSchema` += `vatPeriod: vatPeriodSchema.default("quarterly")`.
- [ ] `aiPostureSchema = z.object({ advisorEnabled: z.boolean().default(true), suggestionsEnabled: z.boolean().default(true) })`; `companySettingsSchema` += `aiPosture` with default + `DEFAULT_AI_POSTURE` export.
- [ ] `taxDeadlineKindSchema = z.enum(["vat-return","employer-declaration","f-skatt","annual-report"])`; `taxDeadlineSchema = { id, kind, dueDate, periodLabel, periodToken?: string, amountRef: z.enum(["box49"]).nullable(), sourceKey }`.
- [ ] `observationDetectorSchema = z.enum(["cash-runway","expense-anomaly","vat-set-aside","deadline-proximity","missing-evidence","supplier-spike"])`; `observationSeveritySchema = z.enum(["info","warning","critical"])`; `observationSchema = { id, detector, severity, titleKey, params: record(string, string|number), provenance: [{kind: enum[account,voucher,evidence,report,deadline], target}], action?: {labelKey, href} }`.
- [ ] `integritySummarySchema = { eventCount, chainLinked, headHash: nullable, lastEventAt: nullable, verifiedAt, recentEvents: max(8) of {id,eventType,aggregateType,occurredAt,actorId}, bas: {template, accountCount} }`.
- [ ] `knowledgePassageSchema = { id, docId, title, excerpt, source, url?, score }`; `knowledgeQueryResultSchema = { query, mode: enum[keyword,vector], passages }`.
- [ ] `runtimeInfoSchema = { runtimeMode, ai: { operational, provider: enum[azure-openai,local-demo,unavailable], model?, endpointHost? } }`.
- [ ] `packages/domain/src/rules.ts`: `confidenceBand(confidence): "high"|"medium"|"low"` — ≥0.85 / ≥0.6. Tests: boundaries + seed 0.86 → high.
- [ ] `CHECK`. Commit: `feat(contracts): vatPeriod + aiPosture on settings; tax-deadline/observation/integrity/knowledge/runtime-info schemas; shared confidence bands (0.85/0.6)`.

## Task 5.2 — Swedish statutory tax calendar in domain

**Depends on 5.1.** **Files — Create:** `packages/domain/src/tax/calendar.ts`, `tests/unit/tax-timeline.test.ts`. **Modify:** `packages/domain/src/index.ts`.

- [ ] `TAX_DEADLINE_SOURCES: Record<string,string>` per finding 8 (verbatim Swedish source strings: sv-vat-12, sv-vat-yearly-26, sv-employer-12, sv-fskatt-12, sv-arsredovisning-7m).
- [ ] `buildTaxTimeline({ profile: Pick<WorkspaceProfile,"vatPeriod"|"fiscalYearStart">, today?, horizonDays = 120, limit = 8 }): TaxDeadline[]` — next occurrences per kind, sorted; local calendar parts; weekend Sat/Sun → next Monday; 12th→17th Jan/Aug; yearly Dec → 27th; annual-report = FY end + 7 months clamped. VAT deadlines carry `periodToken` + `amountRef: "box49"`; ids deterministic (`tax_vat_2026-Q2`).
- [ ] `currentVatPeriodToken(vatPeriod, fiscalYearStart, today?): string`.
- [ ] Tests: fiscal starts 01-01/07-01; all vatPeriods; pinned examples (quarterly Q2 fy01-01 → 2026-08-17; monthly May → 2026-07-13 Monday-shift; yearly FY Dec → 2027-02-26; annual report FY 2026-06-30 → 2027-01-31); horizon/limit; determinism.
- [ ] `CHECK`. Commit: `feat(domain): Swedish statutory tax calendar — moms/arbetsgivare/F-skatt/årsredovisning deadlines as sourced data, fiscal-aware, weekend-shifted`.

## Task 5.3 — Observation engine in `packages/reporting`

**Depends on 5.1.** **Files — Create:** `packages/reporting/src/observations.ts`, `tests/unit/observations.test.ts`. **Modify:** `packages/reporting/src/index.ts`.

- [ ] `buildObservations({ pack, snapshot, deadlines, today }, { limit = 5 })` — runs all detectors, ranks (severity → detector priority → id), bounds. Detectors exported pure; thresholds exported consts.
- [ ] `detectCashRunway(pack)`: trailing net burn over last ≤3 active monthly points; runway months (critical <1.5, warning <3, info else); non-burning → positive info; <2 months history → nothing. Provenance report/cash-bridge; action `/reports#cash-bridge`.
- [ ] `detectExpenseAnomaly(snapshot, pack)`: per-account month totals (cost classes 4–7 by first digit); z ≥ 2 with ≥4 months history and σ>0 → warning {account, accountName, amount, typicalAmount}; action → GL for the account+period.
- [ ] `detectVatSetAside(pack)`: box 49 > 0 → info {amount, periodLabel}; action `/reports#vat-preparation`.
- [ ] `detectDeadlineProximity(deadlines, today)`: due ≤14 days → warning (calm phrasing) {kind, dueDate}; action `/reports#tax-timeline`.
- [ ] `detectMissingEvidence(snapshot)`: vouchers with missing/empty packet evidence → warning with count, first ≤3 voucher targets; action `/capture`.
- [ ] `detectSupplierSpike(snapshot, pack)`: supplier gross this month ≥2× trailing-3-month avg AND ≥500 → warning {supplier, amount, typicalAmount}; action `/books?view=suppliers`.
- [ ] Tests per detector (trigger/non-trigger/sparse) + params ≡ inputs (reconciliation guard) + composite rank/bound/determinism.
- [ ] `CHECK`. Commit: `feat(reporting): deterministic observation engine — six detectors over ReportPack + snapshot, ranked/bounded, i18n-keyed with computed provenance`.

## Task 5.4 — Knowledge corpus + `packages/advisor` (pure, isomorphic)

**Independent.** **Files — Create:** `docs/knowledge/sv/` (10 sourced docs: bas-konton-oversikt, moms-avdrag-grunder, representation, moms-deklarationstider, f-skatt-preliminarskatt, arbetsgivaravgifter, personbil-moms, bokforingslagen-verifikationer, arsredovisning-ab, sie-format — each with front-matter title/source/url/effective and 40–80 lines of grounded facts), `scripts/build-knowledge-corpus.mjs`, `packages/advisor/{package.json,tsconfig.json}`, `packages/advisor/src/{index.ts,corpus.generated.ts,retrieval.ts,context.ts,demo-turn.ts,prompts.ts}`, `tests/unit/knowledge-retrieval.test.ts`, `tests/unit/advisor-demo-turn.test.ts`. **Modify:** root `package.json` (`"build:knowledge": "tsx scripts/build-knowledge-corpus.mjs"`).

- [ ] Corpus builder: front-matter parse, chunk per `##` (≤~1500 chars), emit `corpus.generated.ts` (`KNOWLEDGE_CORPUS: KnowledgeChunk[]`), checked in with GENERATED header.
- [ ] `retrieval.ts`: Swedish-aware tokenizer + BM25-lite (k1 1.2, b 0.75), `retrieveKnowledge(query, {topK = 4})`, deterministic tie-break, ~300-char excerpts.
- [ ] `context.ts`: `buildAdvisorGrounding({ pack, observations, deadlines, pendingReviews }): string` — compact factual block, numbers copied from the pack only.
- [ ] `demo-turn.ts`: `DemoTurnPart` union (text / provenance / propose-review-action / tool-result) + `reviewActionProposalSchema`-shaped proposal; `buildDemoAdvisorTurn({ question, grounding, passages, pendingReview?, approval? })` — deterministic templates; /godkänn|bokför|review|approve/i + pending review → proposal part; approval input → tool-result + closing turn.
- [ ] `prompts.ts`: `suggestedPromptKeys(observations)` ≤3 + static fallback trio.
- [ ] Tests: BM25 determinism + representation query → Skatteverket source first; corpus-sync tripwire (rebuild in-test, deep-equal vs generated); demo-turn assertions incl. two-turn approval.
- [ ] `CHECK`. Commit: `feat(advisor,knowledge): bounded Swedish corpus (10 sourced docs) + pure advisor package — BM25-lite retrieval, grounding builder, deterministic demo turns`.

## Task 5.5 — Dashboard foundation: dnd, layout store, chrome, picker

**Independent.** **Files — Create:** `apps/web/lib/dashboard-layout-core.ts`, `apps/web/lib/dashboard-layout-storage.ts`, `apps/web/components/dashboard/sortable-grid.tsx`, `apps/web/components/dashboard/widget-chrome.tsx`, `apps/web/components/dashboard/widget-picker.tsx`, `apps/web/lib/view-transition.ts`, `tests/unit/dashboard-layout-core.test.ts`. **Modify:** `apps/web/package.json` (`"@dnd-kit/react": "0.5.0"`, `"@dnd-kit/helpers": "0.5.0"` — exact).

- [ ] `dashboard-layout-core.ts` (pure): `WIDGET_IDS = ["cash-position","review-queue","tax-timeline","observations","result","cash-bridge","vat-status","recent-activity","integrity"]`; `dashboardLayoutSchema {v: literal(1), order, hidden}`; `DEFAULT_LAYOUT` (spec order); `parseLayout` (fallback + dedupe + re-append missing); `moveWidget/addWidget/removeWidget/resetLayout`.
- [ ] `dashboard-layout-storage.ts`: key `jpx.accounting.dashboardLayout.v1`, channel `jpx-dashboard-layout`; `useDashboardLayout()` via ONE `useSyncExternalStore` (channel + storage event), cached parse for referential stability.
- [ ] `sortable-grid.tsx` — THE dnd-kit abstraction: `<SortableGrid ids onReorder renderItem/>`; keyboard sensor default; pointer `{delay: 250, tolerance: 8}` (long-press mobile); handles via `renderItem({id, handleProps, isDragging})`; optimistic during drag, commit on drop.
- [ ] `widget-chrome.tsx`: uniform `glass-panel rounded-xl p-4` card — eyebrow title, drill Link (`widget-drill-<id>`), remove (`widget-remove-<id>`), handle button (`widget-handle-<id>`, GripVertical, aria-label).
- [ ] `widget-picker.tsx`: native popover API + `@starting-style`; toggles `widget-picker-toggle-<id>`; `dashboard-reset`; trigger `widget-picker-open`.
- [ ] `view-transition.ts`: `withViewTransition(mutate)` — feature-detect + reduced-motion guard; add/remove/reset only.
- [ ] Unit tests: parse round-trip, unknown-id tolerance, move/add/remove/reset, default completeness.
- [ ] `CHECK`. Commit: `feat(web): dashboard foundation — dnd-kit 0.5 sortable grid (keyboard + long-press), schema-versioned layout store (localStorage + BroadcastChannel), uniform widget chrome, popover picker`.

## Task 5.6 — `GET /api/integrity` + `GET /api/runtime-info`

**Depends on 5.1.** **Files — Create:** `packages/domain/src/integrity.ts`, `tests/unit/integrity-summary.test.ts`. **Modify:** `packages/domain/src/index.ts`, `services/api/src/app.ts`, `services/api/src/runtime.ts` (+index wiring), `packages/api-client/src/index.ts`, `tests/e2e/api.spec.ts`.

- [ ] `summarizeEventIntegrity(events, { verifiedAt, coa? }): IntegritySummary` — linkage per finding 7; recentEvents last 8 newest-first; bas info. Tests: intact/reordered/removed/empty.
- [ ] Routes: `/api/integrity` from `getEvents()`; `/api/runtime-info` from new `aiMetadata` on `CreateAppOptions` (demo → local-demo; normal+configured → azure-openai + model + endpoint host; else unavailable).
- [ ] api-client: `getIntegritySummary()` (fallback: getEvents + domain fn), `getRuntimeInfo()` (fallback: static local-demo).
- [ ] api.spec: integrity chainLinked true + counts; runtime-info demo shape.
- [ ] `CHECK`. Commit: `feat(api): integrity summary (hash-chain linkage + recent events) and runtime-info endpoints; api-client methods with offline fallbacks`.

## Task 5.7 — Advisor chat server + knowledge route + streaming proxy

**Depends on 5.3 + 5.4 + 5.6.** **Files — Create:** `services/api/src/advisor/chat.ts`, `services/api/src/advisor/model.ts`, `services/api/src/knowledge.ts`. **Modify:** `services/api/src/app.ts`, `services/api/src/config.ts` (`ADVISOR_TOOL_APPROVAL_SECRET` + demo default), `services/api/package.json` (exact `ai@7.0.15`, `@ai-sdk/azure@4.0.7`, workspace `@jpx-accounting/reporting` + `@jpx-accounting/advisor`), `apps/web/app/api-proxy/[...path]/route.ts`, `tests/e2e/api.spec.ts`.

- [ ] **Proxy fix first (finding 1):** stream `response.body` for ALL verbs; allowlist += `x-vercel-ai-ui-message-stream`.
- [ ] `POST /api/advisor/chat`: bounded body schema (≤40 messages, ≤8KB each → 422); `aiPosture.advisorEnabled` gate → 403 `advisor_disabled`; grounding per request (snapshot, current-month pack, timeline, observations, passages).
- [ ] Demo mode: `createUIMessageStream` mapping `buildDemoAdvisorTurn` — text parts, `data-provenance` parts, proposal as tool part in approval-requested state; incoming approval response → execute `applyReviewDecision(..."approve", {actorId:"user_founder", notes:"Approved via advisor", edited})` or skip → tool-output + closing text. Deterministic, no LLM.
- [ ] Normal mode: `createAdvisorModel(config)` via `createAzure` (Responses API default); `streamText` with system = Article-50-honest prompt + grounding + sourced passages; tools: `proposeReviewAction` (inputSchema = proposal schema, toolApproval per v7, execute = same applyReviewDecision path); `experimental_toolApprovalSecret`; → `toUIMessageStreamResponse()`. Unconfigured → 503.
- [ ] `knowledge.ts` + rewrite `POST /api/knowledge/query`: keyword mode via `retrieveKnowledge`; vector branch stubbed to keyword until 5.11; `knowledgeQueryResultSchema` validated.
- [ ] api.spec: knowledge pin rewrite (≥1 passage, source matches /Skatteverket|Bokföringslagen|BAS/, mode keyword); advisor smoke (200, `text/event-stream`, stream header, data: frames + finish); assistant-sessions pin untouched.
- [ ] `CHECK` + `E2E:file api.spec.ts`. Commit: `feat(advisor): /api/advisor/chat — AI SDK 7 UI-message SSE (deterministic demo stream + Azure streamText), signed tool approval routing through the existing review decision; knowledge query returns real sourced passages; api-proxy streams`.

## Task 5.8 — Today becomes the drag-&-drop advisory dashboard

**Depends on 5.2 + 5.3 + 5.5 + 5.6.** **Files — Create:** `apps/web/components/dashboard/{dashboard,widget-registry,use-dashboard-data,mini-sparkline,mini-bars}.tsx/ts`, `apps/web/components/dashboard/widgets/{cash-position,review-queue,tax-timeline,observations,result,cash-bridge,vat-status,recent-activity,integrity}-widget.tsx`, `apps/web/components/ui/verified-ledger-chip.tsx`, `apps/web/components/today/review-queue-view.tsx`, `tests/e2e/dashboard.spec.ts`. **Modify:** `apps/web/components/screens/today-screen.tsx`, `apps/web/components/app-shell.tsx` (drop digest), `apps/web/app/(shell)/layout.tsx`, messages en+sv (`dashboard` + `observations`), `tests/e2e/home.spec.ts`, `tests/e2e/review-edit.spec.ts`. **Delete:** `apps/web/app/(shell)/@digest/`, `apps/web/components/digest/digest-panel.tsx`.

- [ ] `use-dashboard-data.ts`: shared queries only (workspace, month pack, VAT-period pack when different, integrity, company-settings) + memoized observations/deadlines.
- [ ] `dashboard.tsx`: SortableGrid over visibleIds in `grid gap-4 sm:grid-cols-2 xl:grid-cols-3` (widgets `min-w-0`); picker+reset in header aside; add/remove/reset in `withViewTransition`; testids `dashboard-canvas`, `widget-<id>`.
- [ ] The 9 widgets per the plan's exact specs (honest empty states, Money everywhere, spec drill targets, NO recharts — inline SVG minis): cash-position (sparkline + runway phrase), review-queue (pending count, top item with `confidence-band` chip, `review-widget-approve`, `review-widget-batch` + `batch-approve-confirm` popover → sequential approvals → toast, open-queue link), tax-timeline (next 3, `tax-deadline-<kind>`, box-49 Money when period matches), observations (top-3 with severity dot + text label, `t(titleKey, params)`, `observation-chip` provenance links), result (periodResult + delta + 6-month mini-bars), cash-bridge (opening → top-2 drivers → closing mini-bars), vat-status (box 49 att betala/få tillbaka + set-aside + period), recent-activity (integrity.recentEvents top 5, system actors as "System"), integrity (`VerifiedLedgerChip`: chainLinked → "hash chain intact · BAS 2026 · N events", testid `integrity-chip`, warning styling when broken).
- [ ] `review-queue-view.tsx`: extract the ENTIRE queue verbatim (filters, cards, edit sheet, useReviewKeyboard, deep-link focus) — zero testid/hotkey changes; today-screen becomes the `?view=` switch (nuqs enum default dashboard; `?review=` forces queue) + header toggle.
- [ ] i18n `dashboard.*` + `observations.*` en+sv. Spec updates: home/review-edit goto `/today?view=queue`; home gains dashboard smoke.
- [ ] `dashboard.spec.ts`: 9 widgets render · keyboard-only reorder (focus handle → Enter → ArrowRight → Enter → order swapped AND persisted after reload) · picker remove/add/reset · observation provenance href resolves · one-tap approve decrements · batch-approve approves seed · axe idle AND mid-keyboard-drag.
- [ ] `CHECK` + `E2E:file dashboard.spec.ts` + palette-deeplink + home + review-edit. Commit: `feat(dashboard): Today becomes the drag-&-drop advisory dashboard — 9 widgets on shared queries, keyboard/long-press reorder, layout persistence, widget picker; review queue lives at ?view=queue with hotkeys intact; digest rail retired`.

## Task 5.9 — Advisor chat client rebuild

**Depends on 5.7.** **Files — Create:** `apps/web/components/advisor/{advisor-chat,message-part,approval-card,provenance-chips,suggested-prompts,local-demo-transport}.tsx/ts`. **Modify:** `apps/web/components/screens/assistant-screen.tsx` (rewrite), `apps/web/lib/assistant-thread-storage.ts` (v2), `apps/web/package.json` (exact ai + @ai-sdk/react), messages (`advisor`), `tests/e2e/assistant.spec.ts`.

- [ ] `advisor-chat.tsx` on `useChat` + `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses`; transport: fallbackStore active → `LocalDemoChatTransport` (ChatTransport impl replaying `buildDemoAdvisorTurn` parts as UIMessageChunks); else `DefaultChatTransport({ api: `${apiBaseUrl}/api/advisor/chat` })`.
- [ ] `message-part.tsx`: text → prose; `data-provenance` → `provenance-chips` (`provenance-chip`); approval-requested tool parts → `approval-card` (`advisor-approval-card`: drafted edited approval with account/VAT/Money, "Draft by AI — awaiting your approval", `advisor-approve-tool` → addToolApprovalResponse, reject → denied); tool output → confirmation row.
- [ ] Article 50: persistent `ai-assistant-label` StatusBadge + per-message `ai-generated-marker`; advisorEnabled false → honest disabled panel linking settings.
- [ ] Thread storage v2 (`...v2` key, `{id,title,messages: UIMessage[],savedAt}`, MAX 30, v1 read-migration); save onFinish; `assistant-thread-list` kept.
- [ ] `suggested-prompts.tsx` from observations (`advisor-suggested-prompt`).
- [ ] assistant.spec rewrite: cash question → streamed text + ai-generated-marker + provenance chip; "godkänn granskningen" → approval card → Approve → tool result AND `/today?view=queue` shows approved. Rail/dock/palette tests unchanged.
- [ ] `CHECK` + `E2E:file assistant.spec.ts`. Commit: `feat(advisor): assistant screen rebuilt on AI SDK 7 useChat — streamed parts, tool-approval cards through the review gate, provenance chips, Article 50 labeling, offline demo transport, thread storage v2`.

## Task 5.10 — Trust surfaces: ai-posture, confidence bands, timeline row, print chip

**Depends on 5.8 AND the Phase-4 exit commit.** **Files — Create:** `apps/web/components/settings/ai-posture-form.tsx`, `apps/web/components/reports/tax-timeline-row.tsx`, `tests/e2e/settings-ai-posture.spec.ts`. **Modify:** `apps/web/app/(shell)/settings/ai-posture/page.tsx`, `apps/web/components/settings/company-form.tsx` (+ `profile.vatPeriod` select, `company-vat-period`), `apps/web/components/today/filter-types.ts`, `apps/web/components/today/review-card.tsx`, `apps/web/components/screens/reports-screen.tsx`, print header, messages, `tests/e2e/settings-company.spec.ts`, `tests/e2e/reports.spec.ts`.

- [ ] `filter-types.ts` delegates to `confidenceBand()`; review-card band chip (`confidence-band`, tokens `--confidence-*`, text + color never color-alone).
- [ ] `suggestionsEnabled === false`: card hides AI block behind honest notice; human actions fully operable; widget hides chips + batch.
- [ ] `ai-posture-form.tsx`: About-this-AI (runtime-info provider/model/host + approval statement), Article 50 text, toggles `ai-toggle-advisor`/`ai-toggle-suggestions` via saveCompanySettings.
- [ ] `tax-timeline-row.tsx` on Reports (`id="tax-timeline"`, testid `tax-timeline`): next ~5 deadlines, calm/dated/source-cited, box-49 join; after VatReturnTable.
- [ ] Print header += `VerifiedLedgerChip`.
- [ ] Specs: vatPeriod round-trip; ai-posture (persist, About renders, Article 50 visible, advisor honors off); reports timeline assertions.
- [ ] `CHECK` + spec files. Commit: `feat(trust): real ai-posture settings (About-this-AI, per-feature toggles, Article 50), aligned H/M/L confidence bands with review-card chips, statutory timeline row + verified-ledger chip on reports`.

## Task 5.11 — RAG normal mode: pgvector ingestion + vector query

**Depends on 5.4 + 5.7 (∥ 5.10).** **Files — Create:** `packages/persistence-postgres/src/knowledge.ts`, `scripts/ingest-knowledge.mjs`, `tests/integration/knowledge-query.test.ts`. **Modify:** `packages/persistence-postgres/src/index.ts`, `services/api/src/knowledge.ts`, root `package.json` (`ingest:knowledge`), `docs/CONTRIBUTING.md`.

- [ ] `upsertKnowledgeDocuments` + `queryKnowledgeByEmbedding` (cosine `<=>` on halfvec(1536), score = 1 − distance, passage-shaped rows).
- [ ] `ingest-knowledge.mjs` (tsx): 5.4 chunker → `embed()` batches ≤64 → upsert; requires SUPABASE_DB_URL + Azure env with actionable failures; idempotent.
- [ ] knowledge route vector branch: normal + DB + operational AI → mode vector (embed query → vector search); any failure → keyword fallback with logged warn (never 500s the advisor).
- [ ] INTEG: two fixture chunks with mock embeddings → NN query order; manual-smoke note.
- [ ] `CHECK` + `INTEG`. Commit: `feat(rag): pgvector loop closed — tsx ingestion of the sourced corpus into knowledge.documents, cosine vector query behind /api/knowledge/query with honest keyword fallback`.

## Task 5.12 — Phase-5 exit gate

**Files — Modify:** `tests/e2e/visual-regression.spec.ts` (dashboard hydration waits if needed), all baselines, `docs/DEV_STATUS.md`, `CLAUDE.md` truth-pass, `docs/CONVENTIONS.md` if warranted.

- [ ] Full `CHECK` + full `E2E`. Re-baseline after reviewing EVERY diff: today (transformed), reports (timeline row), settings-company (vatPeriod), books/capture (shell-only from digest removal).
- [ ] E2E inventory green: dashboard, assistant, api (advisor SSE, knowledge, integrity, runtime-info, untouched assistant-sessions pins), settings-ai-posture, palette-deeplink/home/review-edit, reports, visual.
- [ ] Grep gates: `@dnd-kit` only in sortable-grid.tsx · `from "ai"`/`@ai-sdk/` only in components/advisor/_ + services/api/src/advisor/_ · `ambient-digest` zero · 0.95/0.8 confidence literals gone from filter-types · recharts absent from components/dashboard/\*\*.
- [ ] Bundle note: today chunk delta (dnd-kit), assistant chunk delta (ai + corpus), reports unchanged.
- [ ] DEV_STATUS limitations (>40 MSEK deadlines + public holidays not encoded; employer/F-skatt amounts date-only; chain verification linkage-only; assistant-sessions deprecated → Phase 6; missing-evidence excludes SIE imports; server-persisted layouts out of scope). CLAUDE.md Today/advisor sections corrected.
- [ ] Commit: `chore: phase 5 exit — advisory layer regression-locked (dashboard E2E + keyboard-drag axe, advisor stream, visual re-baseline, bundle notes)`.

---

### Critical Files for Implementation

- `packages/contracts/src/index.ts` — 5.1 schemas (everything hangs off it)
- `apps/web/components/screens/today-screen.tsx` — dashboard/queue switch; queue extracts verbatim
- `services/api/src/app.ts` — advisor chat, knowledge rewrite, integrity + runtime-info, error branches
- `apps/web/app/api-proxy/[...path]/route.ts` — the SSE-buffering fix (advisor streaming dies without it)
- `packages/reporting/src/observations.ts` — feeds dashboard, digest successor, advisor grounding, suggested prompts
