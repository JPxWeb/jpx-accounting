# Full Improvement Sweep Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-07-05  
**Status:** Verified — synthesized from six swarm agents, then forensically re-verified against source 2026-07-05 (see "Verification pass"). §A corrections override conflicting task text.  
**Branch target:** `main` (post advisory-pivot Phase 5 exit)

**Cross-links (authoritative):**

- [`AGENTS.md`](../../../AGENTS.md) — invariants win on conflict
- [`docs/DEV_STATUS.md`](../../DEV_STATUS.md) — phase completion truth
- [`docs/DEPLOY_UNBLOCK.md`](../../DEPLOY_UNBLOCK.md) — storage RBAC unblock playbook
- [`docs/CONVENTIONS.md`](../../CONVENTIONS.md) — 28 incident-derived rules
- Prior pivot: [`2026-07-03-advisory-pivot-master-plan.md`](./2026-07-03-advisory-pivot-master-plan.md)

**Goal:** Close the gap between “demo-complete advisory pivot” and “production-hardened, CI-honest, store-parity-correct” without violating append-only ledger, review gate, store parity, or fail-closed invariants.

**Verification vocabulary:**

- `CHECK` = `pnpm check` (lint + format:check + typecheck + typecheck:tests + unit + build)
- `E2E` = `pnpm build:e2e && npx playwright test --grep-invert "visual:"`
- `E2E:visual` = `pnpm test:e2e:visual` (review diffs before `--update-snapshots`)
- `INTEGRATION` = `SUPABASE_DB_URL=… pnpm test:integration`

---

## Executive summary

1. **Deploy CD is unblocked** (`assignStorageRoles=false`) but **blob SAS still 403** until Johan completes [`DEPLOY_UNBLOCK.md`](../../DEPLOY_UNBLOCK.md) Option 1 or 2 — capture/preview in `normal` mode remains broken in Azure.
2. **CI diverges from local gate:** `.github/workflows/ci.yml` omits `typecheck:tests`, uses `pnpm build` not `build:e2e`, never runs integration tests, and E2E on Linux may disagree with win32 baselines.
3. **Deploy does not wait for CI** — push to `main` can ship before typecheck/unit/build/E2E complete; deploy smoke-tests `/health` + `/ready` + web root, but the `/ready` check is shape-only (passes even when the API fails closed) and there is no advisor/capture probe (§A C1).
4. **Security gaps in normal mode:** JWT middleware is presence-only (not identity-bound), clients spoof `actorId`/`orgId`, demo `ADVISOR_TOOL_APPROVAL_SECRET` default applies when env unset, and demo advisor approval can be forged without HMAC.
5. **Store parity bugs:** `composeEvidence` voucher relink diverges Memory vs Postgres; Postgres `getSnapshot()` omits `alerts`/`assistantExamples`; Memory `applyReviewDecision` mutates shared refs (CONVENTIONS Rule 17).
6. **API/UI contract drift:** `reviewDecisionSchema` unused; `buildExcerpt` duplicated; `api-client` lacks `refreshComplianceAlerts`; simulation/compliance APIs exist with no UI; `getCloseRun` is a stub.
7. **Frontend debt:** Settings i18n broken on company/about/sidebar; About page still renders stale `ComingSoon` blocks; `localTodayIso()` triplicated; `data-visual-mask` gaps remain; grep gates pass locally but are not CI-enforced.
8. **Postgres has no RLS** — workspace isolation is application-layer only; hardening plans under `docs/superpowers/plans/2026-05-19-supabase-hardening.md` intent applies to live `PostgresLedgerStore`.
9. **`parseBody` → `@hono/zod-validator` is now feasible** — Zod v4 support landed in `@hono/zod-validator`; migrate with parity tests, do not swap blindly (CONVENTIONS Rule 5).
10. **Do NOT recommend:** Server Actions for ledger posting, `useOptimistic` for review approvals, skipping Memory/Postgres parity, or silent demo fallbacks in `normal` mode.

---

## Verification pass — corrections & additions (2026-07-05)

> Every codebase claim below was independently re-derived from source by a 7-agent forensic verification workflow (disjoint file ownership, 114 file reads/greps against `main` at commit `c001cd3`). **This section OVERRIDES any conflicting statement elsewhere in this document.**
>
> **Verdict summary:** ~30 claims CONFIRMED with exact line evidence · **8 corrected** (1 refuted, 7 partial) · **20 net-new findings** added below. All cross-links resolve; `parseBody`, `SELECT … FOR UPDATE` hash-chain lock, and the `assignStorageRoles` gate were re-validated intact — do not disturb them.

### A. Corrections — claims that were wrong or imprecise (apply before executing)

| #      | What the plan says                                                                                | Verified reality                                                                                                                                                                                                                                                                                                                                                                                          | Action                                                                                                                                                                                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C1** | Deploy smoke tests hit `/health` only (High/Infra)                                                | Deploy also probes `/ready` **and** the web root (`deploy.yml` L186–230). The `/ready` check only asserts `has("ready") and has("checks") and has("runtimeMode")` — **not** `ready===true`, so a fail-closed normal-mode API (missing `SUPABASE_DB_URL`) still passes green.                                                                                                                              | Re-scope the gap to: (a) no advisor/capture functional probe, (b) `/ready` is shape-only, not liveness.                                                                                                                                                                                |
| **C2** | `getCloseRun`: "honest empty state exists in UI but API returns synthetic data" (L119)            | **Self-contradictory & wrong on the UI half.** Both stores return a byte-identical hardcoded checklist (`domain/store.ts:1031-1042`, `persistence/store.ts:1377-1388`); `close-view.tsx:38` renders it verbatim via `.map` with **no** empty/disabled branch. Synthetic data reaches the user unmasked.                                                                                                   | Phase 3.5 must add an empty state to `close-view.tsx`, not just fix the store. Raise severity: this is user-visible fake data.                                                                                                                                                         |
| **C3** | Phase 1.5: "enforce `ACCOUNTING_CORS_ORIGINS` in normal (`app.ts`)"                               | **Already implemented** — `config.ts:55-66` + `app.ts:209-222` echo only allow-listed origins in normal (empty allowlist ⇒ fail-closed reject-all).                                                                                                                                                                                                                                                       | The app-code task is a **no-op**. The real gap is wiring the env var through Bicep/deploy → moved to Phase 0.2.                                                                                                                                                                        |
| **C4** | Settings i18n = "missing `sv.json` keys" / Rule 6 parity (Phase 4.3)                              | `en.json` ≡ `sv.json` at **exact parity (625 keys each, zero diff)**. Real defect: 3 components (`company-form`, `settings-about-screen`, `settings-sidebar`) bypass next-intl with hardcoded English, and there is **no** `settings.company/about/sidebar` namespace in _either_ catalog.                                                                                                                | Task 4.3 = create namespaces **and** refactor 3 components. Drop the parity framing.                                                                                                                                                                                                   |
| **C5** | `localTodayIso()` "4×" (Consolidation L127); "delete 3 web copies" (4.5, quick-win)               | **5 byte-identical private copies**: `domain/reports/period.ts:97`, **`domain/tax/calendar.ts:72` (missed)**, `fiscal-year-form.tsx:18`, `tax-timeline-row.tsx:15`, `use-dashboard-data.ts:33`. `period.ts`'s copy is **private**, not an export.                                                                                                                                                         | Fix count 4→5; `export` `period.ts:97`; replace the domain `calendar.ts` copy too (not just 3 web files).                                                                                                                                                                              |
| **C6** | `data-visual-mask` gaps: "journal hashes, activity dates, tax timeline" (4.6)                     | Only **`tax-timeline-row.tsx`** is a real gap (renders today-relative deadlines on screenshotted `/reports`, no mask). Journal renders **no hashes** and its date is already masked (`journal-view.tsx:111`); activity dates already masked (`recent-activity-widget.tsx:48`).                                                                                                                            | Narrow 4.6 to the tax timeline only; 2 of 3 named targets are already done.                                                                                                                                                                                                            |
| **C7** | `buildExcerpt` "duplicated / identical algorithm"; consolidate into `packages/domain` (L128, 2.4) | **Not identical** — `advisor/retrieval.ts:135` is query-**centered** with two-sided ellipsis; `persistence/knowledge.ts:110` is start-**anchored**, no query arg. Neither is exported. Only the `EXCERPT_TARGET_CHARS=300` constant is shared.                                                                                                                                                            | Unifying **changes** pgvector excerpt behavior → needs a regression pin, not a mechanical de-dup. **Reject** the `packages/domain` target: advisor is isomorphic-pure and must not import domain — put the shared util where advisor may already import (advisor itself or reporting). |
| **C8** | "Demo advisor approval forgery" is a Critical hole (L64, Phase 1.2)                               | The demo path _does_ skip HMAC (`chat.ts:354-375`) — **but** forging a demo approval grants no privilege the anonymous demo user lacks (same `MemoryLedgerStore` + `applyReviewDecision` the queue button already exposes). The genuinely exploitable case is **normal mode running on the demo HMAC default** (ties to Phase 1.1); AI SDK verifies HMAC only in the streamText path (`chat.ts:415-416`). | Merge the Critical row into Phase 1.1. Phase 1.2 "add HMAC to the demo replay" is largely moot; the actionable fix is fail-closed on the demo secret in normal mode + a normal-mode forged-HMAC rejection test.                                                                        |

### B. New findings the plan missed (fold into the noted phase)

| #        | Finding                                                                                                                                                                                                                                                                                                     | Evidence                                                                                                                       | Phase               |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| **N1** ⚠ | **Second Azure blocker:** storage CORS allowlist is localhost-only and `deploy.yml` never overrides it — prod browser `PUT`s to the SAS URL fail preflight in normal mode **even after the 0.1 RBAC fix**.                                                                                                  | `main.bicep:86-87` (`storageCorsAllowedOrigins = 'http://localhost:3002,http://localhost:3200'`), unset in `deploy.yml` params | **0.2**             |
| **N2**   | `deploy.yml` `failOnStdErr: false` on `arm-deploy` masks Bicep errors; combined with no CI gate, a bad template reaches prod more easily.                                                                                                                                                                   | `deploy.yml:133`                                                                                                               | 0                   |
| **N3**   | Second stale migration reference beyond the table: the RAG psql comment.                                                                                                                                                                                                                                    | `docs/CONTRIBUTING.md:100` (`# migrations 0001–0003 applied`)                                                                  | 0.6                 |
| **N4** ⚠ | **Read routes have zero auth even when `SUPABASE_JWKS_URL` is set** — the `jwk` middleware guards only POST/PUT/PATCH/DELETE. `/api/workspace`, `/api/reports/*`, `/api/integrity`, `/api/evidence/:id`, `/api/settings/*` leak the full snapshot with no token. The plan's JWT tasks cover mutations only. | `app.ts:303-305` (method filter), reads at `app.ts:399/403-419/423/537/638`                                                    | **1.3** / 5         |
| **N5** ⚠ | **JWT `alg` hardcoded to `RS256`** likely rejects Supabase's **ES256** default asymmetric signing keys → would `401` all legitimate users the moment auth is enabled.                                                                                                                                       | `app.ts:301` (`alg: ["RS256"]`); comment at `app.ts:298` acknowledges ES256 but no env plumbing exists                         | **1.3**             |
| **N6**   | SIE import reads `actorId` from a **query string**, bypassing even the Zod body schema — the weakest attribution sink, not enumerated in 1.4.                                                                                                                                                               | `app.ts:585` (`req.query("actorId") ?? "user_founder"`)                                                                        | 1.4                 |
| **N7**   | `experimental_toolApprovalSecret` (AI SDK 7) is the **sole** normal-mode forgery guard and is an unstable `experimental_` API; no test pins that an unsigned/wrong-secret approval is rejected.                                                                                                             | `chat.ts:415-416`                                                                                                              | 1.6 + risk register |
| **N8**   | Memory `getSnapshot()` **also** returns internal mutable arrays by reference (`assistantExamples`, `alerts`) — same Rule 17 class as 2.3; `answerAssistantQuestion` then `unshift`s into that shared array, mutating a previously-returned snapshot.                                                        | `domain/store.ts:834,836` + `:936-939`                                                                                         | 2.3                 |
| **N9**   | `composeEvidence` is self-inconsistent **within** Postgres: `getEvidenceContext` resolves the newest packet (`ORDER BY created_at DESC`) while `getSnapshot` resolves via the voucher's stale `evidence_packet_id`. The 2.1 helper + test must converge both read paths.                                    | `persistence/store.ts:687` vs `:1092`                                                                                          | 2.1                 |
| **N10**  | `composeEvidence` packet-shape parity: Memory always sets `note`/`voiceTranscript` keys; Postgres omits them when `undefined`, so snapshots can serialize differently. Pin the exact `EvidencePacket` shape.                                                                                                | `domain/store.ts:597-601` vs `persistence/store.ts:622-623`                                                                    | 2.1 / 2.6           |
| **N11**  | Evidence→packet→voucher join SQL is duplicated verbatim (~40 lines) between two read paths. Extract `resolvePacketAndVoucher(runner, evidenceId)` accepting client-or-tx.                                                                                                                                   | `persistence/store.ts:674-689` vs `:740-755`                                                                                   | 2 (consolidation)   |
| **N12**  | `getReviewFeed` orders by `id DESC` — a lexical sort of random-suffixed ids, not creation order → diverges from Memory's insertion-order feed (feeds the dashboard queue).                                                                                                                                  | `persistence/store.ts:988`                                                                                                     | 2 (parity)          |
| **N13**  | `reviewDecisionSchema` has 5 values but only 3 (`approve`/`reject`/`book-without-vat`) have routes; `request-more-evidence` + `split-posting` are dead. Wiring implies store support that doesn't exist → lean delete/trim.                                                                                 | `contracts/index.ts:21` vs `app.ts:572-576`                                                                                    | 2.5                 |
| **N14**  | `GET /api/close-runs/:id` ignores the `id` and returns the same synthetic run — a second synthetic surface beyond `getCloseRun`.                                                                                                                                                                            | `app.ts:623-628`                                                                                                               | 3.5                 |
| **N15**  | Compliance-watch refresh is **dead end-to-end**: no api-client method **and** no web caller (only a section-anchor id). Phase 3.4 needs a paired UI subtask, mirroring the sim-UI gap (4.2).                                                                                                                | route `app.ts:630`; no consumer in `apps/web`                                                                                  | 3.4                 |
| **N16**  | `company-form.tsx` i18n is larger than "surgical": it hardcodes `COUNTRY_LABELS`, `LOCALE_OPTIONS`, `CURRENCY_OPTIONS`, and a 12-entry `MONTH_LABELS`. Budget a new key block + label-map refactor.                                                                                                         | `company-form.tsx:25,29-32,36+`                                                                                                | 4.3                 |
| **N17**  | Visual regression screenshots only `settings-company` among the now-**8 real** settings pages. Decide whether to add baselines for the 7 newly-real pages or document why not.                                                                                                                              | `visual-regression.spec.ts:14-22`                                                                                              | 4.6                 |
| **N18**  | `settings-about-screen.tsx:70` uses the `toISOString().slice(0,10)` UTC pattern (Rule 14) in a `dateTime` attr; swap to the shared `localTodayIso` when 4.4 touches the file.                                                                                                                               | `settings-about-screen.tsx:21,70`                                                                                              | 4.4                 |
| **N19**  | `2026-05-19-supabase-hardening.md` is stale vs the direct-`postgres-js` reality (it assumes `auth.uid()`/PostgREST). Phase 5 must reconcile/supersede it so an implementer doesn't copy PostgREST-oriented policies verbatim.                                                                               | plan L179 refinement already notes `current_setting('app.workspace_id')`                                                       | 5                   |
| **N20**  | Rule 29 (5.5) is documentation-only with no test teeth. Pair it with a cross-workspace read-isolation integration test so "application-layer only" is enforced, not just described.                                                                                                                         | —                                                                                                                              | 5.5                 |

### C. Doc-truth correction (fact, feeds Phase 6.4)

- **All 8 settings sub-pages now render real, wired components** — not just company/about/ai-posture. The 5 the docs still call stubs (`compliance`, `fiscal-year`, `integrations`, `retention`, `team`) each render a real component (`ComplianceIntegrityPanel`, `FiscalYearForm`, `IntegrationsPosture`, retention statutory policy, `TeamOverview`). Update CLAUDE.md / DEV*STATUS from "5 of 8 still header-only stubs" to **"0 header-only stubs remain."** (Note: two \_cards inside* `settings-about-screen` — Profile, Billing — are genuinely unbuilt; keep those honest, see C-item under 4.4.)

---

## Verified strengths (what NOT to redo)

| Area                           | Evidence                                                                                                 | Keep as-is                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Append-only + review gate      | Phase 3–5 exit; advisor `proposeReviewAction` → HMAC approval → `applyReviewDecision`                    | Never bypass queue; never mutate history        |
| API proxy streaming            | `apps/web/app/api-proxy/[...path]/route.ts` forwards `response.body` + SSE header                        | Do not reintroduce `arrayBuffer()` buffering    |
| `parseBody` deferral (for now) | Produces exact `{ code: "validation_error", issues[] }` shape pinned in `tests/unit/api-runtime.test.ts` | Migrate only with parity test first             |
| Grep architectural seams       | `@dnd-kit` only in `sortable-grid.tsx`; `ai`/`@ai-sdk` only in advisor dirs; recharts lazy barrel        | Enforce in CI, don't relax                      |
| Advisory pivot deliverables    | 104 functional E2E + 20 visual baselines; 213 unit tests; Phase 0–5 COMPLETE per DEV_STATUS              | Don't re-land dashboard/advisor/capture/reports |
| Demo mode honesty              | `StubBlobUploader`, `LocalDemoChatTransport`, explicit demo labels                                       | Fail closed in `normal`, never silent fallback  |
| Bicep storage RBAC gate        | `assignStorageRoles` param unblocked CD                                                                  | Follow DEPLOY_UNBLOCK for role grants           |
| Shared domain helpers          | `evidence-defaults.ts`, `confidenceBand()`, period resolver in `packages/domain/src/reports/period.ts`   | Extend shared helpers, don't fork store logic   |

---

## Critical findings

| Issue                                                                  | Files                                                                                                                   | Risk                                                                              | Owner                              |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------- |
| Storage RBAC missing — blob SAS 403 in `normal`                        | `infra/azure/main.bicep`, `services/api/src/blob.ts`, [`DEPLOY_UNBLOCK.md`](../../DEPLOY_UNBLOCK.md)                    | Capture upload + evidence preview/OCR broken in Azure                             | Johan (subscription Owner) + infra |
| **Storage CORS localhost-only — prod PUT preflight fails in `normal`** | `infra/azure/main.bicep` (L86-87), `.github/workflows/deploy.yml`                                                       | **Second** blocker: capture upload fails in Azure even after the RBAC fix (§A N1) | infra                              |
| Deploy secrets gaps                                                    | `infra/azure/main.bicep`, `.github/workflows/deploy.yml`, `services/api/src/config.ts`                                  | Production runs with demo HMAC default; no JWKS/CORS wiring                       | infra                              |
| Demo advisor approval forgery                                          | `services/api/src/advisor/chat.ts`, `apps/web/components/advisor/local-demo-transport.ts`, `services/api/src/config.ts` | Tool approvals bypass review gate integrity in misconfigured deploy               | api                                |
| JWT presence-only, not identity                                        | `services/api/src/app.ts`, `services/api/src/runtime.ts`                                                                | Any valid JWT (or bypass when unset) can mutate; no `sub` → actor binding         | api                                |
| Client `actorId` / org spoofing                                        | `packages/contracts/src/index.ts`, `services/api/src/app.ts`, `apps/web/lib/workspace-identity.ts`, review mutations    | Audit trail lies; cross-tenant risk when auth lands                               | api + web                          |
| Postgres `getSnapshot()` omits alerts + assistantExamples              | `packages/persistence-postgres/src/store.ts` (~L1089), `packages/domain/src/store.ts`                                   | UI/API read stale empty arrays in normal mode                                     | domain                             |
| Memory `applyReviewDecision` mutates shared refs                       | `packages/domain/src/store.ts`                                                                                          | Demo singleton leaks state across requests (Rule 17)                              | domain                             |
| `composeEvidence` voucher relink drift                                 | `packages/domain/src/store.ts`, `packages/persistence-postgres/src/store.ts`                                            | Evidence→voucher linkage wrong in one store                                       | domain                             |
| CI uses `pnpm build` not `build:e2e`                                   | `.github/workflows/ci.yml` L104, `playwright.config.ts` L43–44                                                          | E2E may pass locally, fail in CI (missing `NEXT_PUBLIC_*`)                        | infra                              |
| Deploy doesn't wait for CI                                             | `.github/workflows/deploy.yml` (parallel to CI on push)                                                                 | Broken code can reach Azure                                                       | infra                              |
| Web Docker bakes demo `NEXT_PUBLIC_*`                                  | `apps/web/Dockerfile` L19 (`pnpm build`), deploy web container                                                          | Production web may run with demo runtime inlined                                  | infra                              |
| No Postgres RLS                                                        | `infra/supabase/migrations/0001_init.sql` … `0004_*.sql`                                                                | DB-level tenant isolation absent                                                  | domain + infra                     |

---

## High / medium findings (condensed)

### Infra & CI (agent `aa0416e1`)

- CI check job skips `pnpm typecheck:tests` despite `pnpm check` including it.
- Integration tests never run in CI (`SUPABASE_DB_URL` secret not wired).
- Visual baselines captured on win32; CI runs ubuntu-latest — platform suffix mismatch risk per Playwright docs.
- Deploy smoke tests probe `/health` + `/ready` + web root (`deploy.yml` L186–230), but `/ready` is asserted **shape-only** (not `ready===true`), so a fail-closed API still passes; no advisor/capture spot check (§A C1).
- Migration docs drift: `0004_compliance_and_settings.sql` not listed in `docs/CONTRIBUTING.md` migration table.

### Best practices (agent `45f7236e`)

- Stack aligned with July 2026 (Next 16, React 19, Hono, Zod v4, pnpm 10).
- CSP nonce optional hardening deferred — current `headers()` baseline in `apps/web/next.config.ts` is acceptable for Phase 6.
- Axe contrast violations on some routes deferred — fix via tokens, not rule disables.
- Integration gate remains local-only until CI secret lands.

### Backend API (agent `53cd2536a`)

- Rate limiter present but CORS origins ignored in demo; `ACCOUNTING_CORS_ORIGINS` not in deploy Bicep params.
- `parseBody` correctly deferred — orchestrator confirms `@hono/zod-validator` Zod v4 path now open.
- Proxy streaming solid — no change needed.

### Frontend (agent `f13526ac`)

- Settings company/about/sidebar: hardcoded English or missing `sv.json` keys.
- `apps/web/components/screens/settings-about-screen.tsx` still uses `ComingSoon` for sections that landed elsewhere.
- `localTodayIso()` triplicated: `packages/domain/src/reports/period.ts`, `use-dashboard-data.ts`, `tax-timeline-row.tsx`, `fiscal-year-form.tsx`.
- Phase 8 plan still says "5 settings stubs" — company, about, ai-posture are real (DEV_STATUS).
- Grep gates not enforced in CI workflow.

### Domain (agent `0b833c1a`)

- `reviewDecisionSchema` in contracts unused — drift from API routes.
- `buildExcerpt()` duplicated in `packages/advisor/src/retrieval.ts` and `packages/persistence-postgres/src/knowledge.ts`.
- Bounded alerts logic correct in Memory; Postgres path needs snapshot parity.

### Orchestrator (agent `01b56b39`)

- Compliance panel (`compliance-integrity-panel.tsx`) reads `GET /api/integrity` — correct for hash chain; **compliance alerts list** still unwired (DEV_STATUS P1).
- `api-client` missing `refreshComplianceAlerts()` despite `POST /api/compliance-watch/refresh`.
- Simulation API (`POST /api/simulations/run`) has no queue UI.
- `getCloseRun` stub in both stores returns a hardcoded checklist; `close-view.tsx:38` renders it **unmasked** (no empty state), so synthetic data reaches the user, and `GET /api/close-runs/:id` echoes it for any id (§A C2, N14).

---

## Consolidation opportunities

| Theme                | Duplication / drift                                                                                                     | Consolidation target                                                                                                                                                    | Rule                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Date "today"         | **5×** `localTodayIso()` (period.ts + `domain/tax/calendar.ts:72` + 3 web files, all private)                           | `export` from `packages/domain/src/reports/period.ts`; domain `calendar.ts` + 3 web files import it (§A C5)                                                             | CONVENTIONS Rule 14 (local calendar, not UTC) |
| Knowledge excerpts   | 2 **divergent** same-named `buildExcerpt()` (query-centered vs start-anchored), sharing only `EXCERPT_TARGET_CHARS=300` | Shared util in `packages/advisor` or `reporting` (**not** `packages/domain` — advisor is isomorphic-pure); unify signature + **regression-pin** pgvector output (§A C7) | DRY, but behavior-changing                    |
| Review decision enum | `reviewDecisionSchema` unused                                                                                           | Wire in API `parseBody` / zValidator or delete with contract sweep                                                                                                      | Rule 5 — contract sync                        |
| Snapshot shape       | Memory vs Postgres `getSnapshot()`                                                                                      | Single projection helper returning full `workspaceSnapshotSchema`                                                                                                       | Rule 2 — integration proof                    |
| Actor attribution    | Hardcoded `user_founder` in web + API query fallback                                                                    | JWT `sub` → server-side actor; demo keeps explicit constant                                                                                                             | Fail closed                                   |
| CI vs local gate     | `check` vs `ci.yml` steps                                                                                               | Make CI ≡ `pnpm check` + conditional E2E/integration                                                                                                                    | AGENTS.md DoD                                 |
| Visual stability     | Ad-hoc mask attributes                                                                                                  | Audit clock-derived UI; centralize mask list in visual spec comment                                                                                                     | AGENTS.md seam                                |
| Settings copy        | Stale ComingSoon + i18n gaps                                                                                            | One i18n agent batch for `messages/en.json` + `sv.json`                                                                                                                 | Rule 6 i18n parity                            |
| Deploy env           | Bicep params vs `.env.example`                                                                                          | Single matrix in CONTRIBUTING + Bicep parity                                                                                                                            | DEPLOY_UNBLOCK                                |

---

## Research-backed enrichments

Validated against Context7 (July 2026) and vendor docs. Recommendations **refine** phase tasks; they do **not** override [`AGENTS.md`](../../../AGENTS.md) invariants.

### Next.js 16 — standalone, Docker, CSP

- **Standalone output:** Next.js 16 documents `output: 'standalone'` producing a minimal server bundle; Docker must copy `.next/standalone`, `.next/static`, and `public` separately ([Next.js output docs](https://github.com/vercel/next.js/blob/v16.2.9/docs/01-app/03-api-reference/05-config/01-next-config-js/output.mdx), [with-docker example](https://github.com/vercel/next.js/blob/canary/examples/with-docker/Dockerfile)). **Refinement:** `apps/web/Dockerfile` already follows this layout; add **`ARG`/`ENV` for `NEXT_PUBLIC_ACCOUNTING_RUNTIME_MODE=normal`** at build time for production images — do not bake demo literals.
- **CSP nonce (optional Phase 6):** Next.js 16 CSP guide supports nonce via Proxy/middleware setting `x-nonce` + `'strict-dynamic'` ([CSP guide](https://github.com/vercel/next.js/blob/v16.2.9/docs/01-app/02-guides/content-security-policy.mdx)). **Refinement:** keep current static CSP for Phase 0–5; nonce migration is a deliberate Phase 6 hardening task with visual E2E re-run — dev still needs `'unsafe-eval'` for HMR.
- **React 19:** No Server Actions for ledger mutations — React 19 actions are a poor fit for append-only, HMAC-gated review flow (project invariant). Keep mutations on Hono API + explicit human approval.

### Hono — zValidator, JWT, rate limiting

- **`@hono/zod-validator`:** Official middleware pattern: `zValidator('json', schema)` → `c.req.valid('json')` ([honojs/middleware README](https://github.com/honojs/middleware/blob/main/packages/zod-validator/README.md)). **Refinement:** Phase 3 migration replaces `parseBody` route-by-route; preserve `{ code: "validation_error", issues[] }` via custom hook or wrapper — parity test in `tests/unit/api-runtime.test.ts` first.
- **JWT:** Hono `jwt` middleware + JWK (`hono/jwk`) validates signature; bind `sub` to server-side `actorId`, never trust client body ([jwt + casbin example pattern](https://github.com/honojs/middleware/blob/main/packages/casbin/README.md)). **Refinement:** when `SUPABASE_JWKS_URL` set, reject mutations without verifiable `sub`; map to workspace membership when auth ships.
- **Rate limiting:** Keep `hono-rate-limiter` on mutating routes; add integration test for 429 shape.

### Zod v4

- Zod 4 stable with ~100× fewer `tsc` instantiations on chained `.extend()`/`.omit()` ([Zod v4 changelog](https://zod.dev/v4/changelog), [performance note](https://zod.dev/v4?id=100x-reduction-in-tsc-instantiations)). **Refinement:** repo already on Zod v4; `@hono/zod-openapi` deferral (issue #1177) remains separate from `@hono/zod-validator` — orchestrator finding is correct: validator migration is feasible now.

### pnpm monorepo CI

- **Gate parity:** Root `pnpm check` runs `typecheck:tests` — CI must match ([`package.json`](../../../package.json) L17–23).
- **E2E build:** `build:e2e` inlines demo proxy env; Playwright config documents build-time inlining ([`playwright.config.ts`](../../../playwright.config.ts) L43–44). **Refinement:** CI E2E job must call `pnpm build:e2e`, not `pnpm build`.
- **Frozen lockfile + corepack:** Already correct in workflows; Windows devs prepend corepack-shims per AGENTS.md.

### Playwright — visual regression & a11y

- **Cross-platform baselines:** Playwright docs warn screenshots differ by OS ([snapshots docs](https://github.com/microsoft/playwright/blob/main/docs/src/test-snapshots-js.md)). **Refinement:** generate/commit baselines inside `mcr.microsoft.com/playwright` (same as CI) OR add `-linux` project-only visual job; mask dynamic regions with `[data-visual-mask]` (already project convention).
- **A11y:** `@axe-core/playwright` with WCAG tags — fix contrast at token layer (Phase 0 pivot approach), never `disableRules`.
- **Visual update discipline:** Review every diff image before `--update-snapshots` (AGENTS.md) — encode in Phase 4 CI artifact upload.

### Azure App Service — deploy, RBAC, Managed Identity

- **User Delegation SAS:** Requires **Storage Blob Delegator** at account scope + **Storage Blob Data Contributor** at container scope ([Microsoft Learn](https://learn.microsoft.com/en-us/rest/api/storageservices/create-user-delegation-sas)). Matches `services/api/src/blob.ts` + Bicep intent. **Refinement:** follow [`DEPLOY_UNBLOCK.md`](../../DEPLOY_UNBLOCK.md) Option 1 (declarative) when Owner grants constrained RBAC Administrator to deploy SP.
- **Managed Identity:** `DefaultAzureCredential` in API for SAS minting — already project pattern; preview **user-bound delegation SAS** can restrict token to Entra identity ([Azure Storage blog 2025](https://techcommunity.microsoft.com/blog/azurestorageblog/public-preview-restrict-usage-of-user-delegation-sas-to-an-entra-id-identity/4497196)) — evaluate for read SAS hardening in Phase 6, not blocking.
- **Deploy secrets:** Wire `ADVISOR_TOOL_APPROVAL_SECRET`, `SUPABASE_JWKS_URL`, `ACCOUNTING_CORS_ORIGINS` through Bicep → App Service settings; fail deploy if `normal` mode + demo secret detected.

### Postgres RLS

- **Multi-tenant pattern:** `workspace_id` on all ledger tables + RLS policies using JWT claims; `FORCE ROW LEVEL SECURITY`; wrap `auth.uid()`/`auth.jwt()` in `(SELECT …)` for initPlan ([Supabase RLS production patterns](https://wonsukchoi.co/en/blog/supabase-rls-production-patterns)). **Refinement:** jpx uses **direct postgres-js**, not PostgREST — RLS policies should key off `current_setting('app.workspace_id')` set in transaction preamble from verified JWT, not Supabase `auth.uid()` alone.
- **CI assertion:** add migration check that no `ledger.*` table has `rowsecurity = false` when RLS phase lands ([promptstoproduct RLS guide](https://www.promptstoproduct.com/how-to-set-up-supabase-rls-for-multi-tenant-saas)).
- **Scope:** defense-in-depth; application store already scopes by workspace — RLS catches connection-string leaks.

---

## Proposed phases 0–6

### Phase 0 — Deploy unblock & CI truth

**Goals:** Production blob SAS works; CI matches local gate; deploy waits for green CI.

**Tasks:**

- [ ] **0.1** Johan: complete [`DEPLOY_UNBLOCK.md`](../../DEPLOY_UNBLOCK.md) Option 1 or 2; verify `/api/uploads/init` 200 in Azure `normal`.
- [x] **0.2** Add Bicep/App Service params: `advisorToolApprovalSecret`, `supabaseJwksUrl`, `accountingCorsOrigins`, `supabasePoolerTransactionMode` — reject deploy when `runtimeMode=normal` and the secret equals the demo default. **Also override `storageCorsAllowedOrigins`** with the real web origin (currently localhost-only, `main.bicep:86-87`) or prod uploads fail CORS preflight even after 0.1 (§A N1).
- [x] **0.3** Fix `apps/web/Dockerfile`: build arg `NEXT_PUBLIC_ACCOUNTING_RUNTIME_MODE=normal` for production; document demo vs prod image tags in CONTRIBUTING.
- [x] **0.4** CI: add `pnpm typecheck:tests` to check job; E2E job uses `pnpm build:e2e`.
- [x] **0.5** Deploy workflow: `needs:` CI success (workflow_run or merge queue) before deploy job on `main`.
- [x] **0.6** Document `0004_compliance_and_settings.sql` in `docs/CONTRIBUTING.md` migration table **and** fix the stale `# migrations 0001–0003 applied` psql comment at `CONTRIBUTING.md:100` (§A N3).
- [x] **0.7** Deploy safety: assert `/ready` returns `ready===true` (not shape-only) in the smoke step (`deploy.yml:186-200`); reconsider `failOnStdErr: false` on `arm-deploy` (`deploy.yml:133`) so Bicep errors fail the job (§A C1, N2).

**Files:** `infra/azure/main.bicep`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `apps/web/Dockerfile`, `docs/CONTRIBUTING.md`, `docs/DEPLOY_UNBLOCK.md`

**Dependencies:** Azure Owner action for RBAC (0.1)

**Risk:** Low for CI edits; Medium for deploy gate (may slow hotfixes)

**DoD:** `CHECK` green; CI ≡ local gate steps; Azure capture upload succeeds in `normal`; deploy blocked on red CI

**Verification:**

```bash
pnpm check
pnpm build:e2e && npx playwright test --grep-invert "visual:"
# Azure: curl POST /api/uploads/init with auth → 200
```

---

### Phase 1 — Security & auth attribution

**Goals:** Fail closed on tool approvals; JWT binds identity; no client actor spoofing in `normal`.

**Tasks:**

- [x] **1.1** `services/api/src/config.ts`: in `normal` mode, throw at startup if `ADVISOR_TOOL_APPROVAL_SECRET` is the demo default (`config.ts:48`) or missing — the fallback at `config.ts:99` has no mode guard. **This is the real fix for the "demo approval forgery" Critical** (§A C8): a known HMAC secret lets an attacker forge signed approvals in the streamText path (`chat.ts:415-416`).
- [x] **1.2** Advisor chat: the demo replay path (`chat.ts:354-375`) skips HMAC by design and is low-risk on its own (demo store = Memory, no privilege beyond the queue button) — **do not** bolt HMAC onto the demo replay (§A C8). Instead add a **normal-mode** test that an unsigned/wrong-secret approval is rejected, and log `experimental_toolApprovalSecret` as an unstable-API risk (§A N7).
- [ ] **1.3** When `SUPABASE_JWKS_URL` set: require JWT on mutating `/api/*`; extract `sub` → server `actorId`; ignore client-supplied `actorId` in `normal`. **Extend the guard to read routes** — the `jwk` middleware filters to POST/PUT/PATCH/DELETE (`app.ts:303-305`), so `/api/workspace`, `/api/reports/*`, `/api/integrity`, `/api/evidence/:id`, `/api/settings/*` leak the full snapshot with no token (§A N4). **Make `alg` env-configurable** — it is hardcoded `["RS256"]` (`app.ts:301`), which rejects Supabase's ES256 default keys and would `401` all users when enabled (§A N5).
- [ ] **1.4** Contracts: mark `actorId` in mutation bodies `@deprecated` for normal mode (`contracts/index.ts:423,449,456,478,490,495`); document server override. Include the **SIE-import query-param sink** `?actorId=` (`app.ts:585`), which bypasses even the Zod body schema (§A N6). Note: Postgres org/workspace scope is already server-fixed (`runtime.ts:180`), so the live spoof surface is `actorId` attribution, not tenant selection.
- [ ] **1.5** ~~CORS: enforce `ACCOUNTING_CORS_ORIGINS` in `normal` (`app.ts`)~~ — **already implemented** (`config.ts:55-66`, `app.ts:209-222`); this app-code task is a **no-op** (§A C3). Real work moved to Phase 0.2 (wire the env var + `storageCorsAllowedOrigins` through Bicep/deploy).
- [ ] **1.6** Unit tests: **normal-mode** forged/unsigned approval rejected (§A N7); missing JWT → 401 on both mutating **and** read routes (§A N4); spoofed `actorId` (body **and** `?actorId=` query) ignored; ES256 token accepted once `alg` is configurable (§A N5).

**Files:** `services/api/src/config.ts`, `services/api/src/advisor/chat.ts`, `services/api/src/app.ts`, `services/api/src/runtime.ts`, `packages/contracts/src/index.ts`, `tests/unit/api-runtime.test.ts`, `tests/e2e/api.spec.ts`

**Dependencies:** Phase 0 secrets wired (0.2)

**Risk:** Medium — E2E/demo must keep explicit demo actor constant

**DoD:** No demo secret in `normal`; HMAC required for tool execution; JWT `sub` drives audit trail

**Verification:**

```bash
pnpm test:unit -- tests/unit/api-runtime.test.ts
pnpm build:e2e && npx playwright test tests/e2e/api.spec.ts
```

---

### Phase 2 — Store parity & domain correctness

**Goals:** Memory and Postgres behavior-identical on snapshot, compose, review.

**Tasks:**

- [x] **2.1** Fix `composeEvidence` voucher relink — a **net-new** shared helper (no shared impl exists today). Postgres (`persistence/store.ts:616-653`) never repoints `vouchers.evidence_packet_id` to the new packet, so `getEvidenceContext` (newest packet) and `getSnapshot` (stale voucher link) disagree **within Postgres** (§A N9); Memory relinks (`domain/store.ts:604-621`). The helper/test must converge both read paths and pin the exact `EvidencePacket` shape incl. optional `note`/`voiceTranscript` keys (§A N10). Relink is a read-model UPDATE inside the existing `begin()` — no hash-chain event, no tail lock.
- [x] **2.2** Postgres `getSnapshot()` (`persistence/store.ts:1089` `assistantExamples:[]`, `:1091` `alerts:[]`): source `alerts` from the existing `ledger.compliance_alerts` table (already read by `refreshComplianceAlerts`, `store.ts:1420-1483`). `assistantExamples` has **no** Postgres table yet — decide persist-vs-keep-empty (contract decision), don't silently diverge.
- [x] **2.3** Memory `applyReviewDecision` (`domain/store.ts:855-934`, mutations at L881-883, L900): clone-before-mutate per Rule 17 (copy the pattern already at `updateEvidenceExtraction` L683-685). **Also** fix `getSnapshot` returning `this.assistantExamples`/`this.alerts` by reference (`domain/store.ts:834,836`) — `answerAssistantQuestion` then `unshift`s into that shared array, mutating a previously-returned snapshot (§A N8).
- [x] **2.4** Consolidate `buildExcerpt()` — the two impls are **divergent** (query-centered `retrieval.ts:135` vs start-anchored `knowledge.ts:110`), so unifying **changes** pgvector excerpt output. Put the shared util in `packages/advisor` or `reporting` (**not** `packages/domain` — breaks advisor's isomorphic-pure seam), unify the signature to take optional query tokens, and add an excerpt-parity test **before** merging behaviors (§A C7).
- [x] **2.5** `reviewDecisionSchema` (`contracts/index.ts:21`) is dead **and** divergent: 5 values but only 3 (`approve`/`reject`/`book-without-vat`) have routes (`app.ts:572-576`); `request-more-evidence`/`split-posting` are unplumbed. **Lean delete/trim to 3** — wiring the 5-value enum implies store support that doesn't exist (§A N13).
- [x] **2.6** Integration tests for 2.1–2.2 in `tests/integration/postgres-ledger.test.ts` (2.3 covered by Memory unit tests in Batch C).
- [x] **2.7** (consolidation) Extract the verbatim-duplicated evidence→packet→voucher join into `resolvePacketAndVoucher(runner, evidenceId)` accepting client-or-tx (`persistence/store.ts:674-689` ≡ `:740-755`) (§A N11).
- [x] **2.8** (parity) `getReviewFeed` orders by `id DESC` (lexical, random-suffixed ids) → change to `ORDER BY created_at DESC, id DESC` to match Memory insertion order (`persistence/store.ts:988`) (§A N12).

**Files:** `packages/domain/src/store.ts`, `packages/persistence-postgres/src/store.ts`, `packages/domain/src/evidence-defaults.ts` (or new `excerpt.ts`), `packages/advisor/src/retrieval.ts`, `packages/persistence-postgres/src/knowledge.ts`, `packages/contracts/src/index.ts`, `tests/integration/postgres-ledger.test.ts`, `tests/unit/ledger-store.test.ts`

**Dependencies:** `SUPABASE_DB_URL` for integration proof

**Risk:** Medium — schema reads touch hot paths

**DoD:** Store parity tests green; integration covers new columns/paths; Rule 17 regression test for Memory singleton

**Verification:**

```bash
pnpm test:unit -- tests/unit/ledger-store.test.ts
SUPABASE_DB_URL=... pnpm test:integration
```

---

### Phase 3 — API validation migration

**Goals:** Replace `parseBody` with `@hono/zod-validator` without changing 400 shape.

**Tasks:**

- [x] **3.1** Add `@hono/zod-validator` exact pin; create `validationErrorHook` returning `{ code: "validation_error", issues }`.
- [x] **3.2** Migrate routes incrementally in `services/api/src/app.ts` — start with read-only/low-traffic POSTs.
- [x] **3.3** Parity tests: every migrated route keeps `tests/unit/api-runtime.test.ts` assertions green.
- [x] **3.4** Add `refreshComplianceAlerts()` to `packages/api-client/src/index.ts` wrapping `POST /api/compliance-watch/refresh` (`app.ts:630`, supports `?includeResolved=true`). The route is **dead end-to-end** — pair the client method with a web consumer (the UI itself lands in 4.1), else alerts still never surface (§A N15).
- [x] **3.5** Honest close-run — both stores return a hardcoded checklist (`domain/store.ts:1031-1042`, `persistence/store.ts:1377-1388`) that `close-view.tsx:38` renders **unmasked** via `.map` (no empty state), and `GET /api/close-runs/:id` echoes it for any id (`app.ts:623-628`). Add an empty/disabled state to `close-view.tsx` **and** fix the store + `:id` route (§A C2, N14) — the fake data currently reaches the user.

**Files:** `services/api/src/app.ts`, `services/api/src/validation.ts` (new), `packages/api-client/src/index.ts`, `tests/unit/api-runtime.test.ts`, `packages/contracts/src/index.ts`

**Dependencies:** Phase 2 contract stability

**Risk:** Low if parity-tested per route

**DoD:** Zero `parseBody` call sites; all validation via zValidator; api-client exposes compliance refresh

**Verification:**

```bash
pnpm test:unit -- tests/unit/api-runtime.test.ts
pnpm check
```

---

### Phase 4 — Frontend surfaces & test hygiene

**Goals:** Wire compliance/simulation UI; fix i18n; stabilize visuals.

**Tasks:**

- [x] **4.1** Compliance alerts UI (DEV_STATUS P1): list from `refreshComplianceAlerts`, severity chips, `targetId` deep-links, system sentinel rendering (Rules 20, 26).
- [x] **4.2** Simulation preview modal on review queue: multi-select → `apiClient.runSimulation` → delta table; 404 vs 5xx handling (P1/P2).
- [x] **4.3** Settings i18n: `en.json`/`sv.json` are already at exact parity (625 keys) — this is **not** a parity gap (§A C4). Create new `settings.company/about/sidebar` namespaces in **both** catalogs and refactor the 3 hardcoded-English components (`company-form`, `settings-about-screen`, `settings-sidebar`) to consume them. `company-form` is larger than "surgical" — it hardcodes country/locale/currency/month label maps (§A N16). **One agent owns i18n per batch.**
- [x] **4.4** In `settings-about-screen.tsx` (`L107-124`, 5 `ComingSoon` cards), replace only the **3 stale** ones with links: Workspace→company+fiscal-year, Integrations→integrations, Team→team. **Keep Profile + Billing** as honest placeholders — they are genuinely unbuilt (§C). While here, replace the `toISOString().slice(0,10)` UTC `dateTime` attr (`L70`) with the shared `localTodayIso` (§A N18).
- [x] **4.5** Dedupe `localTodayIso()` — **5** identical private copies, not 4 (§A C5): `export` the one at `domain/reports/period.ts:97`, then replace `domain/tax/calendar.ts:72` (missed by the original plan), `fiscal-year-form.tsx:18`, `tax-timeline-row.tsx:15`, `use-dashboard-data.ts:33`. ✅ Domain portion (`period.ts` export + `calendar.ts` import)
- [x] **4.6** Visual mask audit — the only real gap is `tax-timeline-row.tsx` (today-relative deadlines on screenshotted `/reports`, unmasked); journal renders no hashes and its date + activity dates are already masked (§A C6). Separately, decide whether the 7 newly-real settings pages need visual baselines (only `settings-company` is screenshotted today) or document why not (§A N17).
- [ ] **4.7** Visual CI: run visual job in Playwright Docker image; document baseline workflow in plan footer.

**Files:** `apps/web/components/settings/*`, `apps/web/components/today/review-queue-view.tsx`, `apps/web/messages/en.json`, `apps/web/messages/sv.json`, `packages/domain/src/reports/period.ts`, `tests/e2e/visual-regression.spec.ts`, `.github/workflows/ci.yml`

**Dependencies:** Phase 3 api-client method (4.1)

**Risk:** Medium for i18n (touch both catalogs)

**DoD:** Compliance + simulation E2E specs; i18n grep gate; visual baselines stable on Linux

**Verification:**

```bash
pnpm test:e2e:visual
pnpm build:e2e && npx playwright test tests/e2e/review-queue.spec.ts
# i18n: verify key parity en/sv
```

---

### Phase 5 — Postgres RLS & integration CI

**Goals:** Database-enforced workspace isolation; integration tests in CI.

**Tasks:**

- [ ] **5.1** Migration `0005_rls.sql` (idempotent): enable + force RLS on `ledger.*` tables; policies keyed on `current_setting('app.workspace_id')` (**not** Supabase `auth.uid()` — jpx writes via direct `postgres-js`). First reconcile/supersede the stale `2026-05-19-supabase-hardening.md`, whose PostgREST-oriented policies must not be copied verbatim (§A N19).
- [ ] **5.2** `PostgresLedgerStore`: set `app.workspace_id` in `sql.begin()` preamble from verified JWT context.
- [ ] **5.3** CI job: `integration` with `SUPABASE_DB_URL` secret (fork PRs skip); reuse `tests/integration/postgres-ledger.test.ts`.
- [ ] **5.4** Script/CI check: fail if any tenant table has `rowsecurity = false`.
- [ ] **5.5** Document RLS assumptions in `docs/CONVENTIONS.md` (new rule 29) **and** pair it with a cross-workspace read-isolation integration test — a doc-only rule has no teeth while DB isolation is absent (§A N20).

**Files:** `infra/supabase/migrations/0005_rls.sql`, `packages/persistence-postgres/src/store.ts`, `.github/workflows/ci.yml`, `tests/integration/postgres-ledger.test.ts`, `docs/CONVENTIONS.md`

**Dependencies:** Phase 1 JWT identity (1.3); Phase 2 store parity

**Risk:** High — incorrect policy can block all writes; test on Supabase branch first

**DoD:** Integration green in CI; manual RLS negative test (wrong workspace → 0 rows)

**Verification:**

```bash
SUPABASE_DB_URL=... pnpm test:integration
# SQL: SET app.workspace_id = 'wrong'; SELECT → empty
```

---

### Phase 6 — Polish, grep CI, docs truth

**Goals:** Optional CSP nonce; CI grep gates; documentation matches reality.

**Tasks:**

- [ ] **6.1** CSP nonce via Next.js Proxy (optional): `apps/web/proxy.ts` + layout nonce propagation; re-run visual E2E.
- [ ] **6.2** CI grep gates: fail on `@dnd-kit` outside `sortable-grid.tsx`, `ai`/`@ai-sdk` outside advisor dirs, recharts outside lazy barrel.
- [ ] **6.3** Axe sweep on `/settings/*`, `/reports` — token-level contrast fixes only.
- [x] **6.4** Update `CLAUDE.md`, `DEV_STATUS.md`, Phase 8 plan stub counts (→ **"0 header-only settings stubs remain"**; all 8 sub-pages render real components, §C), `CONTRIBUTING.md` env matrix.
- [ ] **6.5** Evaluate user-bound delegation SAS for evidence read URLs (Azure preview) — spike doc only if not implementing.

**Files:** `apps/web/next.config.ts`, `apps/web/proxy.ts`, `.github/workflows/ci.yml`, `eslint.config.mjs` or `scripts/check-seams.sh`, `CLAUDE.md`, `docs/DEV_STATUS.md`

**Dependencies:** Phases 0–5 complete

**Risk:** Low–medium (CSP can break inline scripts)

**DoD:** `CHECK` + full E2E + visual; grep CI green; docs accurate

**Verification:**

```bash
pnpm check
pnpm test:e2e:visual
pnpm build:e2e && npx playwright test
```

---

## Parallelization map (multi-agent execution)

Per [`AGENTS.md`](../../../AGENTS.md): disjoint file ownership; at most **one agent per batch** touches `messages/*.json`; subagents never build/commit; orchestrator runs verification.

| Batch | Agent scope       | Owns                                                                                                            | Blocked by        |
| ----- | ----------------- | --------------------------------------------------------------------------------------------------------------- | ----------------- |
| **A** | Infra             | `.github/workflows/*`, `infra/azure/*`, `apps/web/Dockerfile`, `docs/DEPLOY_UNBLOCK.md`, `docs/CONTRIBUTING.md` | —                 |
| **B** | API security      | `services/api/src/config.ts`, `services/api/src/advisor/*`, JWT middleware in `app.ts`                          | A.2 secrets       |
| **C** | Domain parity     | `packages/domain/src/store.ts`, shared helpers, `tests/unit/ledger-store.test.ts`                               | —                 |
| **D** | Postgres store    | `packages/persistence-postgres/src/store.ts`, `tests/integration/*`                                             | C helpers         |
| **E** | API validation    | `services/api/src/app.ts`, `validation.ts`, `tests/unit/api-runtime.test.ts`                                    | C contracts       |
| **F** | api-client        | `packages/api-client/src/index.ts`                                                                              | E.4               |
| **G** | i18n (solo)       | `apps/web/messages/en.json`, `apps/web/messages/sv.json`, settings screens                                      | —                 |
| **H** | Compliance/sim UI | `apps/web/components/settings/compliance-*`, review queue simulation modal                                      | F client          |
| **I** | Visual/a11y       | `data-visual-mask` attrs, `tests/e2e/visual-regression.spec.ts`, axe fixes                                      | G if same screens |
| **J** | RLS migration     | `infra/supabase/migrations/0005_rls.sql`, store preamble                                                        | B JWT + D parity  |

**Merge order:** A → B → (C ∥ D) → E → F → G → H → I → J → orchestrator `pnpm check` + E2E + visual review.

---

## Quick wins (<1 day)

| Win                                         | Files                                                                                     | Command                |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------- |
| Add `typecheck:tests` to CI                 | `.github/workflows/ci.yml`                                                                | `pnpm typecheck:tests` |
| E2E job uses `build:e2e`                    | `.github/workflows/ci.yml`                                                                | `pnpm build:e2e`       |
| Fail `normal` startup on demo HMAC          | `services/api/src/config.ts`                                                              | unit test              |
| Document migration 0004                     | `docs/CONTRIBUTING.md`                                                                    | doc only               |
| Export `localTodayIso` from domain          | `period.ts` (add `export`) + `domain/tax/calendar.ts` + 3 web files (**5 copies**, §A C5) | `pnpm typecheck`       |
| Add `refreshComplianceAlerts` to api-client | `packages/api-client/src/index.ts`                                                        | `pnpm typecheck`       |
| CI grep script (read-only first)            | `scripts/check-seams.sh`                                                                  | run in CI              |

---

## Deferred / out of scope

| Item                                          | Reason                                                                                  | Doc ref                        |
| --------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------ |
| Server Actions for ledger posting             | Violates review gate + Hono API boundary                                                | AGENTS.md invariant 2          |
| `useOptimistic` for approvals                 | AI suggests, never mutates; optimistic UI lies about posted state                       | AGENTS.md invariant 2          |
| `@hono/zod-openapi` / Phase E.4               | Zod v4 incompatibility issue #1177                                                      | CLAUDE.md deferred             |
| Payload hash recomputation                    | jsonb key order not byte-stable                                                         | DEV_STATUS Phase 5 limitations |
| Incremental projection writes                 | Strategy B sufficient until latency demands                                             | CLAUDE.md                      |
| Settings header-only stubs                    | All 8 sub-pages now real (advisory pivot); Profile/Billing cards on About still unbuilt | Phase 8 plan (Books sim tab)   |
| Peppol / bank feeds / multi-user auth product | Out of advisory pivot scope                                                             | pivot spec                     |
| Blind visual snapshot update                  | Requires human diff review                                                              | AGENTS.md                      |
| Postgres RLS before JWT identity              | Policies need trustworthy workspace context                                             | Phase 5 depends Phase 1        |

---

## Appendix: swarm agent scope index

| Agent ID    | Scope          | Primary themes                                                                                                                                     |
| ----------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aa0416e1`  | Infra & CI     | Storage RBAC, Docker demo bake, deploy secrets, CI/build:e2e, integration absent, visual platform drift, deploy/CI decoupling, migration doc drift |
| `45f7236e`  | Best practices | Stack alignment July 2026, parseBody defer, CSP nonce optional, axe deferred, integration local-only, anti-patterns list                           |
| `53cd2536a` | Backend API    | Demo approval forgery, JWT presence-only, actorId spoofing, demo HMAC in normal, rate limit/CORS, proxy streaming OK                               |
| `f13526ac`  | Frontend       | Grep gates not CI, settings i18n, About ComingSoon stale, visual-mask gaps, localTodayIso triplication, settings stub doc outdated                 |
| `0b833c1a`  | Domain         | composeEvidence drift, getSnapshot omissions, Memory mutation, reviewDecisionSchema drift, buildExcerpt dup                                        |
| `01b56b39`  | Orchestrator   | No RLS, compliance UI gap, simulation UI gap, api-client gap, getCloseRun stub, parseBody→zValidator feasible                                      |

---

## Self-review (2026-07-05 write time)

- **Invariant check:** no task bypasses review gate, rewrites history, or skips store parity. ✔
- **Swarm coverage:** all six agent themes appear in Critical/High tables and phases 0–6. ✔
- **Research:** Context7 Next 16 / Hono zValidator / Zod v4 + web Azure SAS / RLS / Playwright cited in enrichments. ✔
- **Actionability:** each phase has files, DoD, verification commands. ✔
- **Conflicts resolved:** parseBody migration deferred to Phase 3 with parity tests; CSP nonce deferred to Phase 6; RLS deferred to Phase 5 after JWT. ✔
- **Source verification (2026-07-05):** all ~38 codebase claims forensically re-derived from source by a 7-agent workflow — 8 corrected (1 refuted, 7 partial) + 20 findings added in the "Verification pass" section; §A overrides conflicting task text. ✔

---

## Visual baseline decision (Phase 4.6 footer, 2026-07-05)

**Tax timeline:** `data-visual-mask` added to due-date cells in `tax-timeline-row.tsx` only — the sole remaining clock-derived gap on the screenshotted `/reports` route (§A C6).

**Settings pages:** Visual regression continues to baseline **`settings-company` only** among the eight real settings sub-pages. The other seven (compliance, fiscal-year, integrations, retention, team, about, ai-posture) are intentionally excluded for now because: (1) most embed clock-derived or seed-derived values (integrity hashes, recent-event timestamps, actor rows) that would require broad masking before baselines stay stable; (2) compliance/alerts and simulation UI are refresh-driven and would churn baselines on every seed change; (3) expanding from 20 to 27 full-page baselines doubles review cost on every intentional UI pass. Revisit when settings chrome stabilizes or a dedicated masked subset (e.g. compliance integrity panel only) is scoped in Phase 4.7.

---

## Pre-merge review (2026-07-05)

Pre-merge review + simplification pass on branch `feat/full-improvement-sweep` (uncommitted working tree; no commits ahead of `main` yet).

### Inventory

**47 touched paths** (40 modified + 7 new): infra/CI (`ci.yml`, `deploy.yml`, `main.bicep`, `Dockerfile`), API (`app.ts`, `config.ts`, `validation.ts`, `advisor/chat.ts`), domain/postgres stores, contracts, advisor excerpt consolidation, api-client, web settings/compliance/simulation UI, i18n (+134 keys → **759 en/sv parity**), tests (unit/integration/E2E), docs (`CLAUDE.md`, `DEV_STATUS.md`, `CONTRIBUTING.md`, plan itself), `scripts/check-seams.sh`.

### Findings — keep

| Area                           | Verdict                                                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Append-only + review gate      | ✔ Simulation POST is audit-only; advisor tool approvals still HMAC-gated in normal mode with new unit tests                                                                     |
| Store parity (Phase 2)         | ✔ `composeEvidence` voucher relink, Postgres `getSnapshot` alerts, Memory Rule 17 clone-before-mutate, `resolvePacketAndVoucher` extract, `getReviewFeed` `created_at` ordering |
| Fail-closed normal HMAC        | ✔ `readApiRuntimeConfig` throws on missing/demo secret in normal mode                                                                                                           |
| zValidator migration (Phase 3) | ✔ `parseBody` fully replaced; `ApiValidationError` preserves `{ code, issues[] }` shape                                                                                         |
| Close-run honesty (Phase 3.5)  | ✔ Empty checklist + `UnavailableState` in UI; `GET /api/close-runs/:id` 404s on wrong id                                                                                        |
| Frontend Phase 4               | ✔ Compliance alerts panel, simulation preview modal, settings i18n namespaces, `localTodayIso` export, tax-timeline `data-visual-mask`                                          |
| CI truth (Phase 0)             | ✔ `typecheck:tests` + `build:e2e` in CI; deploy waits on CI; `/ready` asserts `ready===true`                                                                                    |
| Architectural seams            | ✔ `@dnd-kit` / `ai`/`@ai-sdk` / recharts grep gates pass (local ripgrep)                                                                                                        |
| i18n                           | ✔ 759/759 key parity (`pnpm check:i18n`)                                                                                                                                        |

### Findings — fix (applied in simplify pass)

| Issue                                                                | Fix                                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Dead `reviewDecisionSchema` export (Phase 2.5 trim left unused enum) | Removed from `packages/contracts/src/index.ts`                           |
| `react-hooks/exhaustive-deps` warning in `review-queue-view.tsx`     | Dependency array uses `simulationPreview` instead of `.mutate`           |
| Redundant Phase JSDoc on new UI components                           | Trimmed on `compliance-alerts-panel.tsx`, `simulation-preview-modal.tsx` |

### Findings — drop / defer (do not block merge)

| Item                                             | Notes                                                                                                    |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `.serena/project.yml`                            | IDE tooling drift — exclude from the sweep commit                                                        |
| Phase 1.3 JWT on read routes + ES256 alg         | Correctly **not** implemented; still deferred                                                            |
| Phase 5 RLS                                      | Correctly **not** started                                                                                |
| Phase 4.7 / 6.2 visual CI + grep gates in CI     | `check-seams.sh` added but not wired; script **false-passes on Windows** when `rg` is absent in Git Bash |
| Postgres `assistantExamples: []`                 | Documented contract decision until persist path lands                                                    |
| Azure blob SAS 403 + storage CORS localhost-only | Operational blockers per `DEPLOY_UNBLOCK.md` — infra, not code                                           |
| `tests/e2e/compliance-simulation.spec.ts`        | New spec exists; not in smoke run — apply `run-e2e` label before merge if UI regressions are a concern   |

### Verification

| Gate                          | Result                                                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                  | **Green** (227 unit tests; 1 pre-existing TanStack Table compiler warning unrelated to sweep)                                          |
| E2E smoke                     | **15 passed** — `api.spec.ts` (7 desktop) + `settings-company.spec.ts` (8 desktop+mobile); 7 mobile api tests skipped (project config) |
| `bash scripts/check-seams.sh` | Passed on repo grep tools; unreliable on Windows Git Bash without `rg`                                                                 |

### Remaining risks (merge with caveats)

1. **Production Azure capture** still blocked until Owner completes storage RBAC **and** Bicep CORS origin override (§A N1).
2. **Auth hardening incomplete** — read routes leak snapshot when JWKS is set but middleware is mutation-only (Phase 1.3).
3. **Integration tests** still local-only (`SUPABASE_DB_URL` not in CI).
4. **Full E2E + visual** not run in this pass — recommend `run-e2e` label + visual diff review before shipping user-facing compliance/simulation UI.

### Merge readiness

**Ready with caveats** — code gate green, invariants hold, deferred phases correctly scoped. Caveats: Azure ops blockers, auth Phase 1.3 open, full E2E/visual not exercised here.
