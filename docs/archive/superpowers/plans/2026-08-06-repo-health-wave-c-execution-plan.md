# Repo-Health Wave C — Security Pins + CI Execution Plan

> **STATUS:** **COMPLETE** — landed on `main` via PR #35 (2026-08-06); deploy ARM scope casing follow-up PR #37. Do not re-execute. Archived under `docs/archive/superpowers/plans/` (this file may live there; links from active docs point at the archive). Next work: consolidation Waves D–G / post–Wave C brainstorm.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land Wave C security pins and CI hygiene — exact Next/Hono bumps (P0-5), Playwright/visual/mobile-flake fixes (P1-10), dep pin hygiene + gated AI SDK bump retaining the tool-approval workaround (P1-12 partial), and CI `db:test` failure diagnostics that inspect the live throwaway DB (P1-19).

**Architecture:** Minimal, revertible security diffs first; then CI/E2E/mask work; then pin-hygiene scaffolding (`.npmrc` / Renovate / recharts); finally AI SDK bump only after a deny-flow integration test exists and passes with the workaround kept. No product IA, no ledger store changes, no Art. 50 surface edits.

**Tech Stack:** Node ≥24, pnpm 10.29.2, Next 16, Hono 4, Playwright 1.58.2, AI SDK 7, GitHub Actions, Windows PowerShell + corepack shims.

**Branch / worktree choice:** New branch `feat/repo-health-wave-c` created from Wave B HEAD (`5b5789e` on `feat/repo-health-wave-b`). Worktree: `.worktrees/feat-repo-health-wave-c`. Rationale: keeps Wave A/B reviewable as prior slices; Wave C continues from the ledger-honesty tip without mixing wave labels. Do **not** branch from `main` or `feat/db-lifecycle-plan-v2` — those lack Waves A–B.

**Parent sources:** [`2026-08-06-repo-health-execution-handover.md`](../2026-08-06-repo-health-execution-handover.md), consolidation plan Wave C §6 + P0-5/P1-10/P1-12/P1-19 in [`2026-08-06-repo-health-consolidation-plan.md`](./2026-08-06-repo-health-consolidation-plan.md), prior wave [`2026-08-06-repo-health-wave-b-execution-plan.md`](./2026-08-06-repo-health-wave-b-execution-plan.md).

## Global Constraints

- Append-only events; never rewrite history. Review queue is the only path to a posted voucher.
- Store parity Memory↔Postgres — **Wave C does not change LedgerStore behavior.**
- Fail closed in `normal`; demo is explicit and labeled.
- Article 50 hard date **2026-08-02** (do not change Art. 50 surfaces in this wave).
- i18n parity: **Wave C touches zero `messages/*.json` keys** — no message-file owner this wave.
- Grep-gated seams: `@dnd-kit` only in `sortable-grid.tsx`; `ai`/`@ai-sdk` only under advisor trees; recharts only via reports charts barrel.
- Windows: `$env:PATH = "$env:LOCALAPPDATA\corepack-shims;$env:PATH"` before every pnpm call; PowerShell uses `;` not `&&`.
- DB lifecycle carve-outs authorized for this wave: **P1-19 only** (`scripts/db.mts` `cmdTest` pre-drop diagnostics + `ci.yml` diagnostics capture). Do not churn `compose.db.yml`, migrations, or seed beyond that.
- **Pins exactly:** `next` **16.2.12**, `eslint-config-next` **16.2.12**, `hono` **4.12.34**, `@hono/node-server` **1.19.17** (never 2.x).
- **NEVER delete** `apps/web/components/advisor/tool-approval.ts` — vercel/ai#13670 still open; workaround survives the AI bump.
- P2-15 dropped; P1-4 = Unavailable\* + `/ready` (Wave G); `buildExcerpt` → `packages/reporting` never domain — all out of scope.
- AGENTS.md agent protocol for this wave: **subagents never build or commit**; orchestrator centralizes verification + conventional commits after each task's review gate.
- Owner open questions (do **not** decide): Art. 50 counsel, JWT tenant claims, `WEBSITES_CONTAINER_STOP_TIME_LIMIT` deploy verify, P0-4 share-under-auth product choice.
- Default: **no push / no PR** unless the human asks. Note `run-e2e` label for when a PR is opened (mandatory for P0-5 / AI bump).

## Re-verification deltas (2026-08-06, against Wave B HEAD `5b5789e`)

| Item                          | Consolidation plan claim                                                                                                                     | Live tree @ `5b5789e`                                                                                                                                                                                                  | Action                                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **P0-5** pins                 | next 16.2.0 / hono 4.12.8 / node-server 1.19.11 → exact 16.2.12 / 4.12.34 / 1.19.17                                                          | **Still open** — root + web `next`/`eslint-config-next` `16.2.0`; api `hono` `4.12.8`, `@hono/node-server` `1.19.11`                                                                                                   | Implement Task 1                                                                                            |
| **P1-19** diagnostics         | `cmdTest` emits status/verify before drop; CI `--silent` capture                                                                             | **Still open** — `ci.yml:181` `URL=$(pnpm db:url 2>/dev/null)` (banner pollution); `db.mts:531` unconditional `main()`; `cmdTest` drops DB with no pre-drop status/verify                                              | Implement Task 2                                                                                            |
| **P1-10** CI split            | two steps in one job: `--grep-invert "visual:"` then visual spec                                                                             | **Still open** — `ci.yml:257` single `npx playwright test`                                                                                                                                                             | Implement Task 3                                                                                            |
| **P1-10** Playwright pin      | exact `1.58.2` (drop caret)                                                                                                                  | **Still open** — root `package.json` `"@playwright/test": "^1.58.2"`                                                                                                                                                   | Implement Task 3                                                                                            |
| **P1-10** mobile flakes       | onboarding force-clicks + home/books/reports/assistant raw clicks via `activateControl`; NOT dark-mode                                       | **Still open** — onboarding `:29/54/80` use `click({ force: isMobile })`; home `:30/32`, books-drilldown `:13/19/28/37`, reports `:146`, assistant `:119` still raw `.click()`; dark-mode still correctly skips mobile | Implement Task 3                                                                                            |
| **P1-10 / C3** masks          | tax-timeline widget, observations title, reports periodLabel, period-selector                                                                | **Still open** — only `tax-timeline-row.tsx:79` due-date masked; widget periodLabel/dueDate, observations title, period-selector trigger unmasked                                                                      | Implement Task 4                                                                                            |
| **P1-12** `.npmrc` / Renovate | `save-exact=true` + `renovate.json`                                                                                                          | **Still open** — both missing at repo root                                                                                                                                                                             | Implement Task 5                                                                                            |
| **P1-12** recharts / react-is | recharts `3.10.1` exact + react-is `19.2.8`                                                                                                  | **Still open** — web `recharts` `^3.9.2`; lockfile still `react-is@16.13.1` via recharts peer                                                                                                                          | Implement Task 5                                                                                            |
| **P1-12** deny-flow test      | mandatory BEFORE AI bump                                                                                                                     | **Still open** — no `approved: false` / `tool-output-denied` pin in `advisor-normal-mode.test.ts`                                                                                                                      | Implement Task 6                                                                                            |
| **P1-12** AI SDK bump         | `ai` 7.0.15→7.0.55 + `@ai-sdk/react` 4.0.16→4.0.58; **keep** workaround                                                                      | **Still open** — pins at 7.0.15 / 4.0.16; `tool-approval.ts` present (must remain)                                                                                                                                     | Implement Task 7                                                                                            |
| **P1-12** Joyride lazy        | original plan wording; unverified                                                                                                            | Eager `import { Joyride, … } from "react-joyride"` in `onboarding-shell.tsx:7`                                                                                                                                         | **Defer to residual** — not required for Wave C security/CI gate; shell-eager load is polish, not a pin CVE |
| Wave B residual minors        | store↔planning circular import; vocabulary `PostedToLedger` filter; `planComplianceMerge` PG-only; blocked-create pin; unit journal-tail pin | Still present in domain/tests                                                                                                                                                                                          | **Out of Wave C** — note for Wave F / later; none are P0-5/P1-10/12/19                                      |

**No "ALREADY FIXED — verify only" items in Wave C.** All four backlog items remain open.

**§6 conflict resolutions that bind Wave C (exact order):**

1. **P0-5 before P1-12** — security pin commit stays minimal and revertible; Renovate / save-exact / recharts / AI bump land separately.
2. **P1-19 before or with P1-10 CI edits** — both touch `.github/workflows/ci.yml`; Task 2 owns the diagnostics block, Task 3 owns the e2e job steps — sequential, same orchestrator, never parallel agents on `ci.yml`.
3. **Playwright exact-pin locksteps Docker image** — Task 3 drops caret to `1.58.2`; do not change `scripts/visual-baselines.md` IMG tag unless the package version changes (it must stay `v1.58.2-jammy`).
4. **Masks preferred over `page.clock`** — Task 4 stamps `data-visual-mask`; do not freeze browser clock (empty demo-seed month).
5. **Corrected mobile-flake list** — onboarding + home + books-drilldown + reports + assistant; **never** "fix" dark-mode (it skips mobile).
6. **Two-step visual/functional split in ONE job** — implement steps, not a separate containerized visual job.
7. **AI SDK bump ONLY after deny-flow test exists and passes**; **workaround stays** (never delete `tool-approval.ts`).
8. **At most one agent per batch touches `messages/*.json`** — Wave C touches **zero** message files.
9. **`package.json` / lockfile serialization** — Tasks 1, 3, 5, 7 all touch manifests; never parallelize them.

## File ownership (disjoint per task)

| Task              | Owner surfaces                              | May touch                                                                                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0                 | plan doc                                    | `docs/superpowers/plans/2026-08-06-repo-health-wave-c-execution-plan.md`, `.superpowers/sdd/progress.md`                                                                                                                                                                   |
| 1 P0-5            | deps security                               | root `package.json`, `apps/web/package.json`, `services/api/package.json`, `pnpm-lock.yaml`                                                                                                                                                                                |
| 2 P1-19           | CI + db.mts diagnostics                     | `scripts/db.mts` (`cmdTest` only + optional comment), `.github/workflows/ci.yml` (diagnostics step only)                                                                                                                                                                   |
| 3 P1-10 e2e/ci    | Playwright pin + CI split + activateControl | root `package.json` + lockfile (`@playwright/test` only), `.github/workflows/ci.yml` (e2e job steps), `tests/e2e/onboarding.spec.ts`, `home.spec.ts`, `books-drilldown.spec.ts`, `reports.spec.ts`, `assistant.spec.ts`                                                    |
| 4 P1-10 masks     | web visual masks                            | `apps/web/components/dashboard/widgets/tax-timeline-widget.tsx`, `observations-widget.tsx`, `apps/web/components/reports/tax-timeline-row.tsx`, `apps/web/components/period/period-selector.tsx`, visual baselines under `tests/e2e/**` only after human-grade diff review |
| 5 P1-12 hygiene   | save-exact + Renovate + recharts            | root `.npmrc` (new), root `renovate.json` (new), `apps/web/package.json` (recharts + react-is), `pnpm-lock.yaml`                                                                                                                                                           |
| 6 P1-12 deny test | advisor integration                         | `tests/integration/advisor-normal-mode.test.ts` only                                                                                                                                                                                                                       |
| 7 P1-12 AI bump   | AI SDK pins + keep workaround               | `services/api/package.json`, `apps/web/package.json` (`ai`, `@ai-sdk/*`), `pnpm-lock.yaml`; may add a short comment in `tool-approval.ts` / `advisor-chat.tsx` linking #13670 — **must not delete** those files                                                            |
| 8 verify+simplify | orchestrator                                | gates + polish commits                                                                                                                                                                                                                                                     |

**Never touch this wave:** `messages/*`, ledger store planners, Art. 50 docs, deploy Bicep/RBAC, `tool-approval.ts` deletion, P1-4 Unavailable\*, Joyride lazy-load (deferred residual).

## Verification gates

| Gate                       | When                                                   | Command (Windows PATH first)                                                                                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Why pins                   | After Task 1                                           | `pnpm why next` → single 16.2.12; `pnpm why hono` → single 4.12.34                                                                                                                                                                               |
| Unit suite                 | After Tasks 1, 5, 7                                    | `pnpm test:unit`                                                                                                                                                                                                                                 |
| Typecheck                  | After Tasks 1, 5, 7                                    | `pnpm typecheck` ; `pnpm typecheck:tests`                                                                                                                                                                                                        |
| Integration (advisor deny) | After Task 6–7                                         | `tsx --test tests/integration/advisor-normal-mode.test.ts` (needs `jpx_test_*` when normal-mode cases require DB — demo portions may run without)                                                                                                |
| `pnpm db:test`             | After Task 2 (diagnostics path) and before Wave C done | `pnpm db:test`                                                                                                                                                                                                                                   |
| Full merge gate            | Wave C complete                                        | `pnpm check` (note Wave A CRLF format:check residual if still present)                                                                                                                                                                           |
| E2E functional (local)     | After Task 3                                           | `pnpm build:e2e` then `npx playwright test --grep-invert "visual:"`                                                                                                                                                                              |
| Visual                     | After Task 4                                           | review diffs then `pnpm test:e2e:visual:update` only for intentional mask churn; linux via Docker per `scripts/visual-baselines.md` — if Docker unavailable, land masks + win32 and record linux re-baseline as residual before any `run-e2e` PR |
| PR E2E                     | When PR'd                                              | `gh pr edit <N> --add-label run-e2e` — **mandatory** for P0-5 + AI bump                                                                                                                                                                          |

---

### Task 0: Plan doc (this file)

**Files:**

- Create: `docs/superpowers/plans/2026-08-06-repo-health-wave-c-execution-plan.md`
- Modify: `.superpowers/sdd/progress.md` (reset ledger for Wave C)

- [ ] **Step 1: Commit plan on `feat/repo-health-wave-c`**

```bash
git add docs/superpowers/plans/2026-08-06-repo-health-wave-c-execution-plan.md
git commit -m "docs(plans): add Wave C security-pins + CI execution plan"
```

---

### Task 1: P0-5 Exact Next + Hono security pins

**Files:**

- Modify: root `package.json` (`devDependencies.next`, `devDependencies.eslint-config-next` → `16.2.12`)
- Modify: `apps/web/package.json` (`dependencies.next` → `16.2.12`)
- Modify: `services/api/package.json` (`dependencies.hono` → `4.12.34`, `dependencies.@hono/node-server` → `1.19.17`)
- Modify: `pnpm-lock.yaml` (via `pnpm install`)

**Interfaces:**

- Consumes: none
- Produces: single-resolution pins at exact versions above; unlocks Task 5/7 deps work without mixing security revert surface

- [ ] **Step 1: Edit the three package.json files to the exact pins**

```jsonc
// root package.json          "next": "16.2.12", "eslint-config-next": "16.2.12"
// apps/web/package.json      "next": "16.2.12"
// services/api/package.json  "hono": "4.12.34", "@hono/node-server": "1.19.17"
```

Do **not** touch `ai`, `@ai-sdk/*`, `@playwright/test`, or `recharts` here.

- [ ] **Step 2: Install + verify resolutions**

```powershell
$env:PATH = "$env:LOCALAPPDATA\corepack-shims;$env:PATH"
pnpm install
pnpm why next
pnpm why hono
```

Expected: single `16.2.12` for next; single `4.12.34` for hono; `@hono/node-server` at `1.19.17`.

- [ ] **Step 3: Focused verification (orchestrator)**

```powershell
pnpm typecheck
pnpm test:unit
```

Expected: green (or only pre-existing unrelated failures). Do not run full `pnpm check` yet if format:check CRLF noise remains — record it.

- [ ] **Step 4: Orchestrator commit**

```bash
git add package.json apps/web/package.json services/api/package.json pnpm-lock.yaml
git commit -m "fix(deps): pin next 16.2.12 and hono 4.12.34 for advisories"
```

---

### Task 2: P1-19 CI diagnostics against live `jpx_test_*`

**Files:**

- Modify: `scripts/db.mts` — inside `cmdTest` only (emit status/verify on suite failure before `finally` drop)
- Modify: `.github/workflows/ci.yml` — "Collect lifecycle diagnostics" step only (silent capture + note; do not rewrite the e2e job yet)

**Interfaces:**

- Consumes: existing `runInherit` / `TSX_CLI` / `MIGRATIONS_SCRIPT` in `db.mts`
- Produces: failing `pnpm db:test` logs show migration status/verify for the throwaway DB before drop; CI artifact no longer polluted by pnpm banner

- [ ] **Step 1: Emit pre-drop diagnostics in `cmdTest`**

In `scripts/db.mts` `cmdTest`, after `runInherit(... test:integration ...)` returns non-zero and **before** the `finally` drop block:

```ts
if (exitCode !== 0) {
  console.log(`Integration suite failed — migration status/capabilities for "${testDatabase}" (before drop):`);
  await runInherit(process.execPath, [TSX_CLI, MIGRATIONS_SCRIPT, "status", "--database-url", testUrl]).catch(() => 1);
  await runInherit(process.execPath, [TSX_CLI, MIGRATIONS_SCRIPT, "verify", "--database-url", testUrl]).catch(() => 1);
}
```

Never `console.log` the raw `testUrl` (credentials). Do **not** add an `isMain` guard here — that is P2-16; leave the inline Compose project hash in ci.yml with a one-line comment pointing at `resolveProjectName` if helpful.

- [ ] **Step 2: Fix CI diagnostics capture**

Replace the jpx_dev URL capture block so it uses silent pnpm and labels the artifact honestly:

```yaml
# NOTE: jpx_test_* is already dropped by db:test's finally. This block probes
# the tool-managed jpx_dev DB only. Real failure diagnostics are in the
# db:test step log (status/verify emitted before drop).
# pnpm 10.29.2 writes its run banner to stdout — always use --silent for capture.
if URL=$(corepack pnpm --silent db:url 2>/dev/null); then
  {
    echo "NOTE: inspects tool-managed jpx_dev, NOT the dropped jpx_test_* DB"
    corepack pnpm exec tsx scripts/db-migrations.mts status --database-url "$URL" || true
  } > artifacts/db-diagnostics/migrations-status.txt 2>&1
  ...
fi
```

- [ ] **Step 3: Local smoke of silent capture**

```powershell
corepack pnpm --silent db:url
# Expected: exactly one line, a postgres:// URL (Compose must be up), no pnpm banner
```

If Compose is down, document and skip — the YAML change is still correct.

- [ ] **Step 4: Orchestrator commit**

```bash
git add scripts/db.mts .github/workflows/ci.yml
git commit -m "fix(ci): emit db:test diagnostics before throwaway drop"
```

---

### Task 3: P1-10 Playwright pin + CI split + `activateControl` migrations

**Files:**

- Modify: root `package.json` — `"@playwright/test": "1.58.2"` (drop caret)
- Modify: `pnpm-lock.yaml` if needed
- Modify: `.github/workflows/ci.yml` — e2e job run step → two steps
- Modify: `tests/e2e/onboarding.spec.ts`, `home.spec.ts`, `books-drilldown.spec.ts`, `reports.spec.ts`, `assistant.spec.ts`

**Interfaces:**

- Consumes: `activateControl` from `tests/e2e/test-helpers.ts`
- Produces: functional CI step excludes `visual:`; mobile paths keyboard-activate

- [ ] **Step 1: Exact-pin Playwright**

```jsonc
// package.json devDependencies
"@playwright/test": "1.58.2"
```

```powershell
pnpm install
# lockfile should remain on 1.58.2 (no version jump)
```

Confirm `scripts/visual-baselines.md` still documents `IMG=mcr.microsoft.com/playwright:v1.58.2-jammy`.

- [ ] **Step 2: Split CI e2e job into two steps**

```yaml
- name: Run functional E2E tests
  run: npx playwright test --grep-invert "visual:"

- name: Run visual regression
  run: npx playwright test tests/e2e/visual-regression.spec.ts
```

Keep the existing `if:` gate, DEBUG env, build:e2e, and artifact upload untouched.

- [ ] **Step 3: Route corrected mobile-flake list through `activateControl`**

Patterns (each file already has or must gain `isMobile` from `testInfo.project.name`):

```ts
// onboarding — replace force-clicks + Skip tour raw click
await activateControl(page.getByTestId("onboarding-show-me-around"), isMobile);
await activateControl(page.getByRole("button", { name: "Skip tour" }), isMobile);
await activateControl(page.getByTestId("getting-started-guide-capture"), isMobile);
await activateControl(page.getByTestId("onboarding-replay-orientation"), isMobile);

// home — today-view toggles need isMobile in test signature
await activateControl(page.getByTestId("today-view-queue"), isMobile);
await activateControl(page.getByTestId("today-view-dashboard"), isMobile);

// books-drilldown — row/chip clears
await activateControl(firstRow, isMobile);
await activateControl(page.getByTestId("ledger-account-filter-clear"), isMobile);
// … supplier clear likewise

// reports
await activateControl(page.getByTestId("print-report"), isMobile);

// assistant palette entry (runs on both projects)
await activateControl(page.getByTestId("palette-ask-advisor"), isMobile);
```

Do **not** edit `dark-mode.spec.ts`.

- [ ] **Step 4: Orchestrator commit**

```bash
git add package.json pnpm-lock.yaml .github/workflows/ci.yml tests/e2e/onboarding.spec.ts tests/e2e/home.spec.ts tests/e2e/books-drilldown.spec.ts tests/e2e/reports.spec.ts tests/e2e/assistant.spec.ts
git commit -m "test(e2e): split visual CI step and route mobile clicks via activateControl"
```

---

### Task 4: P1-10 / C3 `data-visual-mask` on clock-derived UI

**Files:**

- Modify: `apps/web/components/dashboard/widgets/tax-timeline-widget.tsx`
- Modify: `apps/web/components/dashboard/widgets/observations-widget.tsx`
- Modify: `apps/web/components/reports/tax-timeline-row.tsx` (periodLabel — due date already masked)
- Modify: `apps/web/components/period/period-selector.tsx`
- Modify (only after reviewing diffs): visual baselines under `tests/e2e/` for today/reports × light/dark × win32/linux

**Interfaces:**

- Consumes: existing visual-regression locator `page.locator("[data-visual-mask]")`
- Produces: calendar-roll pixel churn reduced on masked text

- [ ] **Step 1: Stamp masks**

```tsx
// tax-timeline-widget.tsx — periodLabel + due date
<p className="mt-0.5 text-caption text-muted-foreground" data-visual-mask>
  {deadline.periodLabel}
</p>
<p className="text-sm font-semibold tabular-nums" data-visual-mask>
  {formatShortDate(deadline.dueDate, locale)}
</p>

// observations-widget.tsx — title carries date params
<p className="mt-1 text-sm leading-6 text-foreground" data-visual-mask>
  {tObservations(observation.titleKey, observation.params)}
</p>

// tax-timeline-row.tsx — periodLabel (due date already masked at :79)
// period-selector.tsx — SelectTrigger displayed value / label
```

Do **not** use `page.clock.setFixedTime`.

- [ ] **Step 2: Visual verify / re-baseline (orchestrator, human-grade review)**

```powershell
pnpm test:e2e:visual
# Review every diff image under test-results/
# Only then:
pnpm test:e2e:visual:update
# Linux baselines: follow scripts/visual-baselines.md Docker flow
```

If Docker/linux flow is unavailable in this environment: commit the mask source changes, update win32 baselines after review if local Playwright runs, and record **linux re-baseline residual** — do not blind-update, do not claim visual gate green without evidence.

- [ ] **Step 3: Orchestrator commit**

```bash
git commit -m "fix(web): mask clock-derived tax/observation/period text for visual CI"
```

---

### Task 5: P1-12 pin hygiene (`.npmrc` + Renovate + recharts/react-is)

**Files:**

- Create: `.npmrc` with `save-exact=true`
- Create: `renovate.json` (content from consolidation plan P1-12 sketch — `config:best-practices`, `rangeStrategy: pin`, ai-sdk/hono groups, `run-e2e` label on next/react/recharts/joyride, OSV alerts)
- Modify: `apps/web/package.json` — `"recharts": "3.10.1"`, add `"react-is": "19.2.8"`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: Task 1 pins already exact
- Produces: future `pnpm add` writes exact versions; recharts peer satisfied by react-is 19

- [ ] **Step 1: Add `.npmrc` and `renovate.json`** exactly as consolidation plan P1-12 sketch (verbatim groups/labels).

- [ ] **Step 2: Pin recharts + react-is, install**

```powershell
pnpm install
pnpm why react-is
# Expected: 19.2.8 satisfied for recharts; no recharts→react-is@16.13.1 edge preferred
```

- [ ] **Step 3: Orchestrator commit**

```bash
git add .npmrc renovate.json apps/web/package.json pnpm-lock.yaml
git commit -m "chore(deps): save-exact, Renovate, and pin recharts/react-is"
```

---

### Task 6: P1-12 mandatory deny-flow integration test (BEFORE AI bump)

**Files:**

- Modify: `tests/integration/advisor-normal-mode.test.ts` only

**Interfaces:**

- Consumes: existing helpers `extractStreamedApproval`, `approvalRespondedMessage(approval, input, approved)`
- Produces: pin that denial yields `tool-output-denied`, zero `applyReviewDecision` calls, review stays `needs-review`, stream terminates

- [ ] **Step 1: Write the deny-flow test (TDD — add failing assertions first if helpers need a new case)**

Reuse helpers; pass `approved: false`. Assert:

1. Stream contains `tool-output-denied` for the toolCallId
2. `applyReviewDecision` spy count === 0
3. Review status remains `needs-review`
4. Stream terminates (timeout wrapper — no hang)

- [ ] **Step 2: Run with current SDK + workaround still present**

```powershell
# Prefer disposable DB when the suite requires it:
# DATABASE_TEST_URL=.../jpx_test_* JPX_REQUIRE_DATABASE_TESTS=true
tsx --test tests/integration/advisor-normal-mode.test.ts
```

Expected: new deny test green **with** `tool-approval.ts` still in tree.

- [ ] **Step 3: Orchestrator commit**

```bash
git add tests/integration/advisor-normal-mode.test.ts
git commit -m "test(advisor): pin deny-flow tool-output-denied before AI SDK bump"
```

---

### Task 7: P1-12 AI SDK bump — workaround RETAINED

**Files:**

- Modify: `services/api/package.json` — `ai` → `7.0.55`; bump `@ai-sdk/azure` to matching latest if required for peer alignment (verify installed types)
- Modify: `apps/web/package.json` — `ai` → `7.0.55`, `@ai-sdk/react` → `4.0.58`
- Modify: `pnpm-lock.yaml`
- Optional comment-only: `apps/web/components/advisor/tool-approval.ts` / `advisor-chat.tsx` — note vercel/ai#13670; **FORBIDDEN to delete**

**Interfaces:**

- Consumes: Task 6 deny-flow pin green
- Produces: bumped SDK with signature-preserving workaround still wired

- [ ] **Step 1: Preflight changelog / flag check**

Confirm `experimental_toolApprovalSecret` still exists under that name in the target `ai` package before bumping. Do **not** revert to `addToolApprovalResponse` — #13670 deny-flow has no released fix through 7.0.55.

- [ ] **Step 2: Bump pins + install**

```powershell
pnpm install
```

- [ ] **Step 3: Re-run suites with workaround kept**

```powershell
tsx --test tests/unit/web-tool-approval.test.ts
tsx --test tests/unit/advisor-chat-route.test.ts
tsx --test tests/integration/advisor-normal-mode.test.ts
pnpm typecheck
```

Expected: all green; `tool-approval.ts` and `web-tool-approval.test.ts` still present.

- [ ] **Step 4: Orchestrator commit**

```bash
git add services/api/package.json apps/web/package.json pnpm-lock.yaml apps/web/components/advisor/tool-approval.ts apps/web/components/advisor/advisor-chat.tsx
git commit -m "chore(deps): bump ai SDK to 7.0.55; keep tool-approval workaround"
```

---

### Task 8: Wave C verify + simplify

**Files:** polish only if review finds Critical/Important; update `.superpowers/sdd/progress.md`

- [ ] **Step 1: Run verification-before-completion gates**

```powershell
$env:PATH = "$env:LOCALAPPDATA\corepack-shims;$env:PATH"
pnpm check
pnpm db:test
```

Record format:check CRLF residual if still the only failure. Note `run-e2e` for PR time.

- [ ] **Step 2: Final whole-branch review + code-simplify** on the Wave C commit range (`5b5789e..HEAD`).

- [ ] **Step 3: Progress ledger final status + residual minors list.**

---

## Self-review (plan author)

1. **Spec coverage:** P0-5 → Task 1; P1-19 → Task 2; P1-10 (CI/pin/activateControl) → Task 3; P1-10 masks/C3 → Task 4; P1-12 hygiene → Task 5; deny-flow → Task 6; AI bump → Task 7; gates → Task 8. Joyride lazy deferred with reason. Wave B residuals explicitly out of scope.
2. **Placeholder scan:** no TBD/TODO steps; exact pins and YAML/TS sketches included.
3. **Type/order consistency:** package.json serialization encoded; AI bump after deny test; workaround never deleted; ci.yml sequential Tasks 2→3.

## Execution handoff

Plan complete. Execute via **subagent-driven-development** continuously from Task 1 (orchestrator commits; subagents implement only). No push/PR by default.
