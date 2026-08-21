# Findings log

Append-only log of research findings, decisions, thresholds, and open questions — recorded as soon as established. Newest entries first within each date. (Discipline: every non-obvious fact that cost a research pass to establish gets a dated entry here so it is never re-researched.)

---

## 2026-08-20 — Swedish yearly-close (bokslut/årsredovisning/INK2) coverage audit + Kapitas-migration gap analysis

### What the product already covers for a yearly close (verified by code inventory)

- **SIE 4 import/export is shipped**: `packages/domain/src/sie/{parse,serialize,pc8}.ts`, `POST /api/imports/sie` (32 MiB, caps 500 vouchers / 100 lines each), `GET /api/exports/sie` (CP437 `.se`), UI in `quick-add-grid.tsx` + reports screen. Imported vouchers keep original series+number as aggregate id (`sie_<series>_<number>`) → re-import is idempotent.
- **Fiscal year is fully configurable** (`WorkspaceProfile.fiscalYearStart`, `MM-DD`, settings UI at `/settings/fiscal-year` + company form) and the period model (`packages/domain/src/reports/period.ts`) handles broken fiscal years (`fy-YYYY`, fiscal quarters).
- **Reports**: journal, huvudbok (client-grouped), period-movement trial balance, P&L, balance sheet (2 flat buckets + computed-result line), VAT boxes (05/10-12/20-21/30-32/48/49, whole-kronor truncation). Print = `window.print()` only; **no CSV, no server PDF**.
- **Tax calendar** (`packages/domain/src/tax/calendar.ts`): VAT (monthly/quarterly/yearly), AGI, F-skatt, årsredovisning (7 months after FY end). **INK2 is NOT modeled** — no income-tax-return deadline kind exists.

### Yearly-close gaps (the honest list — each is a feature, not a bug)

1. **SIE parser silently drops `#IB`/`#UB`/`#RES`** (`parse.ts` switch handles only `#SIETYP/#ORGNR/#FNAMN/#KONTO/#VER/#TRANS`) and the export emits none either → migrating a live company mid-history loses opening balances; no opening-balance concept exists anywhere in the domain. Cleanest fix: parse `#IB` and synthesize a `VoucherImported` opening-balance voucher (`sie_OB_<year>`) dated FY day 1; emit `#IB/#UB/#RES` on export.
2. **No evidence→imported-voucher linkage**: SIE-imported vouchers create no Voucher rows (by design), so receipts can't be attached to them; `composeEvidence` relink only works via Voucher-row maps. A migration needs either relink-to-ledger-aggregate or anchor rows.
3. **No close engine**: `getCloseRun()` returns an honest empty shell; `CloseRunGenerated`, `PeriodLocked`, `CorrectionPosted` are reserved/never-emitted; no resultatdisposition (result → 2091/2099), no bokslutsverifikationer, no period lock.
4. **No manual N-line journal entry** anywhere (API or UI) — `buildPostingLines` always emits the fixed 3-line template. Year-end adjustment entries (periodiseringar, avskrivningar, kontantmetoden AR/AP conversion, skatt) currently have NO input path except an SIE 4I file.
5. **BAS subset (68 accounts)** lacks year-end essentials: no accumulated-depreciation contras (1229/1259), no periodiseringsfond accounts (21xx obeskattade reserver), no 2510/2512 skatteskulder, no 8910 skatt på årets resultat (equity 2081/2091/2099 do exist). `classifyAccountNumber` first-digit fallback keeps imported unknown accounts bucketed, but without names/VAT codes.
6. **No årsredovisning document generation** (förvaltningsberättelse/noter/fastställelseintyg) and no INK2/SRU export. External tools (e.g. Årsredovisning Online, DigitalK2) consume SIE 4 → our existing export is the interop path, **but** those tools expect `#IB/#UB/#RES`, so gap 1 blocks that too.

### Kapitas interop facts (verified against kapitas.se docs 2026-08-20)

- Kapitas exports **SIE4 with balances + transactions** (Settings → Bokföring → SIE4 Export) and imports SIE4/4i; PDF-only reports (7 kinds); **no API**; **no CSV**; attachments do NOT travel in SIE and have no documented bulk export (per-voucher retrieval only — vendor-unconfirmed inference).
- **Kapitas free tier is being discontinued**: no new signups since 2026-04-02; existing free accounts get notice through 2026-09-30, then 60 days normal + 60 days export-only. Kapitas Plus = 59 kr/mo ex VAT. Kapitas has **no bokslut/årsredovisning/INK2 capability at any tier** (vendor-adjacent FAQ: "Bokslut ingår inte").
- Implication: any Kapitas-based company doing a yearly close needs a second tool regardless — that is exactly the wedge JPX Accounting's close features would fill.

### ⚠ Two statutory-content bugs found while verifying against Skatteverket/Bolagsverket (2026-08-20)

1. **`docs/knowledge/sv/moms-deklarationstider.md` has the helårsmoms conditions INVERTED.** Skatteverket ("När ska jag deklarera moms", canonical page): the _26:e i andra månaden efter beskattningsårets utgång_ rule applies to companies **with EU-handel** (or those not filing an inkomstdeklaration). Companies **without EU-handel** that file an inkomstdeklaration declare _i anslutning till inkomstdeklarationen_ — by FY-end month: jan–apr → 12 nov (paper)/12 dec (digital); maj–jun → 27 dec/17 jan; **jul–aug → 12 mars/12 april**; sep–dec → 12 juli/17 aug. Our corpus article states the 26:e-rule for "utan EU-handel" — wrong branch. The advisor cites this corpus → fix + `pnpm build:knowledge` + re-ingest.
2. **`docs/knowledge/sv/arsredovisning-ab.md` förseningsavgift amounts are stale.** Prop. 2024/25:8 ("Bolag och brott", in force 2025-01-01) raised private-AB late fees to **7 500 / +7 500 / +15 000 kr** (total 30 000). Corpus still says 5 000/5 000/10 000.
3. Same inverted-branch issue affects `packages/domain/src/tax/calendar.ts`: yearly VAT is computed only as 26th/27th of the second month after FY end — correct **only** for the EU-handel branch; a non-EU-handel helårsmoms company gets a deadline up to ~6 months too early (annoying) and, worse, the INK2-coupled real dates are absent. Needs an `euTrade`-style profile flag or both-branch modeling.
4. INK2 deadlines (verified): by bokslutsdatum — sep–dec → 1 jul (paper)/1 aug (digital); jan–apr → 1 nov/1 dec; maj–jun → 15 dec/15 jan; **jul–aug → 1 mars/1 april** (next year). Skatteverket's INK2 e-tjänst for FY ends jan–aug 2026 opens 2026-08-24. Not modeled in the tax calendar at all (gap noted above).

### 2026-08-20 (later) — 16-agent readiness verification (6 audits + 10 adversarial refutations)

Full matrix + build plan: [`docs/superpowers/specs/2026-08-20-kapitas-replacement-readiness.md`](superpowers/specs/2026-08-20-kapitas-replacement-readiness.md). Key corrections to the morning's entry established by the refute pass:

- **SIE 4I import is a general-purpose posting path, not just migration**: `planSieImport` accepts any balanced N-line voucher on ANY account (CoA is display-name only, `classifyAccountNumber` first-digit fallback covers statements) — so utlägg-to-2899, revenue, prelskatt, avskrivningar, periodiseringsfond, resultatdisposition, and rättelse vouchers are all postable TODAY via hand-authored SIE snippets. 8 of 10 "impossible" verdicts fell to this path.
- **Confirmed unrefutable**: VAT boxes 20/21/30-32 are structurally always 0 (`vat/boxes.ts:98-100` hardcoded + `consumedRates` starvation) and boxes 39/40 don't exist — the momsdeklaration is wrong for any company with EU purchases or export revenue regardless of how lines are posted. This + no-evidence-attach-to-imports are the two real product blockers.
- New confirmed facts: box 05 skipped for imported lines (`vatCode:"NA"` forced) → internally inconsistent VAT return on imported domestic sales; `#RAR 0`/fy-token boundary wrong for an irregular first FY (recurring MM-DD anchor only); V-numbers burn at intake (rejected drafts leave silent gaps); journal/huvudbok have no print path; demo mode is restart-volatile; hosted deploy has unverified migrations 0005-0008 + missing storage RBAC; **no backup tooling exists**; CP437 map lacks æ/ø.

### Open questions

- Should `buildSieExport` become period-scoped (per fiscal year) with `#RAR`, `#IB`, `#UB`, `#RES` blocks? (Required for handing one FY to an årsredovisning tool or revisor.)
- Priority call between "close checklist engine" (CloseRunGenerated + period lock + manual journal entries) vs "INK2 deadline in tax calendar" (one afternoon: add deadline kind parameterized by FY end month per Skatteverket's four filing windows).
- Tax-calendar helårsmoms fix needs an "EU-handel" boolean on `WorkspaceProfile` — schema + settings + calendar change, touches contracts (CONVENTIONS rule 1 schema-sync applies).

---

## 2026-08-06 — Wave F′ docs truth pass (P1-11 / F-1–F-3)

- **DEV_STATUS** Last reviewed → 2026-08-06; Waves 0 + A–C COMPLETE banner; integration gate rewritten to `pnpm db:test` / `DATABASE_TEST_URL` (+ legacy `SUPABASE_DB_URL` alias note).
- **CONVENTIONS / architecture** present-tense `SUPABASE_DB_URL` gates → `DATABASE_URL` + `pnpm db:*`; pooler flag → `DATABASE_POOL_MODE=transaction`.
- **REPO_MAP** plan index updated (active vs archive); gotcha #4 corrected — `closeDatabase` **is** wired via `registerGracefulShutdown`.
- **findings** engineering-patterns SIGTERM bullet corrected in place (this file, above section).
- **28 → 29** CONVENTIONS rule count in `.cursor/rules/jpx-accounting.mdc` + `.github/copilot-instructions.md`.
- **Archive policy (Q10):** 29 landed plans `git mv`’d to `docs/archive/superpowers/plans/` with STATUS banners; `docs/README.md` authority index added. Active plans remain: consolidation + full-sweep-next-steps + opportunity-backlog.

---

## 2026-08-06 — repo-health plan verification pass (10-agent fan-out + live registry/GHSA/EUR-Lex research)

### Dependency security (verified live against registry.npmjs.org + GitHub Advisory Database)

- **next@16.2.0 has 23 advisories** (12 high / 9 medium / 2 low). Fix floors stack up at 16.2.3, 16.2.5, 16.2.6, and 16.2.11 (a 9-advisory batch with 4 HIGHs incl. GHSA-6gpp-xcg3-4w24 — middleware/proxy bypass on App Router + Turbopack, this repo's exact config). **Decision: bump to exactly 16.2.12** (latest 16.2.x; `latest` dist-tag is 16.3.0 — skip the minor during a security pass). A previously drafted floor of ≥16.2.10 was insufficient.
- **hono@4.12.8 has 24 advisories** (1 high / 22 medium / 1 low). Repo-relevant: GHSA-88fw-hqm2-52qc (HIGH, CORS reflects any Origin with credentials; fixed 4.12.25), GHSA-f577-qrjj-4474 (JWT accepts any Authorization scheme; fixed 4.12.21), GHSA-8j4g-w8fx-2239 (ReDoS in CORS middleware; **fixed only in 4.12.34**). **Decision: bump to exactly 4.12.34.** A drafted floor of ≥4.12.31 was insufficient.
- **@hono/node-server**: latest 1.x is 1.19.17; **stay off the 2.x major**. The only advisory unpatched in 1.x (GHSA-frvp-7c67-39w9, Windows path traversal) requires `serveStatic`, which `services/api` never imports (grep-verified).
- **vercel/ai issue #13670 (tool-approval deny flow) is STILL OPEN as of 2026-08-06** — no released 7.x fix through 7.0.55; the predicate in `last-assistant-message-is-complete-with-approval-responses.ts` on upstream main still lacks `output-denied`. **Decision: `ai` 7.0.15 → 7.0.55 and `@ai-sdk/react` 4.0.16 → 4.0.58 are safe bumps, but the `apps/web/components/advisor/tool-approval.ts` workaround MUST be kept** (link the issue in a code comment; delete only when it closes with a released fix). No GHSA advisories affect ai@7.0.15.
- **recharts/react-is mismatch is real but subtle**: recharts 3.x declares `react-is` as a peer (`^16.8 || ^17 || ^18 || ^19`); pnpm deduped it against `react-is@16.13.1` from `prop-types@15.8.1`, so recharts runs react-is 16 under React 19. **Decision: add `react-is@19.2.8` as a direct apps/web dependency (or root pnpm override) + exact-pin recharts.**
- **next-intl** is on the current major (4.x; latest 4.13.5), zero advisories. Pin exactly during the save-exact pass.
- **Renovate**: `config:best-practices` now includes `security:minimumReleaseAgeNpm` (3-day npm cooldown) and `:maintainLockFilesWeekly`; `rangeStrategy: "pin"` needed to pin prod deps (`:pinDevDependencies` covers dev only). Repo has NO `.npmrc` → `pnpm add` writes carets by default. **Decision: `.npmrc` with `save-exact=true` + `renovate.json` extending `config:best-practices`, `rangeStrategy: pin`, ai-sdk/hono group rules, `run-e2e` label on framework bumps.**

### next-intl × react-joyride (verified against installed packages: use-intl 4.13.1, react-joyride 3.1.0)

- The onboarding `FORMATTING_ERROR` mechanism: `t()` compiles ICU and throws when `{current}/{total}` values are missing; error is wrapped as `FORMATTING_ERROR`, UI falls back to the full key path — so the button label is ALSO broken, not just console spam. **Decision: `t.raw("controls.nextWithProgress")` is THE pattern for handing templates to third-party libs** (`t.markup` is the wrong tool — it still runs full ICU; ICU brace-escaping pollutes locale files).
- **Latent second bug: `showProgress` is never set anywhere in apps/web**, and Joyride v3 uses `nextWithProgress` only when `continuous && step.showProgress && !isLastStep` — the locale key is dead config until `showProgress: true` is added (component `options` or per step). Fix both together or delete the key.
- Joyride v3 facts: locale keys `{back, close, last, next, nextWithProgress, open, skip}` (ReactNode); placeholders are `{current}`/`{total}` (v2's `{step}/{steps}` renamed); `disableBeacon` → `skipBeacon` confirmed; `nextLabelWithProgress` → `nextWithProgress`.
- **Unit-test pattern for message contracts without DOM** (fits the repo's `node:test` + tsx runner): `createTranslator({ locale, messages, namespace, onError(e) { throw e } })` — any `FORMATTING_ERROR` fails the test; assert `t.raw()` output still contains `{current}`/`{total}` verbatim.

### EU AI Act Article 50 (verified against Commission FAQ / EUR-Lex / Guidelines)

- **Article 50 applies from 2026-08-02** (Art. 113). The **2026-12-02 "marking grace" is real but NARROW**: introduced by the Digital Omnibus on AI (OJ 2026-07-24, in force 2026-07-27), it defers only Art. 50(2) machine-readable marking and only for systems **already on the market before 2026-08-02**. **JPX ships on/after that date → no grace applies; 2026-08-02 is the hard date for everything.**
- Role analysis: **JPX is the provider** (places the advisor on the market under its own name; Azure OpenAI is upstream); SME customers are deployers. 50(1) applies to the chat (existing badge + per-message marker is the right shape); **50(2) applies to generated advisor text → machine-readable metadata required on persisted/exported threads, not just visible labels**; DocIntel extraction is defensibly outside 50(2) as assistive/non-synthetic — document the rationale, don't assume it. 50(4) effectively N/A (not public-interest publishing; review gate satisfies human-review exception) but doesn't substitute for 50(2).
- Commission adopted **Guidelines on Art. 50 transparency (2026-07-20)**; a Code of Practice on marking is an adequacy pathway. For text, metadata-based marking is the accepted technique (no mandated standard; C2PA is media-oriented).
- **Decision: ship (A) `docs/compliance/article-50-assessment.md` (system inventory, role analysis, per-paragraph applicability + rationale) and (B) an `aiTransparency` metadata block** (`{aiGenerated, basis, provider, system, model, generatedAt, humanReviewed}`) stamped on every persisted/exported assistant message; record `humanReviewed: true` + reviewer at approval time. **Open question: have counsel confirm the provider-role analysis and the extraction-is-assistive rationale against the final Guidelines text before showing sponsors/auditors.**

### Engineering patterns (verified against installed packages + vendor docs)

- **postgres-js shutdown**: `sql.end({ timeout: 5 })` — timeout is SECONDS. **P1-13 landed (Wave A / PR #35):** `registerGracefulShutdown` in `services/api/src/shutdown.ts` wires SIGTERM/SIGINT to drain the HTTP server then `closeDatabase()` (`services/api/src/index.ts`). Prior “signal wiring missing” claims are **stale**. **Still open (owner):** verify `WEBSITES_CONTAINER_STOP_TIME_LIMIT` on the deployed Linux App Service — platform default is **5 s** (max 120), so without an explicit setting the 5 s pool drain can be SIGKILL’d. Windows never delivers SIGTERM (listen anyway — harmless); SIGINT works everywhere; `process.exit()` is still needed because open SSE sockets keep the loop alive.
- **Zod v4 tenant-field removal pattern**: default `z.object` strips unknown keys (safe removal path, mirrors the actorId R5 precedent); for security-relevant keys prefer **`z.never().optional()` tripwires** on the wire schema (present ⇒ 400, absent ⇒ ok) while other unknown keys still strip — do NOT blanket-`strictObject` (breaks additive evolution).
- **AI SDK 7 already fail-closes on system-in-messages**: `standardizePrompt` defaults `allowSystemInMessages: false` and THROWS `AI_InvalidPromptError` at model-call time. So a client-posted `role:"system"` message today = unhandled mid-stream 500, not injection — the fix is a server-side filter before `convertToModelMessages` (clean drop or 400), never `allowSystemInMessages: true`. Dropping input messages has zero SSE-protocol impact (the stream never echoes input history).
- **Hono typed tenant middleware**: `createMiddleware<{Variables}>` after the `jwk` gate; `c.set("tenantScope", …)` allowed in exactly one file (grep-gated seam); handlers consume `c.var.tenantScope`. **Open question (blocking multi-tenant later): provisioning `org_id`/`workspace_id` claims into Supabase JWT app_metadata is a decision nobody has made yet** — until then the store-constructor `DEFAULT_TENANT_SCOPE` is the single authority.
- **Playwright visual CI**: exact-pin `@playwright/test` (currently `^1.58.2` caret — can drift from the `mcr.microsoft.com/playwright:v1.58.2-jammy` image). `page.clock` is stable API at 1.58.2 but freezing the browser clock alone does NOT stabilize today/reports baselines here (API demo seed uses real "now" — documented in `scripts/visual-baselines.md`); a demo-seed date override env var would be needed for full determinism. Newer Playwright images default `-noble`; re-check the tag matrix when bumping past 1.58.x.
- **i18n literal gate without new deps**: eslint-config-next's flat preset already registers `eslint-plugin-react`, so `react/jsx-no-literals` can be enabled per-directory in `eslint.config.mjs` with zero new dependencies (ratchet directory list as surfaces finish migrating; `ignoreProps: true`; escalate to `eslint-plugin-i18next` only if false-positive rate is too high).

### Repo-shape discoveries (from the navigation-map pass — full detail in `docs/REPO_MAP.md`)

- `packages/supabase-client/` is a dead ghost directory (stale `node_modules/` only) — deletion candidate.
- `GET /api/reports/general-ledger` ≡ `GET /api/reports/trial-balance` (one handler, two names).
- 7 of 19 ledger event types are reserved and never emitted; the orphaned assistant chain (`domain/assistant.ts`, `answerAssistantQuestion`, `assistant_sessions` table) has no live route since Phase 6.
- `check-seams.sh` and `check:corpus` look like gates but are not wired into CI.
