# Track B Phase 7 — Data-Layer Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining Track B Phase 7 gaps so `SupabaseLedgerStore` reaches full data-layer parity with `MemoryLedgerStore`: ship a rebuild-from-events ops script, enable `supa_audit` on mutable tables, replace the fabricated `runSimulation` numbers with a real projection diff in both stores, lift the assistant scaffold into a shared helper, and add a deterministic `refreshComplianceAlerts` with two v1 rules.

**Architecture:** Continue on branch `deploy`, building on commit `254a986` (the design spec). Each task is independently shippable; the unit suite stays green between tasks. The four pieces ship in order — rebuild script → audit migration → simulation → assistant+compliance — so the high-risk contract change (simulation) lands after the pure-infra pieces. Pure functions (`simulation.ts`, `assistant.ts`, `compliance.ts`) hold the logic; both stores call them with their own data fetching.

**Tech Stack:** TypeScript 5.9 strict, pnpm monorepo, Hono 4, Zod v4 (`@jpx-accounting/contracts`), Supabase JS, `node:test` + `tsx`, Husky + lint-staged + Biome on commit.

**Junior-dev orientation:** The codebase ships every audit decision as an append-only event (see `packages/domain/src/supabase-store.ts` `appendEvent`). Pure domain functions live in `packages/domain/src/*.ts` and are exported via `packages/domain/src/index.ts`. The pattern to mirror for new shared helpers is `voucher-draft.ts` (introduced in commit `41e1136`) — pure function, both stores import and call it. The mock Supabase client used in tests is the chainable object in `tests/unit/supabase-store.test.ts`: builder methods (`select`, `eq`, `order`, `in`, `limit`) return `chain`; terminal methods (`maybeSingle`, `insert`, `update`, `upsert`) resolve `{ data, error }`. Reuse and extend it; do not invent a new mock shape.

**Spec:** [`docs/superpowers/specs/2026-05-26-track-b-phase-7-completion-design.md`](../specs/2026-05-26-track-b-phase-7-completion-design.md)

---

## Conventions used by every task

- Single unit test file: `npx tsx --test tests/unit/<file>.test.ts`
- Full unit suite: `pnpm test:unit`
- Type-check workspaces: `pnpm typecheck`
- Type-check tests: `pnpm typecheck:tests`
- Integration tests (env-gated): `pnpm test:integration`
- Pre-commit hook (Husky + lint-staged + Biome) reformats `.ts`/`.json`/`.md` on every commit. Expect imports to be reordered. Don't fight it; if a hook fails, fix the underlying issue, re-stage, re-commit.
- Commit messages follow Conventional Commits already in the log (`fix(scope):`, `perf(scope):`, `refactor(scope):`, `feat(scope):`, `test(scope):`, `docs(scope):`).
- `pnpm install` once at the top of the sprint — the `@supabase/supabase-js` import-time test failures observed during spec drafting were stale node_modules, not real regressions.

---

## File Structure

| File                                                 | Action                                                                                                     | Tasks       |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------- |
| `scripts/rebuild-projections.ts`                     | NEW — one-shot ops script                                                                                  | 1           |
| `tests/unit/rebuild-projections.test.ts`             | NEW                                                                                                        | 1           |
| `supabase/migrations/<ts>_enable_supa_audit.sql`     | NEW                                                                                                        | 2           |
| `supabase/migrations/20260324000000_schema_v2.sql`   | MODIFY — remove dead commented block                                                                       | 2           |
| `supabase/migrations/<ts>_compliance_alert_keys.sql` | NEW                                                                                                        | 9           |
| `packages/contracts/src/index.ts`                    | MODIFY — extend `SimulationRequest`, `SimulationRun`, `complianceAlertSchema`                              | 3, 8        |
| `packages/domain/src/simulation.ts`                  | NEW — shared `simulateApprovals` pure function                                                             | 4           |
| `packages/domain/src/assistant.ts`                   | NEW — shared `buildAssistantScaffold` pure function                                                        | 7           |
| `packages/domain/src/compliance.ts`                  | NEW — shared `detectComplianceIssues` pure function                                                        | 8           |
| `packages/domain/src/store.ts`                       | MODIFY — add `refreshComplianceAlerts` to interface; rewrite `runSimulation`; use `buildAssistantScaffold` | 4, 5, 7, 10 |
| `packages/domain/src/supabase-store.ts`              | MODIFY — rewrite `runSimulation`; use scaffold; new `refreshComplianceAlerts`                              | 6, 7, 11    |
| `packages/domain/src/supabase-mappers.ts`            | MODIFY — `mapComplianceAlertRow` reads the new columns                                                     | 9           |
| `packages/domain/src/index.ts`                       | MODIFY — export `simulation`, `assistant`, `compliance`                                                    | 4, 7, 8     |
| `services/api/src/store-factory.ts`                  | MODIFY — `UnavailableLedgerStore.refreshComplianceAlerts`                                                  | 10          |
| `services/api/src/app.ts`                            | MODIFY — wire `POST /api/compliance-watch/refresh` to the real method                                      | 12          |
| `tests/unit/simulation.test.ts`                      | NEW                                                                                                        | 4           |
| `tests/unit/assistant.test.ts`                       | NEW                                                                                                        | 7           |
| `tests/unit/compliance.test.ts`                      | NEW                                                                                                        | 8           |
| `tests/unit/ledger-store.test.ts`                    | EXTEND                                                                                                     | 5, 7, 10    |
| `tests/unit/supabase-store.test.ts`                  | EXTEND                                                                                                     | 6, 7, 11    |
| `docs/DEV_STATUS.md`                                 | MODIFY — mark Phase 7 items Done                                                                           | 13          |

---

# Phase 1 — Projection rebuild script

The rebuild script is intentionally first: it touches no domain code, no contracts, no API routes — pure ops tooling. Landing it first proves the events-are-source-of-truth invariant and gives later tasks a debugging tool.

### Task 1: One-shot rebuild script with dry-run default

**Files:**

- Create: `scripts/rebuild-projections.ts`
- Create: `tests/unit/rebuild-projections.test.ts`

The script extracts a pure replay function so the test can verify replay without running the whole script (which needs env vars and a live DB). The script body wires that function to a Supabase client.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/rebuild-projections.test.ts` with:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { replayJournalLinesFromEvents } from "../../scripts/rebuild-projections";

test("replayJournalLinesFromEvents reconstructs lines from PostedToLedger events", () => {
  const voucher = {
    id: "v1",
    voucherFields: {
      grossAmount: 1249,
      netAmount: 999.2,
      vatAmount: 249.8,
      description: "OpenAI subscription",
    },
  };
  const events = [
    {
      event_type: "EvidenceReceived",
      payload: {},
      occurred_at: "2026-05-01T00:00:00.000Z",
      organization_id: "o",
      workspace_id: "w",
    },
    {
      event_type: "PostedToLedger",
      payload: {
        action: "approve",
        suggestion: {
          id: "s1",
          voucherId: "v1",
          accountNumber: "6540",
          accountName: "IT-tjänster",
          vatCode: "VAT25",
          confidence: 0.9,
          reasoning: "r",
          kind: "recommendation",
          citations: [],
          ruleHits: [],
        },
      },
      aggregate_id: "v1",
      occurred_at: "2026-05-02T00:00:00.000Z",
      organization_id: "o",
      workspace_id: "w",
    },
  ];
  const vouchersById = new Map([["v1", voucher]]);

  const lines = replayJournalLinesFromEvents(events, vouchersById);
  assert.equal(lines.length, 3, "approve emits 3 posting lines (debit, vat, credit)");
  assert.equal(lines[0].account_number, "6540");
  assert.equal(Number(lines[0].debit), 999.2);
  assert.equal(lines[0].voucher_id, "v1");
  assert.equal(lines[0].organization_id, "o");
});

test("replayJournalLinesFromEvents skips non-PostedToLedger events", () => {
  const events = [
    {
      event_type: "EvidenceReceived",
      payload: {},
      organization_id: "o",
      workspace_id: "w",
    },
  ];
  const lines = replayJournalLinesFromEvents(events, new Map());
  assert.deepEqual(lines, []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/unit/rebuild-projections.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Create the script with the exported pure function**

Create `scripts/rebuild-projections.ts` with:

```ts
#!/usr/bin/env -S tsx
// Replay ledger.events into projections.journal_entries. Dry-run by default.
//
// Usage:
//   tsx scripts/rebuild-projections.ts [--org <id>] [--workspace <id>] [--apply]
//
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY (required even for dry-run; refusal
// without them prevents anon-key footguns).
//
// Writes only to projections.* — never touches ledger.* (the legal record).

import { createClient } from "@supabase/supabase-js";

import { buildPostingLines } from "@jpx-accounting/domain";

type EventRow = {
  event_type: string;
  payload: { action?: "approve" | "book-without-vat"; suggestion?: Parameters<typeof buildPostingLines>[1] };
  aggregate_id?: string;
  occurred_at: string;
  organization_id: string;
  workspace_id: string;
};

type VoucherLite = { id: string; voucherFields: Parameters<typeof buildPostingLines>[0]["voucherFields"] };

export function replayJournalLinesFromEvents(events: EventRow[], vouchersById: Map<string, VoucherLite>) {
  const lines: Array<Record<string, unknown>> = [];
  for (const event of events) {
    if (event.event_type !== "PostedToLedger") continue;
    const action = event.payload.action;
    const suggestion = event.payload.suggestion;
    if (!action || !suggestion || !event.aggregate_id) continue;
    const voucher = vouchersById.get(event.aggregate_id);
    if (!voucher) continue; // voucher hard-deleted (shouldn't happen but skip silently)
    const postingLines = buildPostingLines(
      voucher as Parameters<typeof buildPostingLines>[0],
      suggestion,
      action,
      event.occurred_at,
    );
    for (const line of postingLines) {
      lines.push({
        organization_id: event.organization_id,
        workspace_id: event.workspace_id,
        voucher_id: line.voucherId,
        account_number: line.accountNumber,
        account_name: line.accountName,
        description: line.description,
        debit: line.debit,
        credit: line.credit,
        vat_code: line.vatCode,
        deductible: line.deductible,
        booked_at: line.bookedAt,
      });
    }
  }
  return lines;
}

function parseArgs(argv: string[]) {
  const args: { org?: string; workspace?: string; apply: boolean } = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--org") args.org = argv[++i];
    else if (argv[i] === "--workspace") args.workspace = argv[++i];
    else if (argv[i] === "--apply") args.apply = true;
  }
  return args;
}

async function main() {
  const { org, workspace, apply } = parseArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");
    process.exit(2);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Pull events + vouchers, scoped if requested.
  const eventsQuery = supabase
    .schema("ledger")
    .from("events")
    .select("*")
    .order("sequence_number", { ascending: true });
  if (org) eventsQuery.eq("organization_id", org);
  if (workspace) eventsQuery.eq("workspace_id", workspace);
  const { data: events, error: eErr } = await eventsQuery;
  if (eErr) {
    console.error(`Failed to read events: ${eErr.message}`);
    process.exit(3);
  }

  const vouchersQuery = supabase.schema("ledger").from("vouchers").select("*");
  if (org) vouchersQuery.eq("organization_id", org);
  if (workspace) vouchersQuery.eq("workspace_id", workspace);
  const { data: vouchers, error: vErr } = await vouchersQuery;
  if (vErr) {
    console.error(`Failed to read vouchers: ${vErr.message}`);
    process.exit(3);
  }
  const vouchersById = new Map((vouchers ?? []).map((v) => [v.id, { id: v.id, voucherFields: v.voucher_fields }]));

  const lines = replayJournalLinesFromEvents(events ?? [], vouchersById);

  // Group by scope for the summary + the optional write.
  const byScope = new Map();
  for (const line of lines) {
    const k = `${line.organization_id}/${line.workspace_id}`;
    if (!byScope.has(k)) byScope.set(k, []);
    byScope.get(k).push(line);
  }

  console.log(`Replayed ${lines.length} journal lines across ${byScope.size} scope(s).`);
  for (const [scope, scopeLines] of byScope) console.log(`  ${scope}: ${scopeLines.length} lines`);

  if (!apply) {
    console.log("Dry-run (no --apply): no rows written.");
    return;
  }

  for (const [scope, scopeLines] of byScope) {
    const [orgId, wsId] = scope.split("/");
    // Truncate then re-insert. The aggregate trigger (hardening Task 9) only
    // fires on INSERT, so we must DELETE aggregates too and let inserts rebuild.
    const del1 = await supabase
      .schema("projections")
      .from("journal_entries")
      .delete()
      .eq("organization_id", orgId)
      .eq("workspace_id", wsId);
    if (del1.error) {
      console.error(`Failed to clear journal_entries for ${scope}: ${del1.error.message}`);
      process.exit(4);
    }
    const del2 = await supabase
      .schema("projections")
      .from("account_balances")
      .delete()
      .eq("organization_id", orgId)
      .eq("workspace_id", wsId);
    if (del2.error) {
      console.error(`Failed to clear account_balances for ${scope}: ${del2.error.message}`);
      process.exit(4);
    }
    const del3 = await supabase
      .schema("projections")
      .from("vat_summary")
      .delete()
      .eq("organization_id", orgId)
      .eq("workspace_id", wsId);
    if (del3.error) {
      console.error(`Failed to clear vat_summary for ${scope}: ${del3.error.message}`);
      process.exit(4);
    }
    if (scopeLines.length > 0) {
      const ins = await supabase.schema("projections").from("journal_entries").insert(scopeLines);
      if (ins.error) {
        console.error(`Failed to insert ${scope}: ${ins.error.message}`);
        process.exit(4);
      }
    }
    console.log(`  ${scope}: applied ${scopeLines.length} lines`);
  }
}

// Run only when invoked as a script, not when imported by tests.
const argv1 = process.argv[1] ?? "";
const isMain = import.meta.url === `file://${argv1.replace(/\\/g, "/")}`;
if (isMain) await main();
```

The TypeScript script uses the workspace package alias `@jpx-accounting/domain` — tsx (used by both `pnpm test:unit` and direct script invocation) resolves it through pnpm's symlinks. No prior build step required.

- [ ] **Step 4: Run the test — expect PASS**

Run: `npx tsx --test tests/unit/rebuild-projections.test.ts`
Expected: 2/2 tests pass.

- [ ] **Step 5: Smoke-test the dry-run mode (optional, requires Supabase env)**

If `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are set, run:
`npx tsx scripts/rebuild-projections.ts --org org_jpx --workspace workspace_main`
Expected: prints replay summary; no rows written; exits 0. If the env vars are absent, exits 2 with a clear message.

- [ ] **Step 6: Full suite still green**

Run: `pnpm test:unit && pnpm typecheck && pnpm typecheck:tests`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add scripts/rebuild-projections.mjs tests/unit/rebuild-projections.test.ts
git commit -m "feat(scripts): rebuild projections from ledger events (dry-run by default)"
```

---

# Phase 2 — supa_audit migration

### Task 2: Enable supa_audit on the four mutable tables

**Files:**

- Create: `supabase/migrations/<ts>_enable_supa_audit.sql` (use `supabase migration new enable_supa_audit` to generate the timestamped filename)
- Modify: `supabase/migrations/20260324000000_schema_v2.sql:374-378` (remove dead commented block)

**Pre-flight (one-time, before merging):** verify `supa_audit` is in the hosted Supabase project's extension allowlist. Run:

```sql
select * from pg_available_extensions where name = 'supa_audit';
```

against the hosted DB (Supabase SQL editor). If it returns zero rows, **stop**: file a Supabase support request to enable it, and shelve this task until that's resolved. The rest of the sprint does not depend on it.

- [ ] **Step 1: Generate the migration file**

Run: `supabase migration new enable_supa_audit`
This creates `supabase/migrations/<UTC timestamp>_enable_supa_audit.sql`.

- [ ] **Step 2: Fill in the migration body**

Replace the empty file with:

```sql
-- Enables supa_audit row-history tracking on the four mutable ledger tables.
-- The append-only ledger.events table does not need this (already immutable
-- via the existing INSERT-only trigger from schema_v2.sql).

create extension if not exists supa_audit;

select audit.enable_tracking('ledger.vouchers'::regclass);
select audit.enable_tracking('ledger.review_tasks'::regclass);
select audit.enable_tracking('ledger.compliance_alerts'::regclass);
select audit.enable_tracking('ledger.assistant_sessions'::regclass);
```

- [ ] **Step 3: Remove the dead commented block from schema_v2.sql**

Open `supabase/migrations/20260324000000_schema_v2.sql`. Find lines 374-378 (locate by the comment `-- create extension if not exists supa_audit;`). Delete the entire commented block (5 lines) so that historical migration files don't contain dead instructions about extensions/tracking that have since moved elsewhere.

- [ ] **Step 4: Apply locally and verify**

Run: `supabase db reset`
Expected: migration applies cleanly; `audit` schema is created; `audit.record_history` table exists.

Verify tracking is active:

```bash
node -e "import('@supabase/supabase-js').then(async ({createClient})=>{const s=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY);const {data}=await s.schema('audit').from('record_history').select('id').limit(1);console.log('audit.record_history reachable:',data!==undefined);})"
```

Expected: prints `audit.record_history reachable: true`.

- [ ] **Step 5: Verify suite still green**

Run: `pnpm test:unit && pnpm typecheck && pnpm typecheck:tests`
Expected: all green (no code change; migration only).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(supabase): enable supa_audit row-history on mutable ledger tables"
```

---

# Phase 3 — Real runSimulation

### Task 3: Extend SimulationRequest and SimulationRun contracts

**Files:**

- Modify: `packages/contracts/src/index.ts` (lines 204-210 for `simulationRunSchema`, 288-293 for `simulationRequestSchema`)
- Test: `tests/unit/contracts-simulation.test.ts` (NEW)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/contracts-simulation.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { simulationRequestSchema, simulationRunSchema } from "@jpx-accounting/contracts";

test("simulationRequestSchema requires reviewIds and action", () => {
  const ok = simulationRequestSchema.parse({
    actorId: "user_a",
    title: "What if I approve these",
    scenario: "approve 2 pending",
    reviewIds: ["r1", "r2"],
    action: "approve",
  });
  assert.equal(ok.reviewIds.length, 2);
  assert.equal(ok.action, "approve");

  assert.throws(
    () =>
      simulationRequestSchema.parse({
        actorId: "u",
        title: "t",
        scenario: "s",
        reviewIds: [],
        action: "approve",
      }),
    /at least 1|min/i,
  );

  assert.throws(
    () =>
      simulationRequestSchema.parse({
        actorId: "u",
        title: "t",
        scenario: "s",
        reviewIds: ["r1"],
        action: "delete",
      }),
    /enum|invalid/i,
  );
});

test("simulationRunSchema requires balanceDelta and vatDelta", () => {
  const ok = simulationRunSchema.parse({
    id: "sim_1",
    title: "t",
    scenario: "s",
    outcomeSummary: "ok",
    affectedAccounts: ["6540", "2641", "1930"],
    balanceDelta: [{ accountNumber: "6540", accountName: "IT", deltaDebit: 999.2, deltaCredit: 0 }],
    vatDelta: [{ vatCode: "VAT25", deltaBase: 999.2, deltaAmount: 249.8 }],
  });
  assert.equal(ok.balanceDelta.length, 1);
});
```

- [ ] **Step 2: Run the test — expect FAIL**

Run: `npx tsx --test tests/unit/contracts-simulation.test.ts`
Expected: FAIL — the schemas reject the new fields or accept the old shape without them.

- [ ] **Step 3: Update simulationRequestSchema**

In `packages/contracts/src/index.ts:288-293`, replace:

```ts
export const simulationRequestSchema = z.object({
  actorId: z.string(),
  title: z.string(),
  scenario: z.string(),
  voucherId: z.string().optional(),
});
```

with:

```ts
export const simulationRequestSchema = z.object({
  actorId: z.string(),
  title: z.string(),
  scenario: z.string(),
  reviewIds: z.array(z.string()).min(1).max(50),
  action: z.enum(["approve", "book-without-vat"]),
});
```

The `voucherId?` field is removed — no live caller used it (verified against `apps/web/*`).

- [ ] **Step 4: Update simulationRunSchema**

In `packages/contracts/src/index.ts:204-210`, replace:

```ts
export const simulationRunSchema = z.object({
  id: z.string(),
  title: z.string(),
  scenario: z.string(),
  outcomeSummary: z.string(),
  affectedAccounts: z.array(z.string()),
});
```

with:

```ts
export const simulationRunSchema = z.object({
  id: z.string(),
  title: z.string(),
  scenario: z.string(),
  outcomeSummary: z.string(),
  affectedAccounts: z.array(z.string()),
  balanceDelta: z.array(
    z.object({
      accountNumber: z.string(),
      accountName: z.string(),
      deltaDebit: z.number(),
      deltaCredit: z.number(),
    }),
  ),
  vatDelta: z.array(
    z.object({
      vatCode: z.string(),
      deltaBase: z.number(),
      deltaAmount: z.number(),
    }),
  ),
});
```

- [ ] **Step 5: Run the test — expect PASS**

Run: `npx tsx --test tests/unit/contracts-simulation.test.ts`
Expected: 2/2 pass.

- [ ] **Step 6: Typecheck — fix call-site fallout**

Run: `pnpm typecheck`
Expected: errors in `packages/domain/src/store.ts` (`MemoryLedgerStore.runSimulation` returns the old shape) and `packages/domain/src/supabase-store.ts` (throws so no issue) and possibly tests. Leave the errors in place — Tasks 4–6 will fix them.

Acceptable interim state: `runSimulation` implementations are now type-broken. They will be fixed in the next 3 tasks. **Do not commit this task alone.** Commit happens at the end of Task 6 with the type-fix.

If you must commit something now to checkpoint, add a temporary `// @ts-expect-error` only at the `MemoryLedgerStore.runSimulation` return statement and remove it in Task 5. Prefer rolling forward.

- [ ] **Step 7: Hold — do not commit yet**

Proceed to Task 4. The contract change commits together with the implementation in Task 6.

---

### Task 4: simulateApprovals pure function

**Files:**

- Create: `packages/domain/src/simulation.ts`
- Modify: `packages/domain/src/index.ts` (add export)
- Test: `tests/unit/simulation.test.ts` (NEW)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/simulation.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import type { AccountingSuggestion, ReviewTask, Voucher } from "@jpx-accounting/contracts";
import { simulateApprovals } from "@jpx-accounting/domain";

const voucherFixture = (id: string, overrides: Partial<Voucher["voucherFields"]> = {}): Voucher => ({
  id,
  organizationId: "o",
  workspaceId: "w",
  evidencePacketId: "p",
  voucherNumber: `V-${id}`,
  status: "needs-review",
  accountingMethod: "invoice",
  extractedFields: [],
  voucherFields: {
    grossAmount: 1249,
    netAmount: 999.2,
    vatAmount: 249.8,
    vatRate: 25,
    currency: "SEK",
    description: "Test",
    ...overrides,
  },
  createdAt: "2026-05-01T00:00:00.000Z",
  createdBy: "u",
});

const suggestionFixture = (voucherId: string, account = "6540"): AccountingSuggestion => ({
  id: `s_${voucherId}`,
  voucherId,
  accountNumber: account,
  accountName: "IT-tjänster",
  vatCode: "VAT25",
  confidence: 0.9,
  reasoning: "r",
  kind: "recommendation",
  citations: [],
  ruleHits: [],
});

const reviewFixture = (voucherId: string): ReviewTask => ({
  id: `r_${voucherId}`,
  voucherId,
  title: `Review ${voucherId}`,
  status: "needs-review",
  suggestedAction: "Approve",
  suggestion: suggestionFixture(voucherId),
  provenanceTimeline: [],
});

test("simulateApprovals computes balance delta and vat delta for approve", () => {
  const v = voucherFixture("v1");
  const result = simulateApprovals([reviewFixture("v1")], [suggestionFixture("v1")], [v], "approve");
  // One voucher, approve → 3 posting lines aggregated by account:
  //   6540 debit 999.2, 2641 debit 249.8, 1930 credit 1249
  assert.equal(result.balanceDelta.length, 3);
  const it = result.balanceDelta.find((b) => b.accountNumber === "6540");
  assert.equal(it?.deltaDebit, 999.2);
  const vat = result.balanceDelta.find((b) => b.accountNumber === "2641");
  assert.equal(vat?.deltaDebit, 249.8);
  const bank = result.balanceDelta.find((b) => b.accountNumber === "1930");
  assert.equal(bank?.deltaCredit, 1249);
  assert.deepEqual(result.affectedAccounts.sort(), ["1930", "2641", "6540"]);
  assert.equal(result.vatDelta.find((v) => v.vatCode === "VAT25")?.deltaAmount, 249.8);
});

test("simulateApprovals book-without-vat zeroes the VAT line", () => {
  const v = voucherFixture("v1");
  const result = simulateApprovals([reviewFixture("v1")], [suggestionFixture("v1")], [v], "book-without-vat");
  const vatLine = result.balanceDelta.find((b) => b.accountNumber === "2641");
  assert.equal(vatLine?.deltaDebit, 0);
});

test("simulateApprovals skips reviews whose voucher is missing", () => {
  const result = simulateApprovals(
    [reviewFixture("v1"), reviewFixture("v2")],
    [suggestionFixture("v1"), suggestionFixture("v2")],
    [voucherFixture("v1")], // v2 missing
    "approve",
  );
  // Only v1 contributes; still 3 distinct accounts.
  assert.equal(result.balanceDelta.length, 3);
});

test("simulateApprovals aggregates across multiple reviews on the same account", () => {
  const result = simulateApprovals(
    [reviewFixture("v1"), reviewFixture("v2")],
    [suggestionFixture("v1"), suggestionFixture("v2")],
    [voucherFixture("v1"), voucherFixture("v2")],
    "approve",
  );
  const it = result.balanceDelta.find((b) => b.accountNumber === "6540");
  assert.equal(it?.deltaDebit, 999.2 * 2);
});
```

- [ ] **Step 2: Run the test — expect FAIL**

Run: `npx tsx --test tests/unit/simulation.test.ts`
Expected: FAIL — `simulateApprovals` is not exported.

- [ ] **Step 3: Create `packages/domain/src/simulation.ts`**

```ts
import type { AccountingSuggestion, ReviewTask, SimulationRun, Voucher } from "@jpx-accounting/contracts";

import { buildPostingLines } from "./posting";
import type { ReviewAction } from "./store";

type BalanceDelta = SimulationRun["balanceDelta"];
type VatDelta = SimulationRun["vatDelta"];

export function simulateApprovals(
  reviews: ReviewTask[],
  suggestions: AccountingSuggestion[],
  vouchers: Voucher[],
  action: ReviewAction,
): { balanceDelta: BalanceDelta; vatDelta: VatDelta; affectedAccounts: string[] } {
  const suggestionsByVoucher = new Map(suggestions.map((s) => [s.voucherId, s]));
  const vouchersById = new Map(vouchers.map((v) => [v.id, v]));

  // accountNumber -> { name, debit, credit }
  const balanceAcc = new Map<string, { name: string; debit: number; credit: number }>();
  // vatCode -> { base, amount }
  const vatAcc = new Map<string, { base: number; amount: number }>();

  for (const review of reviews) {
    const voucher = vouchersById.get(review.voucherId);
    const suggestion = suggestionsByVoucher.get(review.voucherId) ?? review.suggestion;
    if (!voucher || !suggestion) continue;
    const lines = buildPostingLines(voucher, suggestion, action === "reject" ? "approve" : action, voucher.createdAt);
    for (const line of lines) {
      const entry = balanceAcc.get(line.accountNumber) ?? { name: line.accountName, debit: 0, credit: 0 };
      entry.debit += line.debit;
      entry.credit += line.credit;
      balanceAcc.set(line.accountNumber, entry);
      const base = line.debit !== 0 ? line.debit : line.credit;
      const isVatLine = line.accountNumber === "2641";
      const v = vatAcc.get(line.vatCode) ?? { base: 0, amount: 0 };
      v.base += base;
      if (isVatLine) v.amount += line.debit - line.credit;
      vatAcc.set(line.vatCode, v);
    }
  }

  const balanceDelta: BalanceDelta = [...balanceAcc].map(([accountNumber, e]) => ({
    accountNumber,
    accountName: e.name,
    deltaDebit: e.debit,
    deltaCredit: e.credit,
  }));
  const vatDelta: VatDelta = [...vatAcc].map(([vatCode, v]) => ({
    vatCode,
    deltaBase: v.base,
    deltaAmount: v.amount,
  }));
  const affectedAccounts = [...balanceAcc.keys()];

  return { balanceDelta, vatDelta, affectedAccounts };
}
```

Note: `action === "reject" ? "approve" : action` — `reject` is in the `ReviewAction` union but is nonsensical for a simulation (rejecting a review produces no postings). We treat it as `approve` for the diff; the route caller passes only `"approve" | "book-without-vat"` per the schema, so this branch is defensive.

- [ ] **Step 4: Export from `packages/domain/src/index.ts`**

Add to `packages/domain/src/index.ts` in alphabetical order (after `./rules` or wherever the alphabetical position is):

```ts
export * from "./simulation";
```

- [ ] **Step 5: Run the test — expect PASS**

Run: `npx tsx --test tests/unit/simulation.test.ts`
Expected: 4/4 pass.

- [ ] **Step 6: Hold — do not commit yet**

Continue to Task 5. The simulation work commits together at the end of Task 6.

---

### Task 5: MemoryLedgerStore.runSimulation uses simulateApprovals

**Files:**

- Modify: `packages/domain/src/store.ts` (the existing `runSimulation` method, around line 437)
- Test: `tests/unit/ledger-store.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/ledger-store.test.ts`:

```ts
test("MemoryLedgerStore.runSimulation returns real projection deltas and writes no journal lines", async () => {
  const store = new MemoryLedgerStore();
  // The seeded store has at least one needs-review entry from seedDemoData.
  const reviews = await store.getReviewFeed();
  const target = reviews[0];
  assert.ok(target, "seed must include at least one review");

  const reportsBefore = await store.getReports();

  const sim = await store.runSimulation({
    actorId: "user_test",
    title: "What if I approve the seeded review",
    scenario: "approve 1 pending",
    reviewIds: [target.id],
    action: "approve",
  });

  assert.ok(sim.balanceDelta.length > 0, "balance delta non-empty");
  assert.ok(sim.affectedAccounts.includes("2641"), "input VAT must be in affected accounts");

  const reportsAfter = await store.getReports();
  assert.deepEqual(reportsAfter, reportsBefore, "runSimulation must not mutate ledger state");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/unit/ledger-store.test.ts`
Expected: FAIL — the current `runSimulation` returns the old `SimulationRun` shape (no `balanceDelta`/`vatDelta`) and the contract schema (from Task 3) rejects the result.

- [ ] **Step 3: Rewrite `MemoryLedgerStore.runSimulation`**

In `packages/domain/src/store.ts`, locate `async runSimulation(input: SimulationRequest): Promise<SimulationRun>` (around line 437). Replace the entire method body with:

```ts
async runSimulation(input: SimulationRequest): Promise<SimulationRun> {
  const requestedReviews = input.reviewIds
    .map((id) => this.reviews.get(id))
    .filter((r): r is ReviewTask => Boolean(r));
  const requestedVouchers = requestedReviews
    .map((r) => this.vouchers.get(r.voucherId))
    .filter((v): v is Voucher => Boolean(v));
  const requestedSuggestions = requestedVouchers
    .map((v) => this.suggestions.get(v.id))
    .filter((s): s is AccountingSuggestion => Boolean(s));

  const { balanceDelta, vatDelta, affectedAccounts } = simulateApprovals(
    requestedReviews,
    requestedSuggestions,
    requestedVouchers,
    input.action,
  );

  const result: SimulationRun = {
    id: createId("sim"),
    title: input.title,
    scenario: input.scenario,
    outcomeSummary: `Simulated ${requestedReviews.length} review(s); ${affectedAccounts.length} accounts affected. No production postings were changed.`,
    affectedAccounts,
    balanceDelta,
    vatDelta,
  };

  this.appendEvent({
    organizationId: defaultOrganizationId,
    workspaceId: defaultWorkspaceId,
    aggregateType: "simulation",
    aggregateId: result.id,
    eventType: "SimulationExecuted",
    actorId: input.actorId,
    occurredAt: nowIso(),
    payload: result,
  });

  return result;
}
```

Add the import for `simulateApprovals` at the top of `store.ts` (alphabetical):

```ts
import { simulateApprovals } from "./simulation";
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `npx tsx --test tests/unit/ledger-store.test.ts`
Expected: all tests pass including the new one.

- [ ] **Step 5: Hold — do not commit yet**

Proceed to Task 6.

---

### Task 6: SupabaseLedgerStore.runSimulation uses simulateApprovals

**Files:**

- Modify: `packages/domain/src/supabase-store.ts` (lines 740-742, the current `runSimulation` throw)
- Test: `tests/unit/supabase-store.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/supabase-store.test.ts`:

```ts
test("SupabaseLedgerStore.runSimulation fetches scope-matched reviews/vouchers and returns deltas", async () => {
  const reviewRow = {
    id: "r1",
    organization_id: "org_a",
    workspace_id: "ws_a",
    voucher_id: "v1",
    title: "Review V-1",
    status: "needs-review",
    suggested_action: "Approve",
    suggestion: {
      id: "s1",
      voucherId: "v1",
      accountNumber: "6540",
      accountName: "IT-tjänster",
      vatCode: "VAT25",
      confidence: 0.9,
      reasoning: "r",
      kind: "recommendation",
      citations: [],
      ruleHits: [],
    },
    provenance_timeline: [],
  };
  const voucherRow = {
    id: "v1",
    organization_id: "org_a",
    workspace_id: "ws_a",
    evidence_packet_id: "p1",
    voucher_number: "V-1",
    status: "needs-review",
    accounting_method: "invoice",
    extracted_fields: [],
    voucher_fields: {
      grossAmount: 1249,
      netAmount: 999.2,
      vatAmount: 249.8,
      vatRate: 25,
      currency: "SEK",
      description: "Test",
    },
    created_at: "2026-05-01T00:00:00.000Z",
    created_by: "u",
  };
  const inserted: Record<string, unknown>[] = [];
  const client = {
    schema: () => ({
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "order", "limit", "in"]) chain[m] = () => chain;
        chain.maybeSingle = async () => ({ data: null, error: null });
        // .in("id", reviewIds) terminal for reviews; .in("id", voucherIds) for vouchers
        chain.then = (resolve: (v: { data: unknown; error: null }) => void) => {
          if (table === "review_tasks") return resolve({ data: [reviewRow], error: null });
          if (table === "vouchers") return resolve({ data: [voucherRow], error: null });
          if (table === "events") return resolve({ data: null, error: null });
          return resolve({ data: [], error: null });
        };
        chain.insert = async (row: Record<string, unknown>) => {
          if (table === "events") inserted.push(row);
          return { error: null };
        };
        return chain;
      },
    }),
  } as never;
  const store = new SupabaseLedgerStore(client, { organizationId: "org_a", workspaceId: "ws_a", userId: "u" });

  const sim = await store.runSimulation({
    actorId: "u",
    title: "What if",
    scenario: "approve 1",
    reviewIds: ["r1"],
    action: "approve",
  });

  assert.equal(sim.affectedAccounts.length, 3);
  assert.ok(sim.balanceDelta.find((b) => b.accountNumber === "6540" && b.deltaDebit === 999.2));
  const simEvent = inserted.find((e) => e.event_type === "SimulationExecuted");
  assert.ok(simEvent, "SimulationExecuted event must be persisted");
  assert.equal(simEvent.actor_id, "u", "actor_id is the authenticated user");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/unit/supabase-store.test.ts`
Expected: FAIL — currently `runSimulation` throws `NotImplementedInSupabaseStore`.

- [ ] **Step 3: Replace `runSimulation` in `supabase-store.ts`**

In `packages/domain/src/supabase-store.ts` find:

```ts
async runSimulation(_input: SimulationRequest): Promise<SimulationRun> {
  throw new NotImplementedInSupabaseStore("runSimulation");
}
```

Replace with:

```ts
async runSimulation(input: SimulationRequest): Promise<SimulationRun> {
  const { data: reviewRows, error: rErr } = await this.ledger()
    .from("review_tasks")
    .select("*")
    .eq("organization_id", this.ctx.organizationId)
    .eq("workspace_id", this.ctx.workspaceId)
    .in("id", input.reviewIds);
  if (rErr) throw new Error(`Failed to load reviews: ${rErr.message}`);
  const reviews = (reviewRows ?? []).map((row) => mapReviewRow(row));

  const voucherIds = [...new Set(reviews.map((r) => r.voucherId))];
  const { data: voucherRows, error: vErr } = voucherIds.length === 0
    ? { data: [], error: null }
    : await this.ledger()
        .from("vouchers")
        .select("*")
        .eq("organization_id", this.ctx.organizationId)
        .eq("workspace_id", this.ctx.workspaceId)
        .in("id", voucherIds);
  if (vErr) throw new Error(`Failed to load vouchers: ${vErr.message}`);
  const vouchers = (voucherRows ?? []).map((row) => mapVoucherRow(row));

  // Suggestions are carried embedded on review rows in our schema; fall back
  // to the embedded suggestion. (suggestions table is supplementary; reviews
  // have the canonical decision-time snapshot.)
  const suggestions = reviews
    .map((r) => r.suggestion)
    .filter((s): s is NonNullable<typeof s> => Boolean(s));

  const { balanceDelta, vatDelta, affectedAccounts } = simulateApprovals(
    reviews,
    suggestions,
    vouchers,
    input.action,
  );

  const result: SimulationRun = {
    id: createId("sim"),
    title: input.title,
    scenario: input.scenario,
    outcomeSummary: `Simulated ${reviews.length} review(s); ${affectedAccounts.length} accounts affected. No production postings were changed.`,
    affectedAccounts,
    balanceDelta,
    vatDelta,
  };

  await this.appendEvent({
    aggregateType: "simulation",
    aggregateId: result.id,
    eventType: "SimulationExecuted",
    actorId: this.ctx.userId,
    occurredAt: nowIso(),
    payload: result as unknown as Record<string, unknown>,
  });

  return result;
}
```

Add the import for `simulateApprovals` at the top of `supabase-store.ts`:

```ts
import { simulateApprovals } from "./simulation";
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `npx tsx --test tests/unit/supabase-store.test.ts`
Expected: all PASS including the new one.

- [ ] **Step 5: Verify the unused `NotImplementedInSupabaseStore` is still used**

Run: `grep -n NotImplementedInSupabaseStore packages/domain/src/supabase-store.ts`
Expected: at least one remaining reference (the class definition + the throw in `getCloseRun`). If `runSimulation` was the last caller, that would be fine, but `getCloseRun` should still throw it. Confirm.

- [ ] **Step 6: Full suite green**

Run: `pnpm test:unit && pnpm typecheck && pnpm typecheck:tests`
Expected: all green.

- [ ] **Step 7: Commit all of Tasks 3-6 together**

```bash
git add packages/contracts/src/index.ts packages/domain/src/simulation.ts packages/domain/src/store.ts packages/domain/src/supabase-store.ts packages/domain/src/index.ts tests/unit/contracts-simulation.test.ts tests/unit/simulation.test.ts tests/unit/ledger-store.test.ts tests/unit/supabase-store.test.ts
git commit -m "feat(domain): real runSimulation projection diff in both stores"
```

---

# Phase 4 — Assistant scaffold + compliance refresh

### Task 7: buildAssistantScaffold shared helper

**Files:**

- Create: `packages/domain/src/assistant.ts`
- Modify: `packages/domain/src/index.ts` (add export)
- Modify: `packages/domain/src/store.ts` (`MemoryLedgerStore.answerAssistantQuestion`)
- Modify: `packages/domain/src/supabase-store.ts` (`answerAssistantQuestion`)
- Test: `tests/unit/assistant.test.ts` (NEW)
- Test: `tests/unit/ledger-store.test.ts`, `tests/unit/supabase-store.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/assistant.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildAssistantScaffold } from "@jpx-accounting/domain";

test("buildAssistantScaffold returns a grounded session with one citation", () => {
  const session = buildAssistantScaffold("Can we deduct VAT?");
  assert.equal(session.question, "Can we deduct VAT?");
  assert.equal(session.status, "grounded");
  assert.equal(session.citations.length, 1);
  assert.match(session.id, /^assistant_/);
  assert.ok(session.answer.length > 0);
});

test("buildAssistantScaffold is deterministic in content (id varies)", () => {
  const a = buildAssistantScaffold("Q");
  const b = buildAssistantScaffold("Q");
  assert.equal(a.answer, b.answer);
  assert.equal(a.citations[0].title, b.citations[0].title);
  assert.notEqual(a.id, b.id, "ids are unique per call");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test tests/unit/assistant.test.ts`
Expected: FAIL — `buildAssistantScaffold` not exported.

- [ ] **Step 3: Create `packages/domain/src/assistant.ts`**

```ts
import type { AssistantSession } from "@jpx-accounting/contracts";

import { createId } from "./ids";

// Scaffold response shared by Memory and Supabase stores. When real AI lands
// (IA Phase 6 Cmd-K Advisor), this single function is replaced with a call to
// aiRuntime.answer(question) and the stores do not change.
export function buildAssistantScaffold(question: string): AssistantSession {
  return {
    id: createId("assistant"),
    question,
    answer:
      "This scaffold uses grounded, citation-first advisory. In production the answer would combine Azure AI Search retrieval, policy sources, and Responses API reasoning before it reaches the reviewer.",
    status: "grounded",
    citations: [
      {
        id: "cit_arch",
        title: "Internal architecture policy",
        sourceType: "internal",
        excerpt: "AI may suggest and explain, but may not silently mutate accounting state.",
      },
    ],
  };
}
```

- [ ] **Step 4: Export it**

Add to `packages/domain/src/index.ts` in alphabetical order:

```ts
export * from "./assistant";
```

- [ ] **Step 5: Run the assistant unit test — expect PASS**

Run: `npx tsx --test tests/unit/assistant.test.ts`
Expected: 2/2 pass.

- [ ] **Step 6: Refactor `MemoryLedgerStore.answerAssistantQuestion` to call it**

In `packages/domain/src/store.ts`, find `async answerAssistantQuestion(question: string)` (around line 417). Replace the body with:

```ts
async answerAssistantQuestion(question: string) {
  const answer = buildAssistantScaffold(question);
  this.assistantExamples.unshift(answer);
  return answer;
}
```

Add the import:

```ts
import { buildAssistantScaffold } from "./assistant";
```

- [ ] **Step 7: Refactor `SupabaseLedgerStore.answerAssistantQuestion`**

In `packages/domain/src/supabase-store.ts`, find `async answerAssistantQuestion(question: string): Promise<AssistantSession>` (around line 717). The current method constructs a session inline with the wrong `answer` text and inserts it. Replace the local-construction block:

```ts
const session: AssistantSession = {
  id: createId("assistant"),
  question,
  answer: "Database-backed assistant sessions are not yet implemented.",
  status: "grounded",
  citations: [],
};
```

with:

```ts
const session = buildAssistantScaffold(question);
```

Keep the rest of the method (the insert into `assistant_sessions` and the return) unchanged.

Add the import at the top:

```ts
import { buildAssistantScaffold } from "./assistant";
```

- [ ] **Step 8: Update existing supabase-store assistant test (if it asserts on the old answer string)**

Run: `grep -n "Database-backed assistant sessions are not yet implemented" tests/unit/`
Expected output: zero matches. If there ARE matches, update those test assertions to expect the new scaffold answer (or just assert `answer.length > 0`).

- [ ] **Step 9: Add a Memory-store assistant test**

Append to `tests/unit/ledger-store.test.ts`:

```ts
test("MemoryLedgerStore.answerAssistantQuestion delegates to the shared scaffold", async () => {
  const store = new MemoryLedgerStore();
  const answer = await store.answerAssistantQuestion("Can I deduct this?");
  assert.equal(answer.status, "grounded");
  assert.equal(answer.citations.length, 1);
  assert.equal(answer.question, "Can I deduct this?");
});
```

- [ ] **Step 10: Full suite green**

Run: `pnpm test:unit && pnpm typecheck && pnpm typecheck:tests`
Expected: all green.

- [ ] **Step 11: Commit**

```bash
git add packages/domain/src/assistant.ts packages/domain/src/index.ts packages/domain/src/store.ts packages/domain/src/supabase-store.ts tests/unit/assistant.test.ts tests/unit/ledger-store.test.ts
git commit -m "refactor(domain): shared buildAssistantScaffold; Supabase store stops returning not-implemented text"
```

---

### Task 8: Extend complianceAlertSchema; detectComplianceIssues pure function

**Files:**

- Modify: `packages/contracts/src/index.ts` (lines 225-231 for `complianceAlertSchema`)
- Create: `packages/domain/src/compliance.ts`
- Modify: `packages/domain/src/index.ts` (add export)
- Test: `tests/unit/compliance.test.ts` (NEW)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/compliance.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import type { ReviewTask, Voucher } from "@jpx-accounting/contracts";
import { detectComplianceIssues } from "@jpx-accounting/domain";

const voucherFixture = (overrides: Partial<Voucher>): Voucher => ({
  id: "v1",
  organizationId: "o",
  workspaceId: "w",
  evidencePacketId: "p1",
  voucherNumber: "V-1",
  status: "needs-review",
  accountingMethod: "invoice",
  extractedFields: [],
  voucherFields: { description: "Test", grossAmount: 100, netAmount: 80, vatAmount: 20, vatRate: 25, currency: "SEK" },
  createdAt: "2026-05-01T00:00:00.000Z",
  createdBy: "u",
  ...overrides,
});

const reviewFixture = (overrides: Partial<ReviewTask>): ReviewTask => ({
  id: "r1",
  voucherId: "v1",
  title: "Review V-1",
  status: "needs-review",
  suggestedAction: "Approve",
  suggestion: {
    id: "s1",
    voucherId: "v1",
    accountNumber: "6540",
    accountName: "IT-tjänster",
    vatCode: "VAT25",
    confidence: 0.9,
    reasoning: "r",
    kind: "recommendation",
    citations: [],
    ruleHits: [],
  },
  provenanceTimeline: [],
  ...overrides,
});

test("detectComplianceIssues returns no alerts on fresh, clean data", () => {
  const alerts = detectComplianceIssues([reviewFixture({})], [voucherFixture({})], "2026-05-02");
  assert.equal(alerts.length, 0);
});

test("stale-blocked rule fires for a needs-review with blocking hit older than 7 days", () => {
  const blocking = reviewFixture({
    suggestion: {
      ...reviewFixture({}).suggestion!,
      ruleHits: [{ ruleId: "vat-missing", description: "missing", severity: "blocking" }],
    },
  });
  const v = voucherFixture({ createdAt: "2026-05-01T00:00:00.000Z" });
  const alerts = detectComplianceIssues([blocking], [v], "2026-05-09"); // 8 days later
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, "stale-blocked");
  assert.equal(alerts[0].targetId, "v1");
  assert.equal(alerts[0].severity, "warning");
  assert.equal(alerts[0].status, "open");
});

test("stale-blocked does NOT fire on day 7", () => {
  const blocking = reviewFixture({
    suggestion: {
      ...reviewFixture({}).suggestion!,
      ruleHits: [{ ruleId: "vat-missing", description: "missing", severity: "blocking" }],
    },
  });
  const v = voucherFixture({ createdAt: "2026-05-01T00:00:00.000Z" });
  const alerts = detectComplianceIssues([blocking], [v], "2026-05-08"); // exactly 7 days
  assert.equal(alerts.length, 0, "boundary: 7 days is not yet stale");
});

test("missing-supplier-vat fires on approved voucher without supplierVatNumber", () => {
  const v = voucherFixture({
    status: "approved",
    voucherFields: { ...voucherFixture({}).voucherFields, supplierVatNumber: undefined },
  });
  const alerts = detectComplianceIssues([], [v], "2026-05-09");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, "missing-supplier-vat");
  assert.equal(alerts[0].targetId, "v1");
});

test("missing-supplier-vat does NOT fire on approved voucher WITH supplierVatNumber", () => {
  const v = voucherFixture({
    status: "approved",
    voucherFields: { ...voucherFixture({}).voucherFields, supplierVatNumber: "SE556677889901" },
  });
  const alerts = detectComplianceIssues([], [v], "2026-05-09");
  assert.equal(alerts.length, 0);
});

test("both rules fire simultaneously on independent vouchers", () => {
  const stale = reviewFixture({
    id: "r_stale",
    voucherId: "v_stale",
    suggestion: {
      ...reviewFixture({}).suggestion!,
      voucherId: "v_stale",
      ruleHits: [{ ruleId: "vat-missing", description: "missing", severity: "blocking" }],
    },
  });
  const vStale = voucherFixture({ id: "v_stale", createdAt: "2026-05-01T00:00:00.000Z" });
  const vMissingVat = voucherFixture({
    id: "v_missingvat",
    status: "approved",
    voucherFields: { ...voucherFixture({}).voucherFields, supplierVatNumber: undefined },
  });
  const alerts = detectComplianceIssues([stale], [vStale, vMissingVat], "2026-05-09");
  assert.equal(alerts.length, 2);
  assert.ok(alerts.some((a) => a.kind === "stale-blocked"));
  assert.ok(alerts.some((a) => a.kind === "missing-supplier-vat"));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/unit/compliance.test.ts`
Expected: FAIL — `detectComplianceIssues` not exported; `complianceAlertSchema` does not accept the new fields.

- [ ] **Step 3: Extend `complianceAlertSchema` in contracts**

In `packages/contracts/src/index.ts:225-231`, replace:

```ts
export const complianceAlertSchema = z.object({
  id: z.string(),
  title: z.string(),
  source: z.string(),
  detectedAt: z.string(),
  impactSummary: z.string(),
});
```

with:

```ts
export const complianceAlertSchema = z.object({
  id: z.string(),
  title: z.string(),
  source: z.string(),
  detectedAt: z.string(),
  impactSummary: z.string(),
  kind: z.string(),
  severity: z.enum(["info", "warning", "critical"]),
  status: z.enum(["open", "resolved"]),
  targetId: z.string().optional(),
  body: z.string().optional(),
});
```

- [ ] **Step 4: Create `packages/domain/src/compliance.ts`**

```ts
import type { ComplianceAlert, ReviewTask, Voucher } from "@jpx-accounting/contracts";

import { createId } from "./ids";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

export function detectComplianceIssues(
  reviews: ReviewTask[],
  vouchers: Voucher[],
  today: string, // YYYY-MM-DD
): ComplianceAlert[] {
  const vouchersById = new Map(vouchers.map((v) => [v.id, v]));
  const alerts: ComplianceAlert[] = [];
  const detectedAt = `${today}T00:00:00.000Z`;

  // Rule 1: stale-blocked — needs-review with blocking rule hit, voucher older than 7 days.
  for (const review of reviews) {
    if (review.status !== "needs-review") continue;
    const ruleHits = review.suggestion?.ruleHits ?? [];
    if (!ruleHits.some((h) => h.severity === "blocking")) continue;
    const voucher = vouchersById.get(review.voucherId);
    if (!voucher) continue;
    if (daysBetween(voucher.createdAt, detectedAt) <= 7) continue;
    alerts.push({
      id: createId("alert"),
      title: `Blocked voucher unresolved for >7 days (${voucher.voucherNumber})`,
      source: "internal/compliance",
      detectedAt,
      impactSummary:
        "A voucher with mandatory missing data has been sitting in review for over a week. Resolve or book without VAT.",
      kind: "stale-blocked",
      severity: "warning",
      status: "open",
      targetId: voucher.id,
    });
  }

  // Rule 2: missing-supplier-vat — approved voucher without supplierVatNumber.
  for (const voucher of vouchers) {
    if (voucher.status !== "approved") continue;
    if (voucher.voucherFields.supplierVatNumber && voucher.voucherFields.supplierVatNumber.length > 0) continue;
    alerts.push({
      id: createId("alert"),
      title: `Approved voucher missing supplier VAT number (${voucher.voucherNumber})`,
      source: "Bokföringslagen / VAT requirement",
      detectedAt,
      impactSummary:
        "Posted voucher has no supplier VAT number. Required for input-VAT deduction documentation under Skatteverket rules.",
      kind: "missing-supplier-vat",
      severity: "warning",
      status: "open",
      targetId: voucher.id,
    });
  }

  return alerts;
}
```

- [ ] **Step 5: Export from `packages/domain/src/index.ts`**

```ts
export * from "./compliance";
```

- [ ] **Step 6: Run the test — expect PASS**

Run: `npx tsx --test tests/unit/compliance.test.ts`
Expected: 6/6 pass.

- [ ] **Step 7: Hold — do not commit yet**

The contract change in Step 3 leaves the existing `MemoryLedgerStore` seeded alert and `mapComplianceAlertRow` failing type validation until Task 9 fixes both. Proceed to Task 9; the commit will bundle Tasks 8 and 9 together.

---

### Task 9: Compliance alert dedup migration + mapper update

**Files:**

- Create: `supabase/migrations/<ts>_compliance_alert_keys.sql`
- Modify: `packages/domain/src/supabase-mappers.ts` (`mapComplianceAlertRow`, lines 96-104)

- [ ] **Step 1: Generate the migration**

Run: `supabase migration new compliance_alert_keys`

- [ ] **Step 2: Fill in the migration**

```sql
-- Adds the columns + unique index needed for idempotent compliance-alert upserts.
-- `kind` defaults to 'legacy' so existing rows backfill cleanly.

alter table ledger.compliance_alerts add column if not exists kind text not null default 'legacy';
alter table ledger.compliance_alerts add column if not exists target_id text;

-- Partial unique index: rows with target_id form a per-(org, workspace, kind, target) singleton.
-- Rows without target_id (e.g. seeded informational alerts) are not deduplicated.
create unique index if not exists ledger_alerts_dedup_uidx
  on ledger.compliance_alerts (organization_id, workspace_id, kind, target_id)
  where target_id is not null;
```

- [ ] **Step 3: Apply locally**

Run: `supabase db reset`
Expected: clean apply.

- [ ] **Step 4: Update `mapComplianceAlertRow`**

In `packages/domain/src/supabase-mappers.ts:96-104`, replace:

```ts
export function mapComplianceAlertRow(row: Record<string, unknown>): ComplianceAlert {
  return complianceAlertSchema.parse({
    id: row.id,
    title: row.title,
    source: row.source,
    detectedAt: row.detected_at,
    impactSummary: row.impact_summary,
  });
}
```

with:

```ts
export function mapComplianceAlertRow(row: Record<string, unknown>): ComplianceAlert {
  return complianceAlertSchema.parse({
    id: row.id,
    title: row.title,
    source: row.source,
    detectedAt: row.detected_at,
    impactSummary: row.impact_summary ?? row.body ?? "",
    kind: row.kind ?? "legacy",
    severity: row.severity ?? "info",
    status: row.status ?? "open",
    targetId: row.target_id ?? undefined,
    body: row.body ?? undefined,
  });
}
```

The `??` fallbacks handle both fresh rows (from `refreshComplianceAlerts`) and any legacy rows that predated this work.

- [ ] **Step 5: Update seeded MemoryLedgerStore alert to satisfy the new schema**

In `packages/domain/src/store.ts:120-129`, the seeded alert is missing the new required fields. Replace:

```ts
private readonly alerts: ComplianceAlert[] = [
  {
    id: "alert_vat_1",
    title: "Representation review queue",
    source: "Skatteverket / internal policy",
    detectedAt: nowIso(),
    impactSummary:
      "Two receipts look like representation and should be checked against attendee and VAT-limit rules.",
  },
];
```

with:

```ts
private readonly alerts: ComplianceAlert[] = [
  {
    id: "alert_vat_1",
    title: "Representation review queue",
    source: "Skatteverket / internal policy",
    detectedAt: nowIso(),
    impactSummary:
      "Two receipts look like representation and should be checked against attendee and VAT-limit rules.",
    kind: "representation-review",
    severity: "info",
    status: "open",
  },
];
```

- [ ] **Step 6: Verify**

Run: `pnpm typecheck && pnpm test:unit && pnpm typecheck:tests`
Expected: all green.

- [ ] **Step 7: Commit Tasks 8 and 9 together (atomic contract change)**

```bash
git add packages/contracts/src/index.ts packages/domain/src/compliance.ts packages/domain/src/index.ts packages/domain/src/supabase-mappers.ts packages/domain/src/store.ts supabase/migrations/ tests/unit/compliance.test.ts
git commit -m "feat(domain,supabase): compliance alert schema + detection rules + dedup index"
```

---

### Task 10: Add refreshComplianceAlerts to LedgerStore interface + MemoryLedgerStore + UnavailableLedgerStore

**Files:**

- Modify: `packages/domain/src/store.ts` (`LedgerStore` interface; `MemoryLedgerStore.refreshComplianceAlerts`)
- Modify: `services/api/src/store-factory.ts` (`UnavailableLedgerStore.refreshComplianceAlerts`)
- Test: `tests/unit/ledger-store.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/ledger-store.test.ts`:

```ts
test("MemoryLedgerStore.refreshComplianceAlerts returns rule output and is idempotent", async () => {
  const store = new MemoryLedgerStore();
  const first = await store.refreshComplianceAlerts();
  const second = await store.refreshComplianceAlerts();
  // Two calls with the same input → same set of alerts (idempotent).
  assert.equal(first.length, second.length);
  // Seeded alert (kind: representation-review) survives across refreshes.
  assert.ok(first.some((a) => a.kind === "representation-review"));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test tests/unit/ledger-store.test.ts`
Expected: FAIL — `refreshComplianceAlerts` is not a method.

- [ ] **Step 3: Add to the `LedgerStore` interface**

In `packages/domain/src/store.ts`, add to the `interface LedgerStore` block (around line 55, before the closing brace):

```ts
refreshComplianceAlerts(): Promise<ComplianceAlert[]>;
```

- [ ] **Step 4: Implement on `MemoryLedgerStore`**

In `packages/domain/src/store.ts`, add a method on the class (place it near `answerAssistantQuestion`):

```ts
async refreshComplianceAlerts(): Promise<ComplianceAlert[]> {
  const reviews = [...this.reviews.values()];
  const vouchers = [...this.vouchers.values()];
  const detected = detectComplianceIssues(reviews, vouchers, today());
  // Idempotency: replace any prior auto-detected alerts (kind != "representation-review"
  // seeded) with the freshly detected set. Seeded alert stays in place.
  const seeded = this.alerts.filter((a) => a.kind === "representation-review");
  this.alerts.length = 0;
  this.alerts.push(...seeded, ...detected);
  return [...this.alerts];
}
```

Add the import for `detectComplianceIssues`:

```ts
import { detectComplianceIssues } from "./compliance";
```

(The `today` import already exists at the top of the file.)

- [ ] **Step 5: Implement on `UnavailableLedgerStore`**

In `services/api/src/store-factory.ts`, add to the `UnavailableLedgerStore` class (alongside the other `async X() { return this.fail(); }` methods):

```ts
async refreshComplianceAlerts() {
  return this.fail();
}
```

- [ ] **Step 6: Run the test — expect PASS**

Run: `npx tsx --test tests/unit/ledger-store.test.ts`
Expected: all PASS.

- [ ] **Step 7: Verify suite green**

Run: `pnpm test:unit && pnpm typecheck && pnpm typecheck:tests`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/store.ts services/api/src/store-factory.ts tests/unit/ledger-store.test.ts
git commit -m "feat(domain): MemoryLedgerStore.refreshComplianceAlerts (idempotent, deterministic)"
```

---

### Task 11: SupabaseLedgerStore.refreshComplianceAlerts with upsert

**Files:**

- Modify: `packages/domain/src/supabase-store.ts` (add method)
- Test: `tests/unit/supabase-store.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/supabase-store.test.ts`:

```ts
test("SupabaseLedgerStore.refreshComplianceAlerts upserts detected alerts and returns the list", async () => {
  const reviewRow = {
    id: "r1",
    organization_id: "o",
    workspace_id: "w",
    voucher_id: "v1",
    title: "Review V-1",
    status: "needs-review",
    suggested_action: "Approve",
    suggestion: {
      id: "s1",
      voucherId: "v1",
      accountNumber: "6540",
      accountName: "IT-tjänster",
      vatCode: "VAT25",
      confidence: 0.9,
      reasoning: "r",
      kind: "recommendation",
      citations: [],
      ruleHits: [{ ruleId: "vat-missing", description: "missing", severity: "blocking" }],
    },
    provenance_timeline: [],
  };
  // Voucher older than 7 days vs. today() (which is 2026-05-26 per fixture)
  const voucherRow = {
    id: "v1",
    organization_id: "o",
    workspace_id: "w",
    evidence_packet_id: "p1",
    voucher_number: "V-1",
    status: "needs-review",
    accounting_method: "invoice",
    extracted_fields: [],
    voucher_fields: {},
    created_at: "2026-05-01T00:00:00.000Z",
    created_by: "u",
  };
  const upserted: Record<string, unknown>[] = [];
  const client = {
    schema: () => ({
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "order", "limit", "in"]) chain[m] = () => chain;
        chain.maybeSingle = async () => ({ data: null, error: null });
        chain.then = (resolve: (v: { data: unknown; error: null }) => void) => {
          if (table === "review_tasks") return resolve({ data: [reviewRow], error: null });
          if (table === "vouchers") return resolve({ data: [voucherRow], error: null });
          if (table === "compliance_alerts") return resolve({ data: [], error: null });
          return resolve({ data: [], error: null });
        };
        chain.upsert = async (rows: Record<string, unknown>[]) => {
          if (table === "compliance_alerts") upserted.push(...rows);
          return { error: null };
        };
        chain.insert = async () => ({ error: null });
        return chain;
      },
    }),
  } as never;
  const store = new SupabaseLedgerStore(client, { organizationId: "o", workspaceId: "w", userId: "u" });

  const alerts = await store.refreshComplianceAlerts();
  assert.ok(
    alerts.some((a) => a.kind === "stale-blocked"),
    "stale-blocked alert produced",
  );
  assert.equal(upserted.length, 1, "one alert upserted to DB");
  assert.equal(upserted[0].kind, "stale-blocked");
  assert.equal(upserted[0].target_id, "v1");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test tests/unit/supabase-store.test.ts`
Expected: FAIL — `refreshComplianceAlerts` not on the class.

- [ ] **Step 3: Add the method to `SupabaseLedgerStore`**

In `packages/domain/src/supabase-store.ts`, add (after `answerAssistantQuestion`):

```ts
async refreshComplianceAlerts(): Promise<ComplianceAlert[]> {
  const { data: reviewRows, error: rErr } = await this.ledger()
    .from("review_tasks")
    .select("*")
    .eq("organization_id", this.ctx.organizationId)
    .eq("workspace_id", this.ctx.workspaceId);
  if (rErr) throw new Error(`Failed to load reviews: ${rErr.message}`);
  const reviews = (reviewRows ?? []).map((row) => mapReviewRow(row));

  const { data: voucherRows, error: vErr } = await this.ledger()
    .from("vouchers")
    .select("*")
    .eq("organization_id", this.ctx.organizationId)
    .eq("workspace_id", this.ctx.workspaceId);
  if (vErr) throw new Error(`Failed to load vouchers: ${vErr.message}`);
  const vouchers = (voucherRows ?? []).map((row) => mapVoucherRow(row));

  const detected = detectComplianceIssues(reviews, vouchers, today());

  if (detected.length > 0) {
    const rows = detected.map((alert) => ({
      id: alert.id,
      organization_id: this.ctx.organizationId,
      workspace_id: this.ctx.workspaceId,
      title: alert.title,
      source: alert.source,
      detected_at: alert.detectedAt,
      impact_summary: alert.impactSummary,
      kind: alert.kind,
      severity: alert.severity,
      status: alert.status,
      target_id: alert.targetId ?? null,
      body: alert.body ?? null,
    }));
    const { error: uErr } = await this.ledger()
      .from("compliance_alerts")
      .upsert(rows, { onConflict: "organization_id,workspace_id,kind,target_id" });
    if (uErr) throw new Error(`Failed to upsert compliance alerts: ${uErr.message}`);
  }

  // Read back the full list (covers detected new + any prior seeded/manual alerts).
  const { data: allRows, error: allErr } = await this.ledger()
    .from("compliance_alerts")
    .select("*")
    .eq("organization_id", this.ctx.organizationId)
    .eq("workspace_id", this.ctx.workspaceId)
    .order("detected_at", { ascending: false });
  if (allErr) throw new Error(`Failed to read compliance alerts: ${allErr.message}`);
  return (allRows ?? []).map((row) => mapComplianceAlertRow(row));
}
```

Add the import for `detectComplianceIssues`:

```ts
import { detectComplianceIssues } from "./compliance";
```

(`today` and `mapComplianceAlertRow` are already imported elsewhere in this file — verify.)

- [ ] **Step 4: Run the test — expect PASS**

Run: `npx tsx --test tests/unit/supabase-store.test.ts`
Expected: all PASS.

- [ ] **Step 5: Verify the suite is green**

Run: `pnpm test:unit && pnpm typecheck && pnpm typecheck:tests`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/supabase-store.ts tests/unit/supabase-store.test.ts
git commit -m "feat(domain): SupabaseLedgerStore.refreshComplianceAlerts (idempotent upsert)"
```

---

### Task 12: Wire `/api/compliance-watch/refresh` to call the real method

**Files:**

- Modify: `services/api/src/app.ts` (lines 251-253)

The existing route returns `getSnapshot().alerts` (a passive read). Change it to call `refreshComplianceAlerts()` so the endpoint actually does what its name suggests.

- [ ] **Step 1: Update the route**

In `services/api/src/app.ts:251-253`, replace:

```ts
app.post("/api/compliance-watch/refresh", async (context) =>
  context.json((await context.get("store").getSnapshot()).alerts),
);
```

with:

```ts
app.post("/api/compliance-watch/refresh", async (context) =>
  context.json(await context.get("store").refreshComplianceAlerts()),
);
```

- [ ] **Step 2: Verify with the existing integration test pattern**

Run: `pnpm test:integration`
Expected: still green (no new test added for this route specifically; the wiring is covered by Task 10's unit test against the demo store + Task 11's against Supabase, and the existing Hono integration test in `tests/integration/api-normal-mode.test.ts` exercises the middleware chain).

- [ ] **Step 3: Verify the full suite**

Run: `pnpm test:unit && pnpm typecheck && pnpm typecheck:tests`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add services/api/src/app.ts
git commit -m "feat(api): /api/compliance-watch/refresh actually refreshes (calls refreshComplianceAlerts)"
```

---

# Phase 5 — Documentation

### Task 13: Update DEV_STATUS.md

**Files:**

- Modify: `docs/DEV_STATUS.md`

- [ ] **Step 1: Update the Track B Phase 7 row**

In `docs/DEV_STATUS.md`, find the Track B table (around line 75) where Phase 7 appears. Change Phase 7's status from `Partial — JWT-claim RLS migration landed; rest optional` to `Done (7.2, 7.3, 7.4, 7.5) — assistant + compliance persistence, real runSimulation, supa_audit, rebuild script. 7.6 (Azure Postgres prep) and getCloseRun real impl remain deferred.`

- [ ] **Step 2: Update the "Last reviewed" date at the top**

Change `**Last reviewed:** 2026-05-19` to `**Last reviewed:** 2026-05-26`.

- [ ] **Step 3: Commit**

```bash
git add docs/DEV_STATUS.md
git commit -m "docs(status): Track B Phase 7 data-layer completion landed"
```

---

## Acceptance — sprint complete

After Task 13 commits, verify the sprint is shippable end-to-end:

- [ ] `pnpm typecheck && pnpm typecheck:tests && pnpm test:unit` all green.
- [ ] `pnpm test:integration` (if `SUPABASE_URL` set) green.
- [ ] Manual normal-mode smoke:
  1. `supabase db reset` (applies both new migrations).
  2. Seed → `curl -X POST http://localhost:3001/api/compliance-watch/refresh -H 'Authorization: Bearer <token>'` returns alert list (initially empty unless seed data triggers a rule).
  3. Re-run the refresh → identical response (idempotent).
  4. `POST /api/simulations/run` with `{ reviewIds: ["<seeded-review-id>"], action: "approve", title: "what-if", scenario: "approve seeded", actorId: "..." }` returns `SimulationRun` with non-empty `balanceDelta`.
  5. `GET /api/reports/trial-balance` is unchanged from before the simulation call.
  6. `npx tsx scripts/rebuild-projections.ts --org org_jpx --workspace workspace_main` prints dry-run summary; with `--apply`, reports remain byte-identical.
- [ ] Demo E2E (`pnpm build && pnpm test:e2e`) still green.
- [ ] DEV_STATUS.md Track B Phase 7 row reflects the new state.

---

## Self-Review

**Spec coverage** — every spec section maps to a task:

| Spec section                                                    | Task(s) |
| --------------------------------------------------------------- | ------- |
| Piece 1: Projection rebuild script                              | 1       |
| Piece 2: supa_audit migration                                   | 2       |
| Piece 3: Real runSimulation (contract change)                   | 3       |
| Piece 3: simulateApprovals pure function                        | 4       |
| Piece 3: MemoryLedgerStore.runSimulation rewrite                | 5       |
| Piece 3: SupabaseLedgerStore.runSimulation rewrite              | 6       |
| Piece 4: buildAssistantScaffold shared helper                   | 7       |
| Piece 4: Compliance contract extension + detectComplianceIssues | 8       |
| Piece 4: Compliance alert keys migration + mapper               | 9       |
| Piece 4: refreshComplianceAlerts on Memory + Unavailable        | 10      |
| Piece 4: refreshComplianceAlerts on Supabase                    | 11      |
| Piece 4: Route wiring                                           | 12      |
| Doc updates                                                     | 13      |

Spec items explicitly out of scope (`getCloseRun` real impl, real AI advisor, bank-line rule, server-side scheduling, web UI) are NOT included.

**Placeholder scan:** no "TBD"/"add error handling"/"similar to Task N"/"fill in details" patterns. Every code block, command, and assertion is complete and concrete.

**Type consistency:**

- `simulateApprovals` signature (Task 4) matches its imports in Tasks 5 and 6 (`reviews, suggestions, vouchers, action`).
- `buildAssistantScaffold(question)` signature (Task 7) matches both store call sites.
- `detectComplianceIssues(reviews, vouchers, today)` signature (Task 8) matches Tasks 10 and 11 call sites.
- `complianceAlertSchema` extension (Task 8) matches the new fields populated in Tasks 9 (mapper), 10 (Memory seeded alert), and 11 (Supabase upsert row).
- `refreshComplianceAlerts(): Promise<ComplianceAlert[]>` signature is identical across `LedgerStore` interface (Task 10), `MemoryLedgerStore` (Task 10), `UnavailableLedgerStore` (Task 10), and `SupabaseLedgerStore` (Task 11).
- `SimulationRequest`/`SimulationRun` extension (Task 3) match both store implementations (Tasks 5, 6) and the simulation pure function's return type (Task 4).

**Test count progression** (starting from ~39 after `pnpm install` resolves):

- Task 1: +2 (rebuild-projections tests)
- Task 3: +2 (contracts-simulation tests)
- Task 4: +4 (simulation tests)
- Task 5: +1 (Memory runSimulation test)
- Task 6: +1 (Supabase runSimulation test)
- Task 7: +3 (assistant unit + Memory assistant test + supabase fixture update)
- Task 8: +6 (compliance tests)
- Task 10: +1 (Memory refresh test)
- Task 11: +1 (Supabase refresh test)

Approximate final count: ~60 unit tests + 2 integration tests.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-26-track-b-phase-7-completion.md`.
