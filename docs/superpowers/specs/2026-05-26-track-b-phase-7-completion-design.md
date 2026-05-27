# Track B Phase 7 — Data-layer Completion (Design Spec)

**Date:** 2026-05-26
**Status:** Draft — pending user review
**Owner-track:** Track B (Supabase backend)
**Parent plan:** [`2026-05-19-supabase-backend-track.md`](../plans/2026-05-19-supabase-backend-track.md) (Phase 7)
**Sprint flavor:** Internal hardening — no external eyes

## Context

The two hardening series (`2026-05-19-supabase-hardening.md` 14 tasks + `2026-05-20-hardening-followups.md` 6 tasks) have all landed on `deploy`. `SupabaseLedgerStore` now matches `MemoryLedgerStore` for the core ledger loop (capture → review → approve → reports/SIE) with fail-closed auth, defense-in-depth workspace scoping, trigger-maintained projection aggregates, and an end-to-end Hono integration test.

Four items from the parent plan's Phase 7 remain open. This spec closes the data-layer parity gap so that `SupabaseLedgerStore` no longer behaves _less_ than `MemoryLedgerStore` on any interface method except `getCloseRun` (deferred by product) and `answerAssistantQuestion`'s answer-text quality (deferred to the Cmd-K Advisor sprint).

## Goal

`ACCOUNTING_RUNTIME_MODE=normal` exposes the same surface as `demo` for: simulation, assistant Q&A round-trip, compliance alerts, and projection rebuilds from events. The events-are-source-of-truth invariant becomes operationally provable.

## Non-goals (explicit)

- **Real Azure OpenAI advisor wiring.** `answerAssistantQuestion` returns scaffold text in both stores. Real AI lands with IA Phase 6 (Cmd-K Advisor) and only the `buildAssistantScaffold` helper will change.
- **`getCloseRun` real implementation.** Stays as static checklist placeholder until product defines the period-close model.
- **Azure Postgres migration prep.** Docs-only, deferred per parent plan.
- **Bank statement import & matching.** No bank-import surface exists yet; bank-related compliance rules are out of scope for v1.
- **Server-side scheduling.** No `pg_cron` or background workers. `refreshComplianceAlerts` is manually triggered only.

## Scope — four pieces, in order

| #   | Piece                                   | Why first                                                         |
| --- | --------------------------------------- | ----------------------------------------------------------------- |
| 1   | Projection rebuild script               | Pure infrastructure; no contract change; makes #3 easier to debug |
| 2   | `supa_audit` migration                  | One-shot infrastructure; no contract change; complements #4       |
| 3   | Real `runSimulation` (both stores)      | Contract change; biggest design lift                              |
| 4   | Assistant scaffold + compliance refresh | Contract-additive; benefits from #2's tracking                    |

Each piece is independently shippable. Suite stays green between pieces.

## Architecture decisions

| Decision               | Choice                                                                                                 | Rationale                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Rebuild script form    | One-shot Node script under `scripts/`                                                                  | Ops/recovery tool, not a runtime path. Doesn't need API integration.                           |
| Rebuild script default | Dry-run; `--apply` required to write                                                                   | Defensive; only ever writes to `projections.*`, never `ledger.*`                               |
| supa_audit scope       | `vouchers`, `review_tasks`, `compliance_alerts`, `assistant_sessions`                                  | The four mutable tables. Append-only `events` doesn't need it (already immutable via trigger). |
| Simulation scope shape | List of pending review IDs + uniform action                                                            | Concrete, maps to real UI affordance ("preview impact of approving these N items")             |
| Simulation persistence | Append `SimulationExecuted` event, write no journal lines                                              | Audit-worthy ("someone asked what-if") without polluting the ledger                            |
| Simulation pure core   | `simulateApprovals(reviews, suggestions, vouchers, action)` in new `packages/domain/src/simulation.ts` | Shared by both stores; testable without DB                                                     |
| Assistant scaffold     | Lift Memory's scaffold response into `packages/domain/src/assistant.ts`                                | Both stores produce identical responses; AI wiring is a one-line swap later                    |
| Compliance trigger     | Manual `POST /api/compliance/refresh` only                                                             | Predictable, no scheduler infra                                                                |
| Compliance rules v1    | Stale-blocked vouchers (>7d) + missing supplier VAT on approved vouchers                               | Two deterministic, testable rules. Bank-line rule deferred until bank import exists.           |
| Compliance idempotency | Upsert by `(organization_id, workspace_id, kind, target_id)`                                           | Re-running refresh doesn't duplicate alerts; alert resolution clears the `target_id`           |

---

## Piece 1: Projection rebuild script

**Location:** `scripts/rebuild-projections.mjs`

**Inputs:** `SUPABASE_URL`, `SUPABASE_SECRET_KEY` from env. CLI flags: `--org <id>`, `--workspace <id>` (omit for all), `--apply` (default: dry-run print summary only).

**Behavior:**

1. Read every event from `ledger.events` ordered by `(organization_id, workspace_id, sequence_number)` ascending.
2. For each `PostedToLedger` event: payload contains `{ action, suggestion }` plus the voucher reference. Re-fetch the voucher row (or thread it through; voucher is required for `buildPostingLines`). Reconstruct posting lines via the existing `buildPostingLines(action, suggestion, voucher)` from `packages/domain/src/posting.ts`.
3. Group resulting lines by scope.
4. With `--apply`: in a single transaction per scope, `DELETE FROM projections.journal_entries WHERE organization_id = ? AND workspace_id = ?`, then `INSERT` the replayed rows. The trigger from hardening Task 9 auto-rebuilds `account_balances`/`vat_summary` (truncate those first too, since the trigger fires only on INSERT — explicit `DELETE` then `INSERT`).
5. Without `--apply`: print row count comparison: existing rows vs. would-be rows, per scope.

**Safety invariants:**

- Never writes to `ledger.*`.
- Refuses to run if `SUPABASE_SECRET_KEY` is missing (no anon-key footguns).
- Prints scope summary before any write; non-interactive `--apply` skips the prompt.

**Test:** `tests/unit/rebuild-projections.test.ts` — given a fixture array of events including 2 `PostedToLedger` events with distinct suggestions, the reconstruction produces the expected journal rows (compare to direct `buildPostingLines` call).

---

## Piece 2: supa_audit migration

**New file:** `supabase/migrations/<ts>_enable_supa_audit.sql`

```sql
create extension if not exists supa_audit;

select audit.enable_tracking('ledger.vouchers'::regclass);
select audit.enable_tracking('ledger.review_tasks'::regclass);
select audit.enable_tracking('ledger.compliance_alerts'::regclass);
select audit.enable_tracking('ledger.assistant_sessions'::regclass);
```

**Cleanup:** remove the commented `-- create extension if not exists supa_audit; ...` block from `supabase/migrations/20260324000000_schema_v2.sql:374-378`. Dead code that this migration now supersedes.

**Pre-flight (hosted Supabase only):** before merging, run `select * from pg_available_extensions where name = 'supa_audit'` against the hosted DB. `supa_audit` is in the official dbdev registry and pre-allowed on Supabase hosted, but verify rather than assume.

**Adds:** `audit.record_history` table accumulates `(table_oid, record_id, op, old_record, new_record, ts)` for the four tracked tables. Useful for "who changed what when" on mutable read state, beyond the append-only event log on the legal record.

**No code change** in `packages/` or `services/` — pure infrastructure. Existing reads/writes continue to work; the trigger is transparent.

---

## Piece 3: Real `runSimulation`

### Contract changes

Current `simulationRequestSchema` (`packages/contracts/src/index.ts:288`): `{ actorId, title, scenario, voucherId? }`. The `voucherId?` field is unused — no live caller in `apps/web/*` exists. Existing schema users: the API route validator at `services/api/src/app.ts:232` and a few mock fixtures in `tests/unit/`. Both adapt to the new shape; no production HTTP client is in flight.

```ts
// SimulationRequest — REPLACES the current shape; voucherId? is dropped
{
  title: string;
  scenario: string;
  actorId: string;
  reviewIds: z.array(z.string()).min(1).max(50);    // NEW
  action: z.enum(["approve", "book-without-vat"]);   // NEW
}

// SimulationRun — extends the current shape; affectedAccounts becomes derived
// Current: { id, title, scenario, outcomeSummary, affectedAccounts: string[] }
{
  id: string;
  title: string;
  scenario: string;
  outcomeSummary: string;
  affectedAccounts: string[];                   // now derived from balanceDelta, NOT hardcoded
  balanceDelta: Array<{                         // NEW
    accountNumber: string;
    accountName: string;
    deltaDebit: number;
    deltaCredit: number;
  }>;
  vatDelta: Array<{                             // NEW
    vatCode: string;
    deltaBase: number;
    deltaAmount: number;
  }>;
}
```

### Implementation

**New shared pure function** `packages/domain/src/simulation.ts`:

```ts
export function simulateApprovals(
  reviews: ReviewTask[],
  suggestions: AccountingSuggestion[],
  vouchers: Voucher[],
  action: ReviewAction,
): { balanceDelta: BalanceDeltaLine[]; vatDelta: VatDeltaLine[]; affectedAccounts: string[] };
```

For each (review, suggestion, voucher) tuple where the review is `needs-review` and not in a terminal state:

1. Call existing `buildPostingLines(action, suggestion, voucher)`.
2. Accumulate `{ accountNumber → (debit, credit) }` and `{ vatCode → (base, amount) }` deltas.
3. Skip silently any review whose suggestion/voucher cannot be resolved (do not throw — simulations against partially-fetched data must still return a partial answer).

Both stores' `runSimulation`:

1. Load reviews/suggestions/vouchers for the requested `reviewIds` (org-scoped). Memory: in-memory map lookup. Supabase: parallel `.in("id", reviewIds)` queries.
2. Call `simulateApprovals(...)`.
3. Construct `SimulationRun` with deterministic `outcomeSummary` (e.g., `${reviewIds.length} reviews simulated; net debit ${total}, net credit ${total}`).
4. Append a `SimulationExecuted` event with payload `{ reviewIds, action, balanceDelta, vatDelta }`.
5. Return the `SimulationRun`. **Write zero journal lines.**

The hardcoded `["6071","2641","6991"]` in MemoryLedgerStore disappears.

### Tests

- `tests/unit/simulation.test.ts` — pure-function test on `simulateApprovals` with fixture reviews/suggestions/vouchers. Cover: single review approve; multi-review approve; book-without-vat (VAT delta zero); skipped (missing voucher) review.
- Extend `tests/unit/ledger-store.test.ts` and `tests/unit/supabase-store.test.ts` — `getReports()` byte-equal before and after `runSimulation` (read-only invariant). `SimulationExecuted` event appears in `getEvents()`.

---

## Piece 4: Assistant + compliance persistence

### Assistant (small)

**New** `packages/domain/src/assistant.ts`:

```ts
export function buildAssistantScaffold(question: string): AssistantSession;
```

Returns a structured response with one hardcoded citation (`internal architecture policy: "AI may suggest and explain, but may not silently mutate accounting state."`). Matches the text Memory currently inlines.

**Wire-up:**

- `MemoryLedgerStore.answerAssistantQuestion(q)`: call `buildAssistantScaffold(q)`, push to `assistantExamples`, return. (Refactor — no behavior change.)
- `SupabaseLedgerStore.answerAssistantQuestion(q)`: call `buildAssistantScaffold(q)`, insert into `ledger.assistant_sessions` (already does this), return. Stop returning `"Database-backed assistant sessions are not yet implemented."`.

When real AI lands later, `buildAssistantScaffold` is replaced with `aiRuntime.answer(question)` and neither store changes.

### Compliance (medium)

**Interface addition** in `packages/domain/src/store.ts`:

```ts
refreshComplianceAlerts(): Promise<ComplianceAlert[]>;
```

**New pure function** `packages/domain/src/compliance.ts`:

```ts
export function detectComplianceIssues(
  reviews: ReviewTask[],
  vouchers: Voucher[],
  today: string, // YYYY-MM-DD for deterministic testability
): ComplianceAlert[];
```

**v1 rules** (both run on every refresh):

1. **Stale-blocked vouchers** — for each `ReviewTask` where `status === "needs-review"`, any associated rule hit has `severity === "blocking"` (carried via the embedded `suggestion.ruleHits`), and the voucher's `createdAt` is more than 7 days before `today`. Alert kind: `"stale-blocked"`. `targetId` = voucher ID. Severity: `warning`.
2. **Missing supplier VAT on approved vouchers** — for each `Voucher` where `status === "approved"` and `voucherFields.supplierVatNumber` is empty/null. Alert kind: `"missing-supplier-vat"`. `targetId` = voucher ID. Severity: `warning`.

Both rules are deterministic; the `today` parameter makes them testable.

**Idempotency** in `refreshComplianceAlerts`:

- Compute `ComplianceAlert[]` via `detectComplianceIssues`.
- Upsert each alert keyed by `(organization_id, workspace_id, kind, target_id)`.
- Return the persisted list.

A re-run does not duplicate; an alert whose underlying condition has been resolved (voucher approved, VAT number added) will not appear in the next refresh — but existing rows are not auto-deleted. v1 leaves resolved rows in place with `status = "open"`; a future `markAlertResolved(id)` is out of scope.

**Schema alignment finding:** the existing `complianceAlertSchema` (`packages/contracts/src/index.ts:225`) is `{ id, title, source, detectedAt, impactSummary }` — much thinner than the DB columns (`status, severity, body`, etc.). This sprint aligns them.

**Contract update** in `packages/contracts/src/index.ts`:

```ts
// complianceAlertSchema — extended
{
  id: string;
  title: string;
  source: string;
  detectedAt: string;
  impactSummary: string;
  // NEW (align with DB and v1 rules)
  kind: string; // e.g. "stale-blocked", "missing-supplier-vat"
  severity: z.enum(["info", "warning", "critical"]); // matches DB
  status: z.enum(["open", "resolved"]); // matches DB
  targetId: z.string().optional(); // voucher/review ID the alert points at
  body: z.string().optional(); // longer-form explanation
}
```

`MemoryLedgerStore`'s seeded alerts and `SupabaseLedgerStore`'s `mapComplianceAlertRow` adapt to fill the new fields.

**Migration** `supabase/migrations/<ts>_compliance_alert_keys.sql` adds the deduplication index (columns already exist in the DB):

```sql
alter table ledger.compliance_alerts add column if not exists kind text not null default 'legacy';
alter table ledger.compliance_alerts add column if not exists target_id text;
create unique index ledger_alerts_dedup_uidx
  on ledger.compliance_alerts (organization_id, workspace_id, kind, target_id)
  where target_id is not null;
```

**API:** new route `POST /api/compliance/refresh` in `services/api/src/app.ts`:

- Auth-gated (already true for `/api/*`).
- Calls `c.get("store").refreshComplianceAlerts()`.
- Returns `{ alerts: ComplianceAlert[] }`.

`getSnapshot()` continues to return persisted alerts (no behavior change there).

### Tests

- `tests/unit/compliance.test.ts` — pure `detectComplianceIssues` tests with deterministic `today`. Cover: no alerts on fresh data; stale-blocked rule fires after 8 days; missing-VAT rule fires only on approved status; both rules can fire on the same scope.
- `tests/unit/assistant.test.ts` — `buildAssistantScaffold` returns expected shape.
- Extend `tests/unit/supabase-store.test.ts` — `refreshComplianceAlerts` upsert (running twice with same data produces same row, not duplicates).
- Extend `tests/unit/ledger-store.test.ts` — MemoryLedgerStore parity for refresh.

---

## File map

| Path                                                 | Action                                                                                        | Piece |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----- |
| `scripts/rebuild-projections.mjs`                    | NEW                                                                                           | 1     |
| `supabase/migrations/<ts>_enable_supa_audit.sql`     | NEW                                                                                           | 2     |
| `supabase/migrations/<ts>_compliance_alert_keys.sql` | NEW                                                                                           | 4     |
| `supabase/migrations/20260324000000_schema_v2.sql`   | DELETE commented `supa_audit` block                                                           | 2     |
| `packages/contracts/src/index.ts`                    | MODIFY — extend `SimulationRequest`/`SimulationRun`; add `ComplianceAlert.kind`/`targetId`    | 3, 4  |
| `packages/domain/src/simulation.ts`                  | NEW                                                                                           | 3     |
| `packages/domain/src/assistant.ts`                   | NEW                                                                                           | 4     |
| `packages/domain/src/compliance.ts`                  | NEW                                                                                           | 4     |
| `packages/domain/src/store.ts`                       | MODIFY — add `refreshComplianceAlerts`; rewrite `runSimulation`; use `buildAssistantScaffold` | 3, 4  |
| `packages/domain/src/supabase-store.ts`              | MODIFY — same surface as Memory; use shared helpers; new `refreshComplianceAlerts`            | 3, 4  |
| `packages/domain/src/supabase-mappers.ts`            | MODIFY — add `mapComplianceAlertRow` if not present                                           | 4     |
| `packages/domain/src/index.ts`                       | MODIFY — export new modules                                                                   | 3, 4  |
| `services/api/src/store-factory.ts`                  | MODIFY — `UnavailableLedgerStore` gains the new method                                        | 4     |
| `services/api/src/app.ts`                            | MODIFY — `POST /api/compliance/refresh`                                                       | 4     |
| `tests/unit/rebuild-projections.test.ts`             | NEW                                                                                           | 1     |
| `tests/unit/simulation.test.ts`                      | NEW                                                                                           | 3     |
| `tests/unit/assistant.test.ts`                       | NEW                                                                                           | 4     |
| `tests/unit/compliance.test.ts`                      | NEW                                                                                           | 4     |
| `tests/unit/ledger-store.test.ts`                    | EXTEND                                                                                        | 3, 4  |
| `tests/unit/supabase-store.test.ts`                  | EXTEND                                                                                        | 3, 4  |

No web (`apps/web/*`) changes in this sprint — UI for compliance refresh and simulation preview is a Track A follow-up.

## Acceptance

- `pnpm typecheck && pnpm typecheck:tests && pnpm test:unit` green.
- `pnpm test:integration` (when SUPABASE_URL set) green; the existing `tests/integration/api-normal-mode.test.ts` still passes.
- Manual normal-mode flow:
  1. Seed → `POST /api/compliance/refresh` returns expected alerts for the seeded data.
  2. Re-run refresh → response is identical (idempotent).
  3. `POST /api/simulations` with 2 pending `reviewIds` and `action: "approve"` returns a `SimulationRun` with non-empty `balanceDelta`; `GET /api/reports/trial-balance` is unchanged from before the call.
  4. Run `node scripts/rebuild-projections.mjs --org org_jpx --workspace workspace_main --apply` → `GET /api/reports/trial-balance` is byte-identical to its previous state.
- Demo mode E2E unchanged (Today/Books/Reports specs pass).
- DEV_STATUS.md Track B Phase 7 row updated: 7.2, 7.3, 7.4, 7.5 → Done; 7.6 → Open (deferred per spec).

## Open questions (none blocking)

- **Hosted supa_audit enablement:** verify pre-flight before merging the Piece-2 migration. If the extension is _not_ on the hosted allowlist, fallback is to drop Piece 2 from this sprint (it does not block 1, 3, 4).
- **Future:** a `markAlertResolved(id)` method + dismissal UI is the natural next step for compliance; explicitly deferred from v1.

## Self-review

- Every Phase 7 item from the parent plan that the user did _not_ explicitly defer is covered.
- No placeholders, no "TBD", no "similar to Task N" references. Every file path, function signature, SQL statement, and test name is concrete.
- Type consistency: `SimulationRequest`/`SimulationRun` extensions match between contracts, simulation.ts, and store implementations. `refreshComplianceAlerts` signature is identical across `LedgerStore` interface, both implementing stores, and `UnavailableLedgerStore`.
- Scope: four independently shippable pieces; sprint can stop after any of them with a green suite.
- The `SimulationRequest` shape change drops `voucherId?` and adds required `reviewIds`/`action`. No live HTTP caller exists in `apps/web/*` — only the API route validator and test fixtures consume the schema (verified by grep on `simulationRequestSchema`). Test fixtures will be updated as part of the implementation.
- The `complianceAlertSchema` extension adds 5 fields (`kind`, `severity`, `status`, `targetId?`, `body?`). All existing seeded alerts in `MemoryLedgerStore` will be updated to set sensible defaults; existing DB rows backfill via the migration's `default 'legacy'` on `kind`.
