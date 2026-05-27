# Conventions

Rules and anti-patterns distilled from incidents in this repo. Update this file when a code review surfaces a recurring class of bug.

Each section names the rule, the failure pattern that motivates it, and the check that would have caught the original incident.

---

## 1. Schema-contract sync: a Zod field that lands in the DB must have a DB column

**Rule:** Whenever a field is added to a Zod schema that is read from or written to a `SupabaseLedgerStore` table, a migration must add (or already provide) the matching DB column with a compatible type. Confirm both directions: the column exists for writes, and the column matches the enum/CHECK/NOT NULL constraints the schema implies.

**The incident:** Phase 7 extended `complianceAlertSchema` with `severity`, `body`, `status` enum, etc. The upsert payload included `severity` and `body` columns that no migration ever added. Unit tests passed because the mock Supabase client doesn't validate column existence. Only a real-DB call would have caught it — and `pnpm test:integration` only runs when `SUPABASE_URL` is set.

**The check:**

- When adding/changing a Zod schema field, grep the codebase for the schema name and trace every write path. If a write touches a Supabase table, list the columns it writes; cross-reference against `supabase/migrations/*.sql`.
- For any contract enum that's also enforced by a DB CHECK constraint (e.g. `status`), the Zod enum members must be a subset of (or equal to) the CHECK members. **Pre-existing data can outlive a narrowing.** Widen the contract before deploying, narrow the DB CHECK in a separate migration only after the data is confirmed clean.
- If you cannot run integration tests against a real DB, the schema-change PR description must state which columns/tables were touched and what manual SQL check was run.

---

## 2. Unit tests with mocked clients do not prove DB compatibility

**Rule:** A unit test that uses a hand-rolled mock Supabase client cannot catch:

- Missing columns in the target table
- CHECK constraint mismatches
- Index/conflict-target mismatches
- Trigger interactions
- RLS policy effects

**The incident:** Three production-breaking bugs in Phase 7 (missing columns, narrowed enum, partial-index ON CONFLICT) all had passing unit tests because the mock client accepts any payload and returns whatever the test wires up.

**The check:**

- Any change that writes to a NEW column, uses a NEW conflict target, or relies on a NEW CHECK constraint MUST be backed by at least one of:
  - An integration test in `tests/integration/` exercised against a local Supabase (`pnpm test:integration` with `SUPABASE_URL` set)
  - A documented manual smoke test in the PR description (raw SQL or `node -e` snippet)
- PR review checklist: for every modified Supabase write path, ask "does any test other than the mock-client one actually exercise this?"

---

## 3. Partial unique indexes cannot be `ON CONFLICT` targets via PostgREST

**Rule:** Do not use `CREATE UNIQUE INDEX ... WHERE <predicate>` as the conflict target for a Supabase upsert. PostgREST's `onConflict` option only accepts column names; it cannot express the `WHERE` predicate that Postgres requires for partial-index inference. The upsert will fail with `42P10: no unique or exclusion constraint matching the ON CONFLICT specification`.

**The incident:** Phase 7's `ledger_alerts_dedup_uidx` was created with `WHERE target_id IS NOT NULL`. The Supabase upsert specified `onConflict: "organization_id,workspace_id,kind,target_id"` and failed in real DB.

**The pattern that works:**

- Use a FULL unique index (no `WHERE`). PostgreSQL's default `NULLS DISTINCT` means rows with a NULL column still don't collide, so you typically don't need the partial predicate at all.
- If you genuinely need different uniqueness rules for NULL vs non-NULL, use a sentinel value or a separate column instead of a partial index.

---

## 4. Cross-platform script execution: use `pathToFileURL` for `isMain` detection

**Rule:** When writing a Node ESM script that needs to detect whether it's been invoked directly or imported, never construct a `file://` URL by string concatenation. Use `node:url`'s `pathToFileURL` instead.

```ts
// WRONG — silently no-ops on Windows due to slash-count mismatch
const isMain = import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`;

// RIGHT — handles Windows drive letters and POSIX paths uniformly
import { pathToFileURL } from "node:url";
const argv1 = process.argv[1];
const isMain = argv1 !== undefined && import.meta.url === pathToFileURL(argv1).href;
```

**The incident:** The original `rebuild-projections.ts` produced `file://C:/path/file.ts` (2 slashes), but Node's `import.meta.url` for Windows absolute paths is `file:///C:/path/file.ts` (3 slashes). Running the script on Windows silently exited without executing `main()`.

---

## 5. Contract changes propagate to E2E tests, not just unit tests

**Rule:** Any change to a Zod schema validated by an API route is a contract change. Sweep ALL test layers — unit fixtures, integration tests, AND E2E specs — for callers and update payloads alongside the contract.

**The incident:** Phase 7 dropped `voucherId?` and added required `reviewIds`/`action` to `simulationRequestSchema`. Unit tests and a fixture were updated. The Playwright E2E in `tests/e2e/api.spec.ts:149` was missed and would have returned 400 in CI on the next run.

**The check:**

- After updating a Zod schema, run `grep -rn "<schemaName>" .` to find every reference, including in `tests/e2e/`.
- Search for the route path the schema validates (e.g. `/api/simulations/run`) — that catches callers that don't import the schema name directly.

---

## 6. Atomic contract changes: bundle interface + implementers in one commit

**Rule:** A change to a shared TypeScript interface (`LedgerStore`, contract types) MUST land atomically with every implementer. Do NOT split the interface change and the implementer updates across separate commits — even with TDD, each intermediate commit leaves `pnpm typecheck` red.

**The incident:** The original Phase 7 plan committed an interface extension before the Supabase implementer landed. The plan reviewer caught this and bundled them. Same pattern for the SimulationRequest schema change (4 commits combined into one) and the ComplianceAlert schema change (2 tasks bundled).

**The check:**

- A plan task that changes `LedgerStore` interface lists every implementer (`MemoryLedgerStore`, `SupabaseLedgerStore`, `UnavailableLedgerStore`, any test fakes) and commits all of them together.
- Same for Zod schemas used by the API route validator: the route's `parseBody(...)` call site, the demo-mode behavior, and the production-mode behavior all need to land atomically.

---

## 7. Falsy-zero and noUncheckedIndexedAccess guard rails

**Rule:** With `strict: true` and `noUncheckedIndexedAccess: true` (the project's tsconfig.base.json), test code MUST handle the indexed-access guard explicitly. `arr[0].field` is a type error; use `const first = arr[0]; assert.ok(first); first.field` or `arr[0]?.field` patterns.

**Avoid checks like `if (x)` when `x` may legitimately be `0`** (e.g. amount fields, delta values, counts). Prefer `if (x !== undefined)` or `if (x != null)` for nullable-numeric checks.

**The check:**

- Run `pnpm typecheck:tests` after any test edit — the dedicated tests/tsconfig.json gate (added in the May-20 hardening followups) catches these at build time.

---

## 8. Operational scripts: require explicit scope for destructive flags

**Rule:** Scripts that perform destructive writes must require an explicit `--scope` (org/workspace/tenant) when `--apply` is set. Refuse to run "across everything" in a single command — operators who want a global rebuild must script the loop themselves.

**The incident:** The first cut of `scripts/rebuild-projections.ts` accepted `--apply` with no `--org`/`--workspace` and would rewrite projections for every tenant in one go. A bug in any tenant's data would corrupt that tenant's projections without a recovery path.

**The pattern:**

```ts
if (apply && (!org || !workspace)) {
  console.error("--apply requires both --org and --workspace; refusing to rewrite across every tenant.");
  process.exit(2);
}
```

---

## 9. Migration safety: extension-creation must not abort the migration

**Rule:** `CREATE EXTENSION` for an optional extension (one that may not be on the Supabase project's allowlist) MUST be wrapped in a `DO ... EXCEPTION` block. A raw `CREATE EXTENSION` that throws aborts the entire migration transaction and prevents subsequent migrations from applying.

**The incident:** `20260526000000_enable_supa_audit.sql` initially had a bare `create extension if not exists supa_audit` followed by four `audit.enable_tracking(...)` calls. On a project where `supa_audit` was not pre-allowed, the migration would abort and the next migration (`compliance_alert_keys`, which carries code dependencies) would never run.

**The pattern:**

```sql
do $$
begin
  create extension if not exists <ext>;
  -- ... dependent setup ...
exception when others then
  raise notice '<ext> setup skipped: %', sqlerrm;
end
$$;
```

---

## 10. Citation provenance: never reuse another flow's citations as a fallback

**Rule:** Routes that return citation/source metadata in a regulated-audit context (Bokföringslagen, GDPR provenance) must never substitute another flow's citations as a placeholder. Return `[]` honestly when no citations are available.

**The incident:** `/api/knowledge/query` returned `snapshot.assistantExamples[0]?.citations ?? []`. While the SupabaseStore returned `citations: []`, the fallback evaluated to `[]` and the bug was invisible. After Phase 7's assistant scaffold landed a real citation, every subsequent `/api/knowledge/query` call attributed the scaffold's "Internal architecture policy" citation to arbitrary knowledge queries — wrong provenance in an audit-relevant code path.

**The check:**

- Any route returning `citations`, `sources`, `evidence`, or similar provenance metadata must derive them from the actual answer source. If a placeholder is needed, return `[]` and document the gap in a TODO/issue, not by reading another flow's data.

---

## 11. Store parity: Memory and Supabase must behave the same for the same `LedgerStore` method

**Rule:** When implementing a `LedgerStore` method on both `MemoryLedgerStore` and `SupabaseLedgerStore`, the observable behavior (identity, ordering, idempotency, persistence semantics) must match. Add a parity test that calls the same method on both stores with the same input and asserts the responses are equivalent (modulo IDs that are inherently random).

**The incident:** Initial Phase 7 implementations diverged:

- `refreshComplianceAlerts`: Memory minted fresh `createId('alert')` IDs each refresh; Supabase preserved IDs via upsert
- `refreshComplianceAlerts`: Memory wiped + re-detected; Supabase only inserted (never marked resolved)
- `answerAssistantQuestion`: `getSnapshot().assistantExamples` ordering depends on insert-time precision in Supabase but is deterministic in Memory

**The check:**

- For each new `LedgerStore` method, the test suite should include at least one assertion that compares Memory and Supabase outputs for the same input (using the existing mock-client pattern for Supabase). If the outputs intentionally differ, document why.
- Use deterministic IDs derived from the dedup key when the conceptual entity has a natural key (e.g. `alert_<kind>_<targetId>` for compliance alerts).

---

## 12. Date math: normalize precision before comparing

**Rule:** When comparing two timestamps to a threshold (days, hours), normalize both ends to the same precision first. Mixing a full ISO timestamp on one side with a date-only string on the other side introduces a ±1-unit drift dependent on time-of-day.

**The incident:** `daysBetween(voucher.createdAt, detectedAt)` compared a full timestamp (e.g. `2026-05-01T23:00:00Z`) to a midnight-UTC date (`2026-05-09T00:00:00Z`). A voucher created late at night fell on the wrong side of the 7-day threshold by ~1 hour. Fix: normalize both ends to date-only (`.slice(0, 10)` + `T00:00:00.000Z`).

**Also:** `Date.parse` returns `NaN` for malformed input. `Math.floor(NaN / DAY_MS) <= 7` is `false`, silently skipping the check. Always guard:

```ts
const ms = Date.parse(s);
if (Number.isNaN(ms)) throw new Error(`unparseable timestamp ${JSON.stringify(s)}`);
```

---

## 13. Append-only events are the source of truth — replay must reconstruct, not extrapolate

**Rule:** Recovery / projection-rebuild scripts must reconstruct read models from the events alone, not from the current state of mutable tables. A voucher row may have been edited after the original posting; using the current `voucher_fields` produces postings that don't match what was actually booked.

**The incident:** `scripts/rebuild-projections.ts` reads voucher fields from the current `ledger.vouchers` table, not from the `VoucherCreated` event payload. If there is ever a voucher-edit path, replay will diverge from history. Today this is acceptable (no edit path exists), but the script must be updated when one is added.

**The check:**

- Before adding a voucher edit/update path: ensure replay scripts read the voucher snapshot from the relevant event (`VoucherCreated` payload) rather than the current table state.

---

## 14. PR checklist before merging schema or contract changes

Before requesting review on a PR that touches `packages/contracts/src/`, `supabase/migrations/`, or `packages/domain/src/{store,supabase-store}.ts`:

- [ ] `pnpm typecheck && pnpm typecheck:tests && pnpm test:unit` green
- [ ] `pnpm test:integration` run (or noted as not-applicable) against a local Supabase if any write path changed
- [ ] Every modified Zod schema's writers traced; columns/CHECKs confirmed compatible (Rule 1)
- [ ] Every modified `LedgerStore` interface method implemented on Memory + Supabase + Unavailable (Rule 6) with parity test (Rule 11)
- [ ] E2E spec updated for any API-route schema change (Rule 5)
- [ ] Any new `CREATE EXTENSION` wrapped in `DO ... EXCEPTION` (Rule 9)
- [ ] PR description states which migrations need pre-flight verification on hosted Supabase

---

## 15. Symmetric fixes: grep for sibling code paths before declaring a bug fixed

**Rule:** When a bug is found in one code path, search the repo for the same anti-pattern in sibling paths and apply the fix symmetrically — or document in the commit why it doesn't apply. A targeted fix that leaves an identical bug in a parallel function is worse than no fix at all, because reviewers stop looking.

**The incident:** The first review surfaced "Supabase `refreshComplianceAlerts` doesn't hydrate suggestions for reviews with null embedded suggestion". The fix added hydration to `refreshComplianceAlerts`. But `runSimulation` in the same file has the same `reviews.map(r => r.suggestion)` pattern and the same null-embed silent skip — the fix was not applied symmetrically. The second review caught it; it would have shipped otherwise.

**The check:**

- After fixing a function, grep for the same data-access pattern (`r.suggestion`, `voucher.createdAt`, etc.) elsewhere in the same file and across both store implementations.
- The PR description's "what changed" section should explicitly call out: _"Applied to N call sites of this pattern; verified the remaining M sites do/do not need the same fix because <reason>."_

---

## 16. Domain errors thrown from `LedgerStore` methods need explicit HTTP-status mapping

**Rule:** A bare `throw new Error("...")` from a domain method that the API exposes will become a 500 with "Unexpected server error" from the catch-all in `services/api/src/app.ts`. For client-correctable failures (bad input, not-found, permission), throw either:

- An `HTTPException(status, { message })` from Hono, OR
- A dedicated error class with a matching branch in `app.onError` (pattern: see `LedgerStoreUnavailableError → 503`, `NotImplementedInSupabaseStore → 501`).

**The incident:** `runSimulation`'s new "review(s) not found in this workspace" check threw a vanilla Error. The route at `/api/simulations/run` has no try/catch, the global error handler doesn't recognize the error type, callers see opaque 500s for what is really a 404/422.

**The check:**

- Any new `throw new Error(...)` in `packages/domain/src/*` should be reviewed for: does this error surface via an HTTP route? If yes, decide the status code at throw-site (HTTPException) or define a class + add to the onError branch list.
- The PR review checklist for routes: confirm every thrown domain error has a mapping in `app.onError`.

---

## 17. Mutation discipline for shared/exposed state

**Rule:** When a method mutates an object that has also been returned to callers (e.g., via `getSnapshot()`), clone the object before mutating. Shared references + in-place mutation = spooky action at a distance, especially in `MemoryLedgerStore` which is a process-wide singleton in demo mode.

**The incident:** `MemoryLedgerStore.refreshComplianceAlerts` does `alert.status = "resolved"` directly on objects that `getSnapshot()` returns by reference. A caller who captured the snapshot earlier sees the status flip mid-flight on subsequent refresh calls.

**The pattern:**

```ts
// WRONG: mutates objects shared with prior callers
for (const alert of this.alerts) {
  if (shouldResolve(alert)) alert.status = "resolved";
}

// RIGHT: replace in array with new objects (immutable update)
this.alerts = this.alerts.map((alert) => (shouldResolve(alert) ? { ...alert, status: "resolved" } : alert));
```

**The check:**

- For any method that mutates fields of objects in `this.<collection>`, grep for places where that collection is returned (or whose elements are returned) and confirm callers don't rely on snapshot stability.
- Prefer immutable updates when the cost is small.

---

## 18. PostgreSQL migration pitfalls

**Rule:** These behaviors trip up migrations even when the SQL looks obviously correct:

**`ALTER TABLE ... ADD COLUMN IF NOT EXISTS ... CHECK (...)`:** the `IF NOT EXISTS` suppresses the ENTIRE clause, including the CHECK, when the column already exists from any prior partial run. The column will have no constraint.

```sql
-- WRONG: CHECK silently skipped if column exists
alter table foo add column if not exists severity text default 'info'
  check (severity in ('info', 'warning', 'critical'));

-- RIGHT: split column-add and constraint-add
alter table foo add column if not exists severity text default 'info';
do $$ begin
  alter table foo add constraint foo_severity_check check (severity in ('info', 'warning', 'critical'));
exception when duplicate_object then null;
end $$;
```

**`ON CONFLICT DO UPDATE`:** only writes columns named in the upsert payload. State transitions that should clear stale audit columns (e.g. `resolved_at`, `resolved_by` when status flips from 'resolved' back to 'open') must include those columns in the payload explicitly — otherwise the row ends up in an internally inconsistent state.

**`CREATE UNIQUE INDEX` without `NULLS NOT DISTINCT`:** PostgreSQL's default `NULLS DISTINCT` (PG 15+) means NULL values in the indexed columns don't collide with each other. If you intend NULLs to be deduplicated by the index (e.g. workspace-wide alerts with `target_id IS NULL`), add `NULLS NOT DISTINCT` — otherwise duplicates accumulate silently each upsert.

**`add column if not exists`:** the `if not exists` only checks the column name; it does NOT verify the column has the expected type or default. If a column was added previously with a different type, your migration is a silent no-op.

**The incidents:**

- Fix attempt for finding #1 (the original review) added `severity text not null default 'info' check (severity in (...))` to an `add column if not exists`. CHECK silently skips on re-apply.
- Fix attempt for finding #8 (Supabase resolve→reopen) doesn't clear `resolved_at`/`resolved_by` in the upsert payload, leaving rows status='open' with non-null resolution metadata.
- The dedup unique index without `NULLS NOT DISTINCT` works only because no current detector emits a null `target_id`.

---

## 19. PL/pgSQL exception scope: never `WHEN OTHERS` for optional-feature setup

**Rule:** `EXCEPTION WHEN OTHERS` catches every PL/pgSQL condition, including transient errors (`lock_not_available`, `statement_timeout`, `query_canceled`, `serialization_failure`, `deadlock_detected`) and silent failures (`insufficient_privilege` on the wrong role). Narrow the catch to the conditions you actually expect.

```sql
-- WRONG: hides real infrastructure failures as "feature unavailable"
do $$ begin
  create extension if not exists supa_audit;
  perform audit.enable_tracking('foo'::regclass);
exception when others then
  raise notice 'skipped: %', sqlerrm;
end $$;

-- RIGHT: catch only the conditions you mean
do $$ begin
  create extension if not exists supa_audit;
  perform audit.enable_tracking('foo'::regclass);
exception
  when feature_not_supported or undefined_object then
    raise notice 'supa_audit not available on this project, skipping';
end $$;
```

**The incident:** The fix to make `enable_supa_audit.sql` non-aborting used `WHEN OTHERS`. A transient lock or partial-success (audit enabled on 2 of 4 tables, then a failure on table 3) is silently downgraded to a NOTICE that Supabase logs rarely surface — and the migration commits with incomplete audit coverage.

---

## 20. Audit attribution: distinguish system actions from user actions

**Rule:** When a method auto-mutates state in response to a system condition (refresh, scheduled task, projection rebuild), the audit attribution (`resolved_by`, `updated_by`, `actor_id`) must NOT use the API caller's `ctx.userId`. Use a sentinel like `"system:auto-resolver"` or a separate column flagging the action as automated. The caller triggered a refresh, not a resolution decision.

**The incident:** `SupabaseLedgerStore.refreshComplianceAlerts` sets `resolved_by: this.ctx.userId` when auto-marking alerts as resolved. The DB records the human who called `POST /api/compliance-watch/refresh` as having resolved every alert that the refresh detected as no-longer-applicable. In 7-year Bokföringslagen audit replay, this looks like the user made N resolution decisions.

**The pattern:**

```ts
// WRONG
await store.update({ status: "resolved", resolved_by: this.ctx.userId });

// RIGHT — sentinel makes auto-resolution distinguishable
await store.update({ status: "resolved", resolved_by: "system:auto-resolver" });
```

---

## 21. Per-record error isolation in batch loops

**Rule:** When iterating a collection (vouchers, events, reviews) and applying a rule that can throw, isolate failures per-record. One bad record should not abort the whole batch. Wrap the per-record logic in try/catch and warn-log the failure; the batch continues.

**The incident:** `detectComplianceIssues` was hardened (correctly) to throw on malformed timestamps instead of silently propagating NaN. But the callers (`refreshComplianceAlerts` in both stores) don't catch — one bad voucher row aborts the entire `POST /api/compliance-watch/refresh` response with 500. A single corrupted timestamp bricks the workspace's compliance feed.

**The pattern:**

```ts
const alerts: ComplianceAlert[] = [];
const skipped: Array<{ voucherId: string; reason: string }> = [];
for (const voucher of vouchers) {
  try {
    const detected = detectForVoucher(voucher, reviews, today);
    alerts.push(...detected);
  } catch (err) {
    skipped.push({ voucherId: voucher.id, reason: String(err) });
  }
}
if (skipped.length > 0) console.warn("compliance: skipped malformed vouchers", skipped);
return alerts;
```

---

## 22. Timezone-safe date extraction from ISO timestamps

**Rule:** Don't `.slice(0, 10)` an ISO timestamp string to extract a date — the slice gives you the LOCAL date portion of whatever the string contained. For a timestamp with a non-UTC offset, this is the local date in that offset, not the UTC date. For day-boundary comparisons (e.g. "X days ago"), normalize to UTC first.

```ts
// WRONG: shifts the day for non-UTC timestamps
const date = voucher.createdAt.slice(0, 10);

// RIGHT: normalize via Date roundtrip
const date = new Date(voucher.createdAt).toISOString().slice(0, 10);
```

**The incident:** `voucher.createdAt='2026-05-01T23:00:00+02:00'` (Stockholm local, 21:00 UTC). `.slice(0, 10) = '2026-05-01'` (matches the offset-local date). Reparsed as midnight UTC, the comparison anchors to `2026-05-01T00:00:00Z` — a 21-hour shift from the true UTC instant. Near the 7-day threshold, this changes which calendar day triggers the alert.

**Codebase convention:** all timestamps in `ledger.*` should be stored in UTC (the schema uses `timestamptz`). Application code that writes them uses `nowIso()` (UTC). If those invariants hold, the slice approach happens to work — but the function should NOT depend on its inputs being UTC unless that's explicitly documented at the call site.

---

## 23. Dedup input arrays at the boundary

**Rule:** When an API method accepts an array of IDs, dedupe the input before length-checking or per-record processing. PostgreSQL's `.in(...)` operator deduplicates server-side; in-memory iteration in `MemoryLedgerStore` does not. Without explicit dedup at the boundary, the same input produces different results in demo vs normal mode.

**The incident:** `runSimulation({ reviewIds: ["r1", "r1"], ... })`:

- Memory: `this.reviews.get("r1")` returns the same review twice, `requestedReviews.length === input.reviewIds.length` passes the validation check, `simulateApprovals` iterates and doubles every debit/credit/vat delta.
- Supabase: `.in("id", ["r1", "r1"])` returns one row, `reviews.length=1 !== input.reviewIds.length=2`, throws "not found".

Same input, different behavior across runtime modes. Either is correct; the divergence is the bug.

**The pattern:**

```ts
const reviewIds = [...new Set(input.reviewIds)];
if (reviewIds.length === 0) throw new HTTPException(422, { message: "reviewIds must contain at least one unique id" });
// ... proceed with reviewIds
```

---

## 24. Lifecycle hooks: distinguish auto-state from user-state

**Rule:** When a state field (`status`, `phase`, `disposition`) is mutable by both an automated process (refresh, scheduler) AND a user action (dismiss, accept), DO NOT use the field's value alone to decide whether the automation should reverse the user's decision. Use a separate marker (`resolution_kind: 'auto' | 'human'`, `dismissed_by_user: boolean`) so the auto-process only touches its own state.

**The incident:** `MemoryLedgerStore.refreshComplianceAlerts` reopens any alert with `status === 'resolved'` if the underlying condition re-fires. Today only the refresh routine can write `'resolved'`, so this is correct. But the moment a user-dismiss UI lands writing `status='resolved'` for human reasons (e.g., "I've reviewed this and it's a false positive"), the very next refresh silently undoes the user's decision because the condition still holds.

**The pattern:**

- Use the wider enum (`open | acknowledged | resolved | dismissed`) to distinguish: `resolved` = auto-cleared, `dismissed` = user-acknowledged-and-ignored. Auto-process only reopens `resolved`, never `dismissed`.
- OR add a `resolution_kind text` column. Auto-process filters on `resolution_kind = 'auto'`.

---

## 25. Bounded accumulation: long-running in-memory state needs GC

**Rule:** Any in-memory collection that grows monotonically with usage must have a bound (max length, time-window, GC pass). `MemoryLedgerStore` is a process-wide singleton in demo mode — every alert that's ever fired accumulates indefinitely unless explicitly pruned.

**The incident:** `MemoryLedgerStore.alerts` accumulates indefinitely after the resolve-instead-of-delete fix. A long-running demo session that cycles vouchers through stale-blocked → resolved → re-blocked → resolved adds a row per cycle (deduped by deterministic ID, so at most 1 per condition, but `status` flips). Resolved alerts ship in every `getSnapshot()`/`refreshComplianceAlerts()` response forever.

**The pattern:**

- For demo/dev stores: add a time-window cap (drop resolved alerts older than 30 days) or a hard-cap (keep newest 1000).
- For production: the DB has the same issue; consider a partitioning/archival strategy when the table grows.

---

## 26. API response defaults: separate active state from historical state

**Rule:** Endpoints that return state collections (alerts, notifications, audit entries) should default to ACTIVE state only (e.g. `status IN ('open', 'acknowledged')`) and require an explicit `?includeResolved=true` or `?all=true` query param for historical entries. Mixing active and resolved in the default response forces every UI consumer to filter — and a naive consumer renders historical noise as active.

**The incident:** `POST /api/compliance-watch/refresh` returns ALL alerts including auto-resolved ones. There's no UI today, so no immediate impact, but the moment a UI table iterates without filtering, resolved entries show as live alerts. The route should default-exclude.

**The pattern:**

```ts
app.post("/api/compliance-watch/refresh", async (context) => {
  const includeResolved = context.req.query("includeResolved") === "true";
  const all = await context.get("store").refreshComplianceAlerts();
  const visible = includeResolved ? all : all.filter((a) => a.status === "open" || a.status === "acknowledged");
  return context.json(visible);
});
```
