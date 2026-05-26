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
