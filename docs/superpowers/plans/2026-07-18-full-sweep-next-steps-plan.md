# JPx Accounting — Full-Codebase Sweep Synthesis Plan

**Date:** 2026-07-18 · **Repo:** `c:/Git/accounting` (main project `jpx-accounting/`, knowledge vault `brain/`) · **Basis:** 10 dimension reviews + adversarial verification + synthesizer's own code reading (all criticals independently re-verified — see risk register)

---

## 1. Executive summary

JPx Accounting has completed its advisory pivot with unusual engineering discipline: the demo-mode product is real end-to-end (capture → OCR → review gate → hash-chained ledger → narrative reports → grounded AI advisor), backed by 235 unit tests, a hermetic ~104-execution E2E suite, and docs that mostly match code. But the production leg has never run: no deploy has succeeded since 2026-05-06, origin/main's Bicep template does not compile (`jpx-accounting/infra/azure/main.bicep:147-150` uses invalid `assert(...)` syntax — re-verified), the Postgres write path provably never executed against the checked-in migrations (`ledger.events.id` is `uuid` in `0001_init.sql:8` but the store inserts `evt_`-prefixed text ids — re-verified), and the four commits that fix the deploy pipeline sit unpushed on one laptop. On top of that, verified correctness defects in the accounting core (the "book without VAT" action posts permanently unbalanced entries into an append-only ledger; postings are dated by approval click, not receipt date) and an absent identity layer (every GET route is anonymous even in a fully configured production deployment; no client can present a JWT) separate the excellent pilot from a trustworthy product.

**The single most important thing to do next:** establish ground truth. Push and merge the stranded fixes, repair the Bicep breakage, fix the events.id migration, and stand up a CI job that provisions Postgres from the migrations and runs the existing integration suite — then achieve one green end-to-end deploy. Everything else in this plan sequences behind that.

---

## 2. Current-state scorecard

| Dimension             | Grade                   | Justification                                                                                                                                                                                                                                                                          |
| --------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain core           | **B**                   | Read side (period model, statements, tax calendar, observations) is near production quality; write side has a data-corrupting posting bug, decision-time booking dates, and a forgeable djb2 hash chain under a "verified ledger" badge.                                               |
| Persistence           | **C+**                  | Disciplined transactions and genuine store-parity culture, but the schema/code id-type drift proves the write path never ran on the checked-in migrations, and chain serialization is structurally fork-prone (stale-tail FOR UPDATE, no sequence column).                             |
| API service           | **B−**                  | Production-grade validation, error contract, SSE, and blob handling; identity/authorization is essentially absent by design (anonymous reads, discarded JWT payload, client-supplied actorId, fail-open runtime-mode config).                                                          |
| Testing & CI          | **B−**                  | Excellent unit tier and hermetic E2E; the integration tier is decorative (never runs in CI), visual regression is vacuous on ubuntu (win32-only baselines), and the security middleware is never behavior-tested.                                                                      |
| Security & compliance | **D+ (provisional)**    | The dedicated reviewer's output was corrupted placeholder data and is unusable; graded from cross-cutting evidence in other reviews: anonymous read surface, no tenant isolation, spoofable attribution, CSRF-open `/share`, zero observability. Re-run this dimension (Now item N10). |
| Deploy & infra        | **D**                   | Good bones (SHA-pinned actions, fail-closed secrets, UD-SAS, excellent DEPLOY_UNBLOCK runbook), but the pipeline has been dead 10+ weeks, the template on origin/main doesn't compile, and there is no rollback, telemetry, or alerting of any kind.                                   |
| Repo state & docs     | **B−**                  | Unusually rich, mostly maintained docs (DEV_STATUS, CONVENTIONS' 29 incident rules); drift concentrated in the always-loaded memory files (CLAUDE.md: 5 false claims), a 2-months-stale architecture.md, and 4 commits that exist on one disk only.                                    |
| Product & roadmap     | **B− exec / C product** | Pivot execution was honest and complete; the gap to a launchable product is identity, tenancy, the income half of accounting (purchase-only ledger, no revenue), SIE opening balances, and period close.                                                                               |
| Frontend / PWA        | **B**                   | Strong component-level discipline (one promotion pipeline, schema-versioned layouts, full i18n parity, conservative SW); production CSP contradicts the SAS architecture, cache invalidation is inconsistent, offline story is thinner than the PWA framing.                           |
| AI advisor pipeline   | **B−**                  | Clean pure-brain architecture with a genuinely enforced review-gate invariant; the normal-mode (production) leg is the weak half — no provenance streaming, no abort/cost envelope, no server-side proposal cross-check, an open prompt-injection path via OCR'd supplier names.       |

---

## 3. Verified risk register

**Tier 1 — Critical/high findings that are adversarially confirmed/adjusted, or re-verified by the synthesizer's own code reading during this synthesis (marked ✓synth).**

**R1 · CRITICAL · "Book without VAT" posts an unbalanced journal entry** — `jpx-accounting/packages/domain/src/store.ts:322-362` (✓synth: vatAmount forced to 0 at :324 while the debit stays `netAmount` at :335 and the credit stays gross `amount` at :358)

- Failure: every "Bokför utan moms" decision (first-class UI hotkey B + API action) writes an entry out of balance by exactly the VAT amount, in both stores, into an append-only ledger with no correction mechanism. The only test on the path checks the VAT line is zero, never that the entry balances.
- Fix: debit the full gross to the cost account when VAT is non-deductible (correct Swedish treatment); add an `assertBalanced(lines)` invariant called by every posting path, pinned by tests over all three review actions. Check demo-data pins for churn.
- Effort: **S**

**R2 · CRITICAL · `ledger.events.id` is uuid in migrations, text in code — every Postgres event append fails on a migrations-provisioned DB** — `jpx-accounting/infra/supabase/migrations/0001_init.sql:8` vs `jpx-accounting/packages/persistence-postgres/src/store.ts:378` (✓synth: both read directly)

- Failure: `createId("evt")` → `evt_<uuid>` text inserted into a `uuid` column → 22P02 on every mutation. Either the live DB silently drifted from the migration files, or the Postgres write path has never executed. The integration suite skips silently without `SUPABASE_DB_URL` and CI never sets it — this is how the drift survived.
- Fix: migration 0005 altering the column to text (reconciled against whatever the live DB actually has), then a full integration run against a fresh migrations-provisioned database.
- Effort: **S** (fix) — the CI job that keeps it fixed is R8.

**R3 · CRITICAL · Every read route bypasses the JWT gate — full financial data world-readable in production** — `jpx-accounting/services/api/src/app.ts:268-278` (CONFIRMED; ✓synth: gate only fires for POST/PUT/PATCH/DELETE)

- Failure: even with `SUPABASE_JWKS_URL` configured, GET `/api/workspace` (full snapshot incl. bank IBAN), all report routes, the full-ledger SIE export, and live read-SAS minting for receipt blobs are anonymous on a public App Service.
- Fix: extend the jwk middleware to all `/api/*` methods (keep `/health`, `/ready`, `/api/runtime-info` open) + Bicep assert requiring JWKS in normal mode. Caveat: no client can present a token yet (R12), so this makes normal mode unusable until the Auth MVP — acceptable because normal mode has never been live; see Now item N7 for the interim decision.
- Effort: **S**

**R4 · CRITICAL · `main.bicep` on origin/main does not compile — every future deploy dies at the ARM step** — `jpx-accounting/infra/azure/main.bicep:147-150` (✓synth: `assert(condition, message)` function-call syntax present; Bicep assertions are an experimental named-declaration feature, no `bicepconfig.json` exists) plus `:133` interpolates undefined `${SUPABASE_URL}` inside a description string, plus `:125` committed U+FFFD mojibake

- Failure: next deploy attempt fails at template compile regardless of everything else.
- Fix: replace the assert with a compiling fail-closed pattern; escape the description; fix the mojibake. Then add `az bicep build` to CI so this class can't merge again.
- Effort: **S**

**R5 · HIGH · No authorization beyond signature; verified identity discarded; actor attribution client-supplied** — `jpx-accounting/services/api/src/app.ts:559` and contracts (CONFIRMED)

- Failure: `jwtPayload` is never read; any Supabase-signed token mutates the single shared workspace; body `actorId` / `?actorId=` spoof the 7-year audit trail.
- Fix: consume `sub`/email from the verified token, thread as actor into every store call, delete client-supplied actorId from the wire contracts (re-application of the retired hardening-followups plan to the live API).
- Effort: **M**

**R6 · HIGH · Invalid `ACCOUNTING_RUNTIME_MODE` silently boots demo mode (fail-open)** — `jpx-accounting/services/api/src/config.ts:128-130` (ADJUSTED)

- Failure: a typo like "production" boots MemoryLedgerStore + wildcard CORS + demo secrets with the fail-closed checks skipped.
- Fix: throw on unknown mode, validate `SUPABASE_JWT_ALGS` against the union, reject NaN port; log resolved security posture at boot. Effort: **S**

**R7 · HIGH · JWKS fetched over the network on every mutating request; fetch failure → generic 500** — `jpx-accounting/services/api/src/app.ts:269` (ADJUSTED)

- Fix: pre-fetch/cache keys with TTL, map auth-infrastructure failures to 503. Effort: **S**

**R8 · HIGH · PostgresLedgerStore and pgvector knowledge path have zero CI coverage** — `jpx-accounting/tests/integration/postgres-ledger.test.ts:20-21`, `.github/workflows/ci.yml` (CONFIRMED)

- Failure: the most corruption-sensitive code (FOR-UPDATE hash chain, idempotent approvals) is tested only on manual local runs; R2 is the proof this fails.
- Fix: CI job with a pgvector Postgres service container, apply migrations 0001-000N, run `test:integration`; make pgaudit conditional. Effort: **M**

**R9 · HIGH · JWT gate, rate limiter, CORS never exercised by any request-level test** — `jpx-accounting/services/api/src/app.ts:238-278` (CONFIRMED)

- Fix: in-test key pair + stubbed JWKS fetch asserting 401/pass; 429 test with the bypass off; scope the instance-wide `ALLOW_TEST_RESET` limiter bypass (✓synth: confirmed at `:256-258`) to demo mode. Effort: **M**

**R10 · HIGH · No `timeout-minutes` on any CI job despite the documented intermittent E2E hang** — `.github/workflows/ci.yml` (ADJUSTED)

- Failure: a recurrence on a main push burns up to 6 runner-hours and silently starves the workflow_run-gated deploy (which is exactly what has happened since Jul 5).
- Fix: timeout-minutes on all jobs + `DEBUG=pw:webserver` on E2E so the next hang is diagnosable. Effort: **S**

**R11 · HIGH · Four commits exist on one disk only; origin/main still ships the broken deploy config** — verified via git during synthesis: local `main` (bdb66fd, CJS bundle + GHCR pull token) is 1 ahead of origin/main; `fix/verified-sweep-fixes` (3 commits: NEXT_PUBLIC_API_BASE_URL build-arg, deterministic review-feed order, SUPABASE_JWT_ALGS) has no upstream; idle 12 days

- Failure: any deploy or branch cut from origin runs the pre-fix pipeline; a disk failure loses the work.
- Fix: push main, publish + PR the fix branch (with the RS256→RS256+ES256 doc corrections in CLAUDE.md:167 / architecture.md:79), merge. Effort: **S**

**Tier 2 — High-severity findings grounded in reviewer code-reading but not adversarially verified (spot-checks during synthesis where noted). Treat as verified-enough to schedule; re-confirm in the implementing PR.**

| #   | Finding                                                                                                                                                                        | Where                                                                                                         | Fix / Effort                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| R12 | JWT gate has no client: no login UI, no Authorization header ever produced — enabling auth breaks all writes; leaving it off leaves production open-write                      | `apps/web`, `packages/api-client` (grep-verified by reviewer)                                                 | Auth MVP (WS-C) / **L**                                                                                        |
| R13 | Approval `bookedAt` = decision timestamp, not receipt/transaction date — wrong fiscal + VAT period                                                                             | `packages/domain/src/store.ts:889`                                                                            | Derive from transactionDate, user-confirmable / **M**                                                          |
| R14 | Hash chain is djb2 (32-bit, non-cryptographic) under a user-facing "verified ledger" trust chip                                                                                | `packages/domain/src/hash-chain.ts:1-9`                                                                       | SHA-256 over canonical JSON + chain-migration event / **M**                                                    |
| R15 | FOR UPDATE tail lock returns stale tail to blocked waiters (and locks nothing at GENESIS); intra-transaction events share identical sort keys — permanent chain fork possible  | `packages/persistence-postgres/src/store.ts:356-367` (✓synth: combined lock+read statement confirmed present) | `pg_advisory_xact_lock` + `seq bigint identity` + unique `(org, ws, previous_hash)` + concurrency test / **M** |
| R16 | No successful deploy since 2026-05-06 (34 consecutive failures/skips); deploy gate skips silently with no alerting                                                             | `.github/workflows/deploy.yml:59-61`                                                                          | One green deploy + failure notifications (WS-A) / **M**                                                        |
| R17 | Production CSP blocks direct-to-Azure SAS uploads and read-SAS previews — capture silently broken in deployed normal mode; no test tier can see it                             | `apps/web/next.config.ts:20`, `packages/api-client/src/index.ts:283`                                          | Env-driven storage-origin allowlist or same-origin proxy + deployed smoke / **M**                              |
| R18 | Ledger mutations leave derived report/book queries stale (inconsistent React Query invalidation)                                                                               | `apps/web/components/today/review-queue-view.tsx:106-124`                                                     | One shared `invalidateLedgerDerived()` / **S**                                                                 |
| R19 | Draft re-promotion races create duplicate evidence in an append-only ledger with no dedupe                                                                                     | `apps/web/lib/promotion.ts:124-192`                                                                           | Client in-flight registry + server sha256+size dedupe / **M**                                                  |
| R20 | Visual-regression net is vacuous on CI: all 20 baselines are `*-win32.png`, CI runs ubuntu, retries self-write baselines                                                       | `tests/e2e/visual-regression.spec.ts-snapshots`                                                               | Linux baselines via pinned Playwright container, or explicit CI skip / **M**                                   |
| R21 | Model-authored `proposeReviewAction` executes without cross-check against stored review/voucher; approval card renders display-only fields that can diverge from what executes | `services/api/src/advisor/chat.ts:404-414`                                                                    | Re-load store truth at execute; validate account/VAT against registries / **M**                                |
| R22 | Prompt-injection path: OCR'd supplier names flow undelimited into the system prompt                                                                                            | `services/api/src/advisor/chat.ts:293`, `packages/reporting/src/observations.ts:305`                          | Delimit/cap/filter untrusted fields + injection-resistance clause + hostile-name regression tests / **S**      |
| R23 | Provenance chips (the trust surface) never appear in normal mode — `data-provenance` parts are demo-only                                                                       | `services/api/src/advisor/chat.ts:420-429`                                                                    | `createUIMessageStream` wrapper emitting the same part / **S**                                                 |
| R24 | No revenue path: posting engine is purchase-only, no manual voucher entry                                                                                                      | `packages/domain/src/store.ts:315-364` (✓synth: single expense/VAT/bank pattern confirmed)                    | Later bet L1 / **L**                                                                                           |
| R25 | SIE import silently drops #IB/#UB/#RES — competitor migration yields a wrong balance sheet from day one                                                                        | `packages/domain/src/sie/parse.ts:1-10`                                                                       | Later bet L4 / **M**                                                                                           |
| R26 | No period locking/close — retroactive posting into declared VAT periods unrestricted                                                                                           | `packages/domain/src/store.ts:1050-1059`                                                                      | Later bet L2 / **L**                                                                                           |

Medium-severity confirmed findings (check:i18n missing from CI, tests/e2e untypechecked, ALLOW_TEST_RESET instance-wide bypass, unmapped pg errors, force-reopening compliance-alert upsert) are folded into the Now items and workstreams below.

---

## 4. Next steps — Now (this week)

**N1 · Push, merge, and clean the repo** — _Why:_ R11 is the highest operational risk (deploy fixes exist on one disk; origin runs broken config). _Scope:_ push local `main`; publish `fix/verified-sweep-fixes` with the two-line doc corrections (CLAUDE.md:167, docs/architecture.md:79 still claim RS256-only); PR + merge; delete `feat/advisory-pivot` locally and on origin (tree-verified identical to the PR #30 squash); delete `api-deploy-test/` (4.6 MB reproducible build artifact) and add `api-deploy*` to `.gitignore`; commit the `.serena/project.yml` schema migration; fix the DEV_STATUS.md U+FFFD mojibake (lines 115-121) and the self-contradicting extraction follow-up bullet (line 86 vs line 23); commit-or-push sweep of the `brain/` repo (unpushed branch + dirty note). _Effort:_ **S**. _Accept:_ `git status` clean in both repos; origin/main contains all 4 commits; `git branch -a` shows no feat/advisory-pivot.

**N2 · Fix `main.bicep` so it compiles** — _Why:_ R4 — every deploy is dead-on-arrival. _Scope:_ replace the `assert(...)` call with a compiling fail-closed pattern; escape `${SUPABASE_URL}` in the description at :133; fix the :125 mojibake; verify with `az bicep build --stdout`. _Effort:_ **S**. _Accept:_ template compiles clean with Bicep ≥0.44.

**N3 · Fix the book-without-vat posting bug + balance invariant** — _Why:_ R1 is the one confirmed data-corrupting bug; every day it stands, more permanently unbalanced entries can enter demo/live ledgers. _Scope:_ `buildPostingLines` debits gross when action is book-without-vat; add `assertBalanced()` to every posting path; regression tests asserting Σdebit = Σcredit for approve / book-without-vat / edited approvals in both stores; audit demo-pin churn. _Effort:_ **S**. _Accept:_ new unit tests green; a property-style test over all three actions cannot construct an unbalanced entry.

**N4 · Migration 0005 for `events.id` + local ground-truth integration run** — _Why:_ R2 — nothing about Postgres persistence can be trusted until the suite runs green on a migrations-provisioned DB. _Scope:_ alter `ledger.events.id` to text (reconcile against the live Supabase DB's actual state first); run `pnpm test:integration` against a fresh DB built from 0001-0005; record results in the PR per CONVENTIONS Rule 1/2/14. _Effort:_ **S**. _Accept:_ all 14 integration scenarios green on a from-scratch database.

**N5 · Fail-closed config at boot** — _Why:_ R6 — a typo currently downgrades production to demo silently. _Scope:_ throw on unknown `ACCOUNTING_RUNTIME_MODE`; validate `SUPABASE_JWT_ALGS` members; reject NaN `PORT`; one structured boot log line stating resolved posture (mode, store kind, auth on/off, CORS). _Effort:_ **S**. _Accept:_ unit tests pin the throw; boot log visible in App Service log stream.

**N6 · CI quick wins** — _Why:_ R10 + confirmed medium gaps make CI green untrustworthy. _Scope:_ `timeout-minutes` on all jobs; `DEBUG=pw:webserver` on the E2E job; add `check:i18n` to ci.yml (or make the check job literally run `pnpm check` minus build); extend `tests/tsconfig.json` (or sibling e2e tsconfig) to typecheck the 2,260-line `tests/e2e/` tree. _Effort:_ **S**. _Accept:_ a planted missing sv key fails CI; `pnpm typecheck:tests` covers e2e specs; no job can run >30 min.

**N7 · Access-control decision + read-route gate** — _Why:_ R3. _Scope:_ extend the JWT middleware to all `/api/*` methods; Bicep assert + boot fail-close requiring `SUPABASE_JWKS_URL` in normal mode; JWKS key caching with 503 mapping (R7). _Decision to record:_ until the Auth MVP client lands (WS-C), normal mode is deliberately unusable-by-anonymous — acceptable since no deploy has ever served normal mode; demo mode is unaffected. _Effort:_ **S**. _Accept:_ request-level test proves GET `/api/workspace` 401s without a token when JWKS configured; `/health`, `/ready`, `/api/runtime-info` stay open.

**N8 · Frontend quick wins** — _Why:_ R18 undermines the trust pitch (post → stale journal for 60s); `/share` and the proxy are cheap hardening independent of auth. _Scope:_ one `invalidateLedgerDerived(queryClient)` helper called from all five mutation paths; Sec-Fetch-Site/Origin check + body cap on `/share`; content-length cap + `/api` prefix restriction on `app/api-proxy/[...path]/route.ts`. _Effort:_ **S**. _Accept:_ E2E asserts journal reflects an approval without manual refresh; cross-origin form POST to /share rejected.

**N9 · Truth-pass the agent memory docs** — _Why:_ five verifiably false claims in CLAUDE.md (server.mjs vs server.cjs, RS256-only, "28 rules", "Real OCR still pending", stale phase/branch status) and AGENTS.md's "x12 workspaces" are injected into every future agent session. _Scope:_ mechanical corrections; move PLAN.md, PLAN1.md, both deep-research reports (and evaluate compliance-playbook.md) into `docs/archive/` with status headers; resolve the dangling ADR DL-001/002 citations (inline a summary or mark the ledger as external — the repo is public, the brain repo is not). _Effort:_ **S**. _Accept:_ every corrected claim greppable-true against code; docs/ top level contains no unlabeled superseded plans.

**N10 · Re-run the security-compliance review dimension** — _Why:_ its reviewer output in this sweep was corrupted placeholder data; the D+ grade above is inferred from other dimensions. _Scope:_ a focused security review of services/api + web edge + storage posture once N7 lands, so it reviews the post-fix state. _Effort:_ **S** (scheduling).

---

## 5. Next steps — Next (2–6 weeks)

Five workstreams, sequenced. WS-A is the spine; B/D depend on its CI job; C is parallel.

### WS-A · Prove production (deploy, CI-as-gate, observability)

_Goal: one green end-to-end deploy, and CI that would have caught every production-only failure seen so far._ Depends on N1/N2/N4.

1. `az bicep build` on every PR touching `infra/` + `az deployment group validate`/what-if in the deploy job (also surfaces the appSettings-wipe behavior). **S**
2. Pin esbuild as a devDependency behind a `pnpm bundle:api` script shared by CI/local; boot-smoke the produced `server.cjs` (demo env, curl `/health`) in the deploy build job — the exact class that caused the last crash-loop. **S**
3. CI integration job (R8): pgvector Postgres service container, apply migrations, run `test:integration`; turn the silent `SUPABASE_DB_URL` skip into a hard CI requirement. **M**
4. Unwedge the main-branch E2E hang (or add an explicit gate override), run the deploy, execute DEPLOY_UNBLOCK.md Option 1 (storage RBAC grant) — one verified green deploy of the advisory-pivot product. **M**
5. Observability baseline: App Insights in Bicep + SDK wiring (API + web), `/ready` live `SELECT 1` probe (replaces the instanceof check), pg error-class mapping in `app.onError` (23505→409, class 08/57→503) with error codes in logs, postgres-js statement/lock/idle timeouts, availability test on `/ready`, and failure/skip notifications on both workflows (closes the "deploy skipped silently for 13 days" hole). **M**
6. Data durability: blob soft delete + versioning on the evidence container (statutory 7-year records currently on bare LRS); automate Supabase migrations in the pipeline with version tracking; rollback runbook + previous-SHA redeploy workflow_dispatch job; add `SUPABASE_JWT_ALGS` to Bicep and de-duplicate `WEB_ORIGIN`. **M**
7. Live normal-mode verification pass (DEV_STATUS open follow-up): capture → SAS upload → DocIntel OCR → review → post against real Postgres; advisor SSE via Azure OpenAI. Depends on WS-D item 1 (CSP fix) for the capture leg. **M**

### WS-B · Ledger integrity & Swedish correctness (domain + persistence)

_Goal: the write side and trust surfaces earn what the product already claims._ Depends on WS-A item 3 so every change is integration-proven.

1. Booking dates (R13): derive `bookedAt` from transactionDate/receiptDate, surfaced and editable in the review edit sheet; finish the local-vs-UTC story on the write path (`nowIso`/`digestDate`) that the period model's own docs ban for reads. **M**
2. Hash chain (R14): SHA-256 via node:crypto over canonical (sorted-key) JSON + chain-migration event; this also unblocks the documented payload-recomputation deferral, whose stated blocker was byte-stability. **M**
3. Chain serialization (R15): `pg_advisory_xact_lock` + separate tail read; `seq bigint generated always as identity` ordering; unique `(org, workspace, previous_hash)` making forks a retryable constraint violation; two-connection concurrency regression test. Batch `importSie` event inserts while in there (500 sequential round trips under the global lock today). **M**
4. VAT correctness: quarterly VAT on calendar quarters (statutory, not fiscal quarters) in `tax/calendar.ts:241` and the widget; box 05 attribution by line vatCode instead of template-account lookup; whole-krona rounding at the declaration boundary. **M**
5. Edited-approval validation: accountNumber against the CoA registry, vatCode against the regime vocabulary, server-resolved accountName (`packages/contracts/src/index.ts:461`, `domain/src/store.ts:94-134`). **S**
6. Event-vocabulary hygiene: dedicated event type for book-without-vat decisions (currently recorded as `ReviewRejected` + `PostedToLedger`); append an event for `composeEvidence` relinks (currently invisible to the chain); mark the 7 never-emitted eventType members as reserved. **S**
7. Store-parity fixes: compliance-alert upsert must preserve acknowledged/dismissed (CASE in the SET clause — fix before an acknowledge UI ships); `suggestVoucher` read-model divergence; tenant-scope the `knowledge.documents` PK while the table has one tenant. **S each**

- _Resolution of a reviewer conflict:_ the domain review says "no store can replay events" while persistence says reports ARE derived from event payloads. Both are right at different altitudes: `PostedToLedger`/`VoucherImported` payload lines are replayed for reports, but no path reconstructs full state (vouchers/reviews/evidence) from events. Full replay + replay-vs-read-model parity is deliberately deferred to Later (with L2), not scheduled here.

### WS-C · Identity & tenancy foundation (auth MVP)

_Goal: a named human behind every read and write._ Parallel to WS-A/B; unblocks R3's caveat and defuses R5/R12.

1. Supabase login/signup end-to-end: session management, Authorization header through the existing proxy (it already forwards headers), JWT always-on in normal mode. **L**
2. Server-derived actor (R5): consume `jwtPayload.sub`, delete client-supplied actorId from contracts in one atomic sweep (CONVENTIONS Rule 6), subject allowlist until real membership lands. **M**
3. Rate-limiter keying on authenticated subject (falls back to rightmost-hop XFF); modest read limiter on export/report routes. **S**
4. Client data lifecycle: enumerate every persistent key (advisor threads, drafts DB, evidence blob cache, layouts) in one module with `clearAllLocalData()`, wire as the logout hook, disclose local storage on the retention page. **M**

- Workspace provisioning, RLS, and billing are deliberately Later (L3) — the schema seams exist; don't build the second half before a second-customer decision.

### WS-D · Production-mode trust: advisor + capture

_Goal: the normal-mode leg behaves like the demo leg users have seen._

1. CSP vs SAS (R17): env-driven storage-origin allowlist in connect-src/img-src/frame-src (or same-origin blob proxy) + a deployed smoke test that uploads one real file. **M** — prerequisite for WS-A item 7.
2. Provenance parts in normal mode (R23). **S**
3. Server-side `proposeReviewAction` validation against store truth; approval cards render re-read data (R21). **M**
4. Grounding sanitation + zero-hit prompt clause + hostile-supplier-name regression tests (R22). **S**
5. Abort/cost envelope (merges the api-service and AI findings): propagate `request.signal` browser→proxy→route→`streamText`, `maxOutputTokens`, timeout, history truncation, token-usage logging via onFinish. **M**
6. Retrieval quality: relevance threshold (kills empirically demonstrated false citations on smalltalk), Swedish normalization/compounds, wire the existing pgvector stack into the chat route via the keyword-fallback pattern. **M**
7. Idempotent promotion (R19): client in-flight registry + server sha256+size dedupe on createEvidence. **M**
8. Normal-mode integration test against a mock OpenAI-compatible streaming endpoint (tool-approval HMAC round trip, provenance, mid-stream errors) — the production path is currently typecheck-only. **M**
9. Corpus freshness tripwire in CI + immediate re-verification of VAT-rate claims (one is likely stale per the 2026-04-01 food-VAT change). **S**

### WS-E · Test net that gates reality

1. Visual baselines (R20): generate reviewed linux baselines inside a pinned Playwright container with an explicit `snapshotPathTemplate`, document the re-baseline workflow — or skip the spec on CI honestly until then. **M**
2. Request-level security tests (R9), including scoping the `ALLOW_TEST_RESET` limiter bypass to demo mode. **M**
3. Coverage tooling (c8 / node:test coverage) with a low ratcheting threshold; first unit tests for api-client, ai-core, document-intelligence decision logic (zero tests today). **M**
4. Per-worker E2E API instances (`3201 + workerIndex`) to unlock parallel workers — do before the suite doubles again; lowest priority in this window. **L**

---

## 6. Next steps — Later (quarter)

Each bet names the decision it hinges on. None should start before WS-A/B land.

**L1 · The income half of accounting** (manual journal entry + sales posting patterns through the same review gate; output-VAT regime data already modeled; includes the invoice-method decision — post credit-2440 with settlement, or stop guessing/displaying `accountingMethod`). _Hinges on:_ is JPX a full bookkeeping system of record, or an advisory layer over imported books? A business that cannot book revenue is not the former. **L**

**L2 · Period close v1 + correction flow** (`PeriodLocked` guard in all posting paths, VAT-period lock, year-end checklist replacing the honest `getCloseRun` shell; `CorrectionPosted` reversal vouchers as the append-only escape hatch — also the cleanup mechanism for any entries corrupted by R1; full event replay + parity belongs here). _Hinges on:_ the same system-of-record ambition — the project's own compliance playbook and cited BFN guidance require it. _Depends on:_ WS-B booking dates. **L**

**L3 · Workspace provisioning + multi-tenancy + billing** (create-workspace-on-signup, per-request tenancy scoping replacing the boot-time `org_jpx`/`workspace_main` binding, RLS as defense-in-depth on the already-present columns, pricing/packaging per the locked free-accountant-seat decision). _Hinges on:_ a committed second customer / go-to-market date. This is the gate between own-use pilot and product. **XL**

**L4 · SIE migration completeness** (#IB/#UB/#RES → OpeningBalancesImported event, #UB reconciliation against replayed #VER with discrepancies as review items, golden files from real Fortnox/Visma exports). _Hinges on:_ whether competitor migration is the acquisition channel — if yes, this is the on-ramp and currently produces wrong balance sheets. **M**

**L5 · Bank data v1** (camt.053/CSV statement import reconciling against 1930 — no PSD2 scope; powers the cash widgets with real data; precursor to missing-transaction detection). _Hinges on:_ how far the cash-runway advisory pitch goes without real bank truth. **M–L**

**L6 · Deadline notifications** (web push on the existing statutory tax timeline; the PWA install base and SW already exist). _Hinges on:_ prioritizing a retention loop before or after auth — pointless before users can be identified. **M**

**L7 · Knowledge-corpus compliance lifecycle** (owner, review cadence tied to Skatteverket rule seasons, per-claim effective dates, corpus version in provenance chips — beyond the WS-D tripwire). _Hinges on:_ how much liability the "regulation-grounded advisory" brand is allowed to carry; wrong-but-cited tax guidance is the product's largest liability. **S–M ongoing**

---

## 7. Improvement themes

**Testing: make the seams real, not decorative.** The pyramid's bottom is excellent and its middle is missing: everything that only fails against a real database, a real JWKS, a real Azure origin, or a real LLM endpoint is currently invisible (the uuid drift, the CSP/SAS break, and the ESM crash loop are all this one pattern). The trajectory: every seam gets an automated exercise — Postgres container in CI, request-level security tests, a mock streaming LLM, a deployed-environment smoke — plus coverage measurement so untested packages are a number, not an anecdote. CONVENTIONS Rules 1/2/11 already encode this philosophy; CI just needs to enforce what the conventions preach.

**Observability: from zero to a baseline, then stop.** There is no telemetry anywhere — no App Insights, no alerts, no structured request logs, a `/ready` that lies, and a deploy pipeline that failed silently for 10 weeks. The aim is not an SRE stack; it's the minimum that converts silent failure into a ping: one App Insights resource, one availability test, workflow failure notifications, pg error codes in logs, and a boot line stating the security posture. Everything in WS-A item 5 is additive and cheap; resist expanding beyond it until there's a second environment to observe.

**Security posture: fail closed, then identify, then authorize.** The codebase has genuinely good security reflexes (UD-SAS, HMAC tool approvals, fail-closed advisor secrets) undermined by three habits: optional-by-default gates (JWKS unset = auth off), fail-open config parsing, and trusting client-supplied identity. The trajectory is a spine: every deployment states its posture at boot and refuses ambiguity (N5/N7); every request carries a verified subject (WS-C); every audit row attributes to that subject or an explicit `system:*` sentinel (Rule 20). Trust surfaces shown to users — the verified-ledger chip, provenance citations — must be cryptographically and behaviorally real (WS-B 2, WS-D 2), because a fake trust surface is worse than none.

**Docs and agent memory: truth passes as a ritual.** This repo's docs are an asset most projects lack, and their failure mode is now known precisely: the always-loaded memory files (CLAUDE.md, AGENTS.md) drift while DEV_STATUS stays fresh, because only DEV_STATUS has a phase-exit ritual. Extend the ritual: every phase/PR that changes deploy config, env vars, or phase status touches the memory files in the same commit; a CI grep fails on U+FFFD in tracked markdown; superseded docs move to `docs/archive/` with status headers; and the origin remote — not a laptop — is the source of truth for anything under `.github/` or `infra/` (same-day push rule).

**Correctness by construction.** The best findings-prevention pattern already in the codebase is shared pure helpers consumed by both stores. Extend it to invariants: one `assertBalanced()` on every posting path, one calendar/date module (three fiscal-math implementations exist today), one client-side invalidation helper, one date formatter (six components UTC-slice today), idempotency keys at the capture boundary. Each collapses a class of future bugs into a grep-able seam, which is exactly how this team already works best.

---

## 8. Explicit non-goals / do-not-redo

**Documented intentional deferrals (do not "fix"):**

- `parseBody` in `services/api/src/app.ts` is intentional; the `@hono/zod-validator` swap (Phase E.1) needs a parity test first (CLAUDE.md). Note: one reviewer claims validation.ts documents the migration as done — reconcile in N9's truth pass before touching either.
- `hono-openapi` / contract-test tooling deferred on the open Zod v4 incompatibility (#1177). Revisit only when it clears.
- Hash-chain **payload recomputation** is a documented deferral (jsonb key-order instability). WS-B item 2 (SHA-256 + canonical JSON) is the _unblocking_ work, not a redo of the deferral.
- Strategy B (per-request report derivation) is documented and reasonable at current volume. Do not build incremental projections preemptively; the open decision is drop-vs-populate for the never-used `projections.*` tables (+ a cheap partial event_type index if reads slow).
- E2E opt-in on PRs is a deliberate hang mitigation — don't flip to always-on without N6's instrumentation root-causing the hang.
- The 5 deploy-only perf ideas are already on main's PostgresLedgerStore (PR-F verified no-op). No action.
- Onboarding quest overlay was intentionally dropped; Expo native path and the Foundry adapter were deliberately never built.
- Auth, bank feeds, and Peppol transport were explicitly out of the pivot's scope (spec §6); they appear in this plan as _scheduled_ bets (WS-C, L5, integrations posture), not rediscovered gaps.
- Profile/Billing ComingSoon cards and the honest "not built" team/integrations states are deliberate honest-UI, not stubs to fill this quarter.
- The axe `color-contrast` rule deferral is documented with the exact ratio; leave it tracked.
- Phase 5 documented limitations stand as known scope, not bugs: >40 MSEK VAT variants and public-holiday shifts unencoded; employer-declaration/F-skatt entries date-only; missing-evidence detector excludes SIE vouchers; dashboard layouts localStorage-only.
- `POST /api/assistant/sessions` is retired and 404-pinned — don't re-add; the leftover `answerAssistantQuestion` scaffold on LedgerStore is a _deliberate removal_ task (WS-B 6 adjacency), not something to re-wire.
- Mobile dock clearance CSS and visual-mask conventions are regression-pinned — never "clean up" (CONVENTIONS 27, CLAUDE.md).

**Already landed — stale docs make these look open (do not re-implement):**

- DEV_STATUS "Open follow-ups": #1 compliance-alerts UI, #5 simulation preview modal, #7 knowledge citations, and the Document Intelligence persistence item (`updateEvidenceExtraction` + `ExtractionRefreshed` exist at `packages/domain/src/store.ts:274/722`) are DONE. Only #3 (acknowledge/dismiss routes) and the Books simulation sub-tab remain genuinely open. N9 corrects the docs.
- PLAN.md (stabilization sweep) is fully landed; PLAN1.md's stack decisions are implemented or superseded (TanStack Form removed). Archive, don't execute.
- `feat/advisory-pivot` holds no unmerged work (tree-identical to the merged squash). Delete it; status lives on main.

**Refuted findings:** every reviewer's refuted list was empty — no findings were struck in adversarial verification, so there are no "known false alarms" to record. Two data-quality caveats for future sessions instead: (1) the security-compliance reviewer's output was corrupted placeholder data — its absence is a gap (N10), not a clean bill; (2) most Tier-2 register items carry an "unverified" adversarial verdict — the synthesizer independently re-verified R1, R2, R3, R4, R11, R15's lock statement, R24's posting pattern, and the `ALLOW_TEST_RESET` bypass; remaining Tier-2 items should be re-confirmed in their implementing PRs, not re-litigated from scratch.
