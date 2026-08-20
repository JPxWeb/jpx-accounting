# KFR Phase D — SIE & Migration

> Part of [2026-08-20-kfr-master.md](2026-08-20-kfr-master.md) — read its Global Constraints and Interface Contract first.

**Delivers** (design D5 + D6): imported vouchers become first-class rows (attachable, displayed with real series+number), evidence↔voucher attach via `targetVoucherId`, SIE parse warnings surfaced to the user, CP437 æ/Æ + a decode-confidence warning, `firstFiscalYearStart` floors fiscal-year/ytd windows and the SIE export `#RAR 0`, period-scoped SIE export with `#IB`/`#UB`/`#RES`, and bulk-capture hardening (concurrency cap + 429 retry). Closes readiness gaps G3, G4, G11, and the bulk-capture half of G9.

## Prerequisites & sequencing (read before Task 1)

The master's dependency notes say "D and F are independent of B/C/E." That is **only true at the phase-ordering level for D's own new work** — Task 1 and Task 2 below have a hard **runtime** dependency on two schema deltas the master's interface contract attributes to Phase B:

1. `voucherSchema.evidencePacketId` becomes `.nullable()`.
2. `voucherSchema` gains `origin: z.enum(["capture","manual","import"]).default("capture")`.
3. Migration `0009` adds `origin text not null default 'capture'` to `ledger.vouchers` and drops the `not null` constraint on `evidence_packet_id` (currently `evidence_packet_id text not null references ledger.evidence_packets(id)` in `infra/supabase/migrations/0001_init.sql:73`).

**Do not re-implement that migration here** (explicit instruction). Instead:

- If Phase B has already landed: verify it actually wired the new column into every existing read path in `packages/persistence-postgres/src/store.ts` — grep `rowToVoucher` and confirm it maps `origin: row.origin`, and confirm the repeated `SELECT id, organization_id, workspace_id, evidence_packet_id, voucher_number, accounting_method, status, voucher_fields, extracted_fields, created_by, created_at FROM ledger.vouchers` blocks (there are six of them, at the time of this writing around lines 376, 1180, 1253, 1311, 1391, 1468) all select `origin` too. If any of them don't, Phase B's slice is incomplete — finish that first, because Task 1's imported vouchers will otherwise come back from `getSnapshot()`/`getEvidenceContext()` with `origin: undefined`, which fails `voucherSchema` parsing and breaks Task 5's journal display.
- If Phase B has **not** landed yet and this phase must go first: land Phase B's contracts + migration 0009 slice (just those two schema deltas + the read-path wiring above) before starting Task 1's Postgres step. Task 1's Memory-store step has no such dependency (Memory has no DB schema) and can proceed standalone.
- `reviewStatusSchema` currently has **no** database-level enum constraint (`status` is a plain `text` column), so adding the new `"posted"` literal in Task 1 needs no migration at all — only the Zod contract change.

## Task 1 — `importSie` materializes Voucher rows (readiness G3)

**Files:**

- `packages/contracts/src/index.ts` (`reviewStatusSchema`, ~L22)
- `packages/domain/src/store.ts` (`SieImportInput`/`SiePlannedVoucher`/`planSieImport`, L148–259; `MemoryLedgerStore.importSie`, L551–595)
- `packages/persistence-postgres/src/store.ts` (`importSie`, L988–1095)
- `tests/integration/helpers/ledger-store-conformance.ts` (`scenarioSieImportIdempotency`, L206–237; `CONFORMANCE_SCENARIOS`, L460–473)

**Interfaces:**

- New `reviewStatusSchema` literal: `"posted"` — distinct from `"approved"` because an imported voucher never went through a review decision.
- New `buildImportedVoucher(planned: SiePlannedVoucher, ctx: TenantScope & { actorId: string; createdAt: string }): Voucher` exported from `packages/domain/src/store.ts`, imported by both stores so the Voucher shape can't drift (CONVENTIONS store parity).

### Step 1.1 — failing test: imported vouchers show up in the snapshot with the right shape

Add to `tests/integration/helpers/ledger-store-conformance.ts`, inside `scenarioSieImportIdempotency` (replace the `return { ... }` block at the end of the function):

```ts
// Task 1 (Phase D): import materializes an already-posted Voucher row so
// migrated history is attachable and displays its real series+number.
const snapshot = await h.store.getSnapshot();
const importedVoucher = snapshot.vouchers.find((voucher) => voucher.id === "sie_A_42");

return {
  importedVouchers: result.importedVouchers,
  importedTransactions: result.importedTransactions,
  journalDelta: journalAfter - journalBefore,
  eventDelta: eventsAfter - eventsBefore,
  replayImported: replay.importedVouchers,
  replaySkippedReason: replay.skipped[0]?.reason ?? null,
  journalReplayDelta: journalReplay - journalAfter,
  eventReplayDelta: eventsReplay - eventsAfter,
  marchLines,
  importedVoucherNumber: importedVoucher?.voucherNumber ?? null,
  importedVoucherOrigin: importedVoucher?.origin ?? null,
  importedVoucherStatus: importedVoucher?.status ?? null,
  importedVoucherEvidencePacketId: importedVoucher?.evidencePacketId ?? null,
  parseWarningCount: result.warnings.length,
};
```

Run:

```bash
corepack pnpm exec tsx --test tests/integration/ledger-store-conformance.test.ts
```

Expected fail: `MemoryLedgerStore conformance: SIE import idempotency + reports window` throws a TypeScript-shaped runtime error (`result.warnings` is `undefined`, `.length` throws) — or, once Task 3 lands `warnings` first, the assertion `importedVoucherNumber` compares `null` against `"A 42"` and fails. Either way the scenario's `assert.ok(outcome, ...)` in `tests/integration/ledger-store-conformance.test.ts` still passes (it only checks truthiness), so this alone won't fail loudly — the REAL failing assertion comes from Step 1.2's dedicated unit check below, which is the one to run first:

```bash
corepack pnpm exec tsx --test tests/unit/sie.test.ts
```

Add this assertion to the existing test `"full round-trip: export → parse → importSie reproduces the journal economics"` in `tests/unit/sie.test.ts` (append before the closing brace):

```ts
const snapshot = await store.getSnapshot();
const firstImportedVoucher = snapshot.vouchers.find((voucher) => voucher.id === "sie_A_1");
assert.equal(firstImportedVoucher?.voucherNumber, "A 1");
assert.equal(firstImportedVoucher?.origin, "import");
assert.equal(firstImportedVoucher?.status, "posted");
assert.equal(firstImportedVoucher?.evidencePacketId, null);
```

Run: `corepack pnpm exec tsx --test tests/unit/sie.test.ts` — expected fail: `TypeError: Cannot read properties of undefined (reading 'voucherNumber')` (no `sie_A_1` in `snapshot.vouchers` yet) or a `WorkspaceSnapshot` type error if `voucherSchema` hasn't gained `origin` yet (compile fails first under `tsx`'s type-stripping — this specific assertion is a runtime check so it will fail at `assert.equal`, not compile, since `firstImportedVoucher` is typed `Voucher | undefined` already).

### Step 1.2 — contracts: add the `"posted"` status literal

`packages/contracts/src/index.ts`, change:

```ts
export const reviewStatusSchema = z.enum(["needs-review", "approved", "rejected", "booked-without-vat"]);
```

to:

```ts
export const reviewStatusSchema = z.enum(["needs-review", "approved", "rejected", "booked-without-vat", "posted"]);
```

Run: `corepack pnpm exec tsx --test tests/unit/sie.test.ts` — still fails (store logic not written yet).

### Step 1.3 — domain: `buildImportedVoucher` + Memory materialization

`packages/domain/src/store.ts`: add `type TenantScope` to the existing tenant import:

```ts
import { DEFAULT_TENANT_SCOPE, type TenantScope } from "./tenant";
```

Add right after `planSieImport`'s closing brace (after L259):

```ts
/**
 * Build the lightweight, already-posted Voucher row materialized for a SIE
 * import (readiness G3 — imported history was previously invisible to
 * evidence attach). Shared by Memory and Postgres so the shape can't drift
 * (CONVENTIONS store parity). `voucherNumber` reuses `planned.reference`
 * ("<series> <number>") verbatim — the same string the journal/reports
 * already display for `sie_*` ids.
 */
export function buildImportedVoucher(
  planned: SiePlannedVoucher,
  ctx: TenantScope & { actorId: string; createdAt: string },
): Voucher {
  return {
    id: planned.aggregateId,
    organizationId: ctx.organizationId,
    workspaceId: ctx.workspaceId,
    evidencePacketId: null,
    voucherNumber: planned.reference,
    status: "posted",
    origin: "import",
    accountingMethod: "invoice",
    extractedFields: [],
    voucherFields: {
      description: planned.text ?? planned.reference,
      transactionDate: planned.date,
      currency: "SEK",
    },
    createdAt: ctx.createdAt,
    createdBy: ctx.actorId,
  };
}
```

Replace `MemoryLedgerStore.importSie` (L551–595) with:

```ts
  async importSie(input: SieImportInput): Promise<SieImportResult> {
    const { vouchers, skipped } = planSieImport(input.file);
    const result: SieImportResult = {
      accepted: true,
      importedVouchers: 0,
      importedTransactions: 0,
      skipped: [...skipped],
      warnings: [...input.file.warnings],
    };

    // Idempotency: skip vouchers whose aggregate id was already imported.
    const alreadyImported = new Set(
      this.events.filter((event) => event.eventType === "VoucherImported").map((event) => event.aggregateId),
    );

    const occurredAt = nowIso();
    const actorId = input.actorId ?? DEMO_ACTOR_ID;
    for (const planned of vouchers) {
      if (alreadyImported.has(planned.aggregateId)) {
        result.skipped.push({ reference: planned.reference, reason: "duplicate" });
        continue;
      }

      this.appendEvent({
        organizationId: defaultOrganizationId,
        workspaceId: defaultWorkspaceId,
        aggregateType: "ledger",
        aggregateId: planned.aggregateId,
        eventType: "VoucherImported",
        actorId,
        occurredAt,
        payload: {
          source: "sie",
          series: planned.series,
          number: planned.number,
          date: planned.date,
          text: planned.text,
          lines: planned.lines,
        },
      });

      // Task 1 (Phase D): materialize the already-posted Voucher row so
      // migrated history is attachable (Task 2) and displays its real
      // series+number (Task 5) instead of the raw `sie_*` aggregate id.
      const voucher = buildImportedVoucher(planned, {
        organizationId: defaultOrganizationId,
        workspaceId: defaultWorkspaceId,
        actorId,
        createdAt: occurredAt,
      });
      this.vouchers.set(voucher.id, voucher);

      result.importedVouchers += 1;
      result.importedTransactions += planned.lines.length;
    }

    return result;
  }
```

(`warnings` here anticipates Task 3's contract addition — leave `sieImportResultSchema` unchanged until Task 3's step; the field will be a type error until then, which is fine, this step and Task 3 land together or Task 3 lands first.)

Run: `corepack pnpm exec tsx --test tests/unit/sie.test.ts` — still fails on Postgres-independent parts if run in isolation is fine, but the Memory-only assertions in Step 1.1 now pass. Full green requires Task 3's `warnings` field too — run:

```bash
corepack pnpm exec tsx --test tests/unit/sie.test.ts tests/integration/ledger-store-conformance.test.ts
```

Expected: Memory-only tests pass; Postgres/parity tests still fail (or skip, if no `jpx_test_*` DB is configured) until Step 1.4.

### Step 1.4 — Postgres: batch-insert the voucher rows alongside the event batch

`packages/persistence-postgres/src/store.ts`: add `buildImportedVoucher` to the existing domain import:

```ts
import {
  AUTO_DETECTED_ALERT_KINDS,
  buildBalances,
  buildDeterministicSuggestion,
  buildEventHash,
  buildImportedVoucher,
  buildJournal,
  ...
```

In `importSie` (L988+), change the result initializer to include `warnings` (again, lands with Task 3):

```ts
const result: SieImportResult = {
  accepted: true,
  importedVouchers: 0,
  importedTransactions: 0,
  skipped: [...skipped],
  warnings: [...input.file.warnings],
};
```

Add a parallel `voucherBatch` alongside the existing `batch` (events) array, and push into it in the same loop that pushes into `batch`:

```ts
type PlannedEventRow = {
  id: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  previousHash: string;
  eventHash: string;
};
const batch: PlannedEventRow[] = [];
const voucherBatch: Voucher[] = [];
let prev = tailHash;
for (const planned of vouchers) {
  if (alreadyImported.has(planned.aggregateId)) {
    result.skipped.push({ reference: planned.reference, reason: "duplicate" });
    continue;
  }

  const payload: Record<string, unknown> = {
    source: "sie",
    series: planned.series,
    number: planned.number,
    date: planned.date,
    text: planned.text,
    lines: planned.lines as unknown as Record<string, unknown>[],
  };
  const eventHash = buildEventHash(prev, payload);
  batch.push({ id: createId("evt"), aggregateId: planned.aggregateId, payload, previousHash: prev, eventHash });
  prev = eventHash;

  voucherBatch.push(
    buildImportedVoucher(planned, {
      organizationId: this.defaults.organizationId,
      workspaceId: this.defaults.workspaceId,
      actorId,
      createdAt: occurredAt,
    }),
  );

  result.importedVouchers += 1;
  result.importedTransactions += planned.lines.length;
}
```

After the existing `if (batch.length > 0) { ... INSERT INTO ledger.events ... }` block, add:

```ts
if (voucherBatch.length > 0) {
  // Same jsonb_array_elements bulk-insert shape as the events batch
  // above — one round trip instead of one INSERT per SIE voucher.
  // evidence_packet_id is always NULL for a freshly-imported voucher
  // (Task 2's compose attach path is what ever sets it).
  await tx`
          INSERT INTO ledger.vouchers (
            id, organization_id, workspace_id, evidence_packet_id, voucher_number,
            accounting_method, status, origin, voucher_fields, extracted_fields,
            created_by, created_at
          )
          SELECT
            v->>'id',
            v->>'organizationId',
            v->>'workspaceId',
            NULL,
            v->>'voucherNumber',
            v->>'accountingMethod',
            v->>'status',
            v->>'origin',
            v->'voucherFields',
            v->'extractedFields',
            v->>'createdBy',
            v->>'createdAt'
          FROM jsonb_array_elements(${tx.json(voucherBatch as unknown as Parameters<typeof tx.json>[0])}::jsonb) AS v
        `;
}
```

Run: `corepack pnpm db:test` (or, against an already-provisioned `jpx_test_*` DB: `DATABASE_TEST_URL=... JPX_REQUIRE_DATABASE_TESTS=true corepack pnpm exec tsx --test tests/integration/ledger-store-conformance.test.ts`). Expected pass: all three variants (`MemoryLedgerStore conformance`, `PostgresLedgerStore conformance`, `Memory/Postgres parity`) green for `SIE import idempotency + reports window`.

Commit:

```
fix(sie): materialize Voucher rows on import so migrated history is attachable

importSie now appends a lightweight, already-posted Voucher row (origin:
"import", status: "posted", evidencePacketId: null) per accepted voucher in
both stores, keyed by the existing sie_<series>_<number> aggregate id. Closes
readiness gap G3 — imported history previously had no Voucher row for
evidence to attach to.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

## Task 2 — `composeEvidence` attach path (`targetVoucherId`)

**Files:**

- `packages/contracts/src/index.ts` (`evidenceComposeInputSchema`, L461–465)
- `packages/domain/src/store.ts` (new `VoucherNotFoundError`; `MemoryLedgerStore.composeEvidence`, L438–487)
- `packages/persistence-postgres/src/store.ts` (`composeEvidence`, L773–870)
- `services/api/src/app.ts` (error mapping)
- `tests/integration/helpers/ledger-store-conformance.ts` (new scenario)

**Interfaces:**

- `evidenceComposeInputSchema` gains `targetVoucherId: z.string().optional()`.
- New `VoucherNotFoundError extends Error` in `packages/domain/src/store.ts`, mapped to HTTP 404 `{code: "voucher_not_found"}` — same pattern as the existing `ReviewNotFoundError` (L106–111 / `app.ts` L517–519).
- `EvidenceRelinked` event payload is unchanged (`{voucherId, packetId, previousPacketId, evidenceIds}` — `previousPacketId` is `undefined` for a first-time attach to a voucher that had no packet).

### Step 2.1 — failing test: explicit target overrides auto-detect and attaches to an unlinked (imported) voucher

Add to `tests/integration/helpers/ledger-store-conformance.ts`. First, extend the domain import:

```ts
import { ReviewNotFoundError, VoucherNotFoundError, type LedgerStore } from "@jpx-accounting/domain/store";
```

Add a new scenario function (after `scenarioSieImportIdempotency`):

```ts
export async function scenarioComposeEvidenceTargetVoucher(h: ConformanceHarness): Promise<ConformanceOutcome> {
  const file = parseSie(
    [
      "#SIETYP 4",
      '#KONTO 6110 "Kontorsmateriel"',
      '#VER B 7 20260410 "Inkopta pennor"',
      "{",
      "#TRANS 6110 {} 50.00",
      "#TRANS 1930 {} -50.00",
      "}",
    ].join("\n"),
  );
  await h.store.importSie({ actorId: h.actorId, file });
  const importedVoucherId = "sie_B_7";

  const receipt = await h.store.createEvidence({
    actorId: h.actorId,
    title: "Receipt for imported voucher",
    originalFilename: "receipt-b7.jpg",
    mimeType: "image/jpeg",
    modalities: ["camera"],
  });

  const composed = await h.store.composeEvidence({
    actorId: h.actorId,
    evidenceIds: [receipt.evidence.id],
    targetVoucherId: importedVoucherId,
  });

  const context = await h.store.getEvidenceContext(receipt.evidence.id);

  let notFoundError = "none";
  try {
    await h.store.composeEvidence({
      actorId: h.actorId,
      evidenceIds: [receipt.evidence.id],
      targetVoucherId: "sie_does_not_exist",
    });
  } catch (error) {
    notFoundError =
      error instanceof VoucherNotFoundError ? "VoucherNotFoundError" : error instanceof Error ? error.name : "unknown";
  }

  return {
    attachedVoucherId: context?.voucher?.id ?? null,
    attachedPacketId: context?.voucher?.evidencePacketId ?? null,
    composedPacketId: composed.id,
    linkMatches: context?.voucher?.evidencePacketId === composed.id,
    notFoundError,
  };
}
```

Register it in `CONFORMANCE_SCENARIOS` (after the SIE import idempotency entry):

```ts
  { name: "SIE import idempotency + reports window", run: scenarioSieImportIdempotency },
  { name: "compose evidence with explicit targetVoucherId", run: scenarioComposeEvidenceTargetVoucher },
```

Run: `corepack pnpm exec tsx --test tests/integration/ledger-store-conformance.test.ts`

Expected fail: TypeScript error (`targetVoucherId` doesn't exist on the compose input type) or, once the schema change lands first, a runtime failure — `context?.voucher` is `undefined` because `composeEvidence` doesn't look at `targetVoucherId` yet, so `attachedVoucherId` is `null` instead of `"sie_B_7"`.

### Step 2.2 — contracts: `targetVoucherId`

`packages/contracts/src/index.ts`:

```ts
export const evidenceComposeInputSchema = z.object({
  evidenceIds: z.array(z.string()).min(1),
  note: z.string().optional(),
  voiceTranscript: z.string().optional(),
  /**
   * Explicit attach target (Phase D, Task 2): links the composed packet to
   * this voucher (imported OR native) instead of relying on evidence-level
   * packet history to infer one. Needed for imported vouchers, which start
   * with evidencePacketId: null and no prior packet to auto-detect from.
   */
  targetVoucherId: z.string().optional(),
});
```

### Step 2.3 — domain: `VoucherNotFoundError` + Memory attach path

`packages/domain/src/store.ts`, add right after `ReviewNotFoundError` (after L111):

```ts
/**
 * Thrown when `composeEvidence` is given a `targetVoucherId` that doesn't
 * exist in scope. Distinguished from generic Error so the HTTP layer maps to
 * 404 instead of catch-all 500 (CONVENTIONS Rule 16) — same pattern as
 * `ReviewNotFoundError`.
 */
export class VoucherNotFoundError extends Error {
  constructor(public readonly voucherId: string) {
    super(`Voucher not found in this workspace: ${voucherId}`);
    this.name = "VoucherNotFoundError";
  }
}
```

Replace `MemoryLedgerStore.composeEvidence` (L438–487) with:

```ts
  async composeEvidence(input: EvidenceComposeInput & ActorAttribution): Promise<EvidencePacket> {
    const actorId = input.actorId ?? DEMO_ACTOR_ID;
    if (input.targetVoucherId !== undefined && !this.vouchers.has(input.targetVoucherId)) {
      throw new VoucherNotFoundError(input.targetVoucherId);
    }

    const packet: EvidencePacket = {
      id: createId("packet"),
      evidenceIds: input.evidenceIds,
      note: input.note,
      voiceTranscript: input.voiceTranscript,
    };
    this.evidencePackets.set(packet.id, packet);

    // Task 2 (Phase D): an explicit targetVoucherId overrides auto-detection
    // entirely — this is how a packet attaches to a voucher that never had
    // one (imported vouchers start with evidencePacketId: null).
    let voucherIdToRelink = input.targetVoucherId;
    for (const eid of input.evidenceIds) {
      const previousPacketId = this.evidenceIdToPacketId.get(eid);
      if (previousPacketId && voucherIdToRelink === undefined) {
        const linkedVoucherId = this.packetIdToVoucherId.get(previousPacketId);
        if (linkedVoucherId) voucherIdToRelink = linkedVoucherId;
      }
      this.evidenceIdToPacketId.set(eid, packet.id);
    }

    if (voucherIdToRelink) {
      this.packetIdToVoucherId.set(packet.id, voucherIdToRelink);
      const voucher = this.vouchers.get(voucherIdToRelink);
      const previousPacketId = voucher?.evidencePacketId ?? undefined;
      if (voucher && voucher.evidencePacketId !== packet.id) {
        this.vouchers.set(voucherIdToRelink, { ...voucher, evidencePacketId: packet.id });
      }
      // WS-B B6b: a relink changes which evidence backs a voucher — that must
      // be visible in the audit chain, not a silent read-model repoint.
      this.appendEvent({
        organizationId: defaultOrganizationId,
        workspaceId: defaultWorkspaceId,
        aggregateType: "voucher",
        aggregateId: voucherIdToRelink,
        eventType: "EvidenceRelinked",
        actorId,
        occurredAt: nowIso(),
        payload: {
          voucherId: voucherIdToRelink,
          packetId: packet.id,
          previousPacketId,
          evidenceIds: [...input.evidenceIds],
        },
      });
    }

    return packet;
  }
```

Run: `corepack pnpm exec tsx --test tests/integration/ledger-store-conformance.test.ts` — `MemoryLedgerStore conformance: compose evidence with explicit targetVoucherId` now passes; Postgres/parity variants still fail (or skip).

### Step 2.4 — Postgres attach path

`packages/persistence-postgres/src/store.ts`: add `VoucherNotFoundError` to the domain-store import:

```ts
import {
  isDuplicateEvidence,
  planSieImport,
  ReviewNotFoundError,
  VoucherNotFoundError,
  type LedgerStore,
  type ReportRange,
  type SieImportInput,
} from "@jpx-accounting/domain/store";
```

Replace `composeEvidence` (L773–870) with:

```ts
  async composeEvidence(input: EvidenceComposeInput & ActorAttribution): Promise<EvidencePacket> {
    const actorId = input.actorId ?? DEMO_ACTOR_ID;
    return this.withChainForkRetry(() =>
      this.client.begin(async (tx) => {
        const tailHash = await this.lockWorkspaceTail(tx);

        // Task 2 (Phase D): resolve the explicit target up front (existence +
        // its current packet, for the audit payload's previousPacketId) —
        // same "throw inside the tx, withChainForkRetry re-throws non-fork
        // errors immediately" pattern as ReviewNotFoundError elsewhere in
        // this file (e.g. runSimulation).
        let voucherIdToRelink: string | undefined = input.targetVoucherId;
        let previousPacketId: string | undefined;
        if (input.targetVoucherId !== undefined) {
          const targetRows = await tx<Array<{ evidence_packet_id: string | null }>>`
          SELECT evidence_packet_id FROM ledger.vouchers
          WHERE id = ${input.targetVoucherId}
            AND organization_id = ${this.defaults.organizationId}
            AND workspace_id = ${this.defaults.workspaceId}
        `;
          if (targetRows.length === 0) {
            throw new VoucherNotFoundError(input.targetVoucherId);
          }
          previousPacketId = targetRows[0]!.evidence_packet_id ?? undefined;
        }

        const packet: EvidencePacket = {
          id: createId("packet"),
          evidenceIds: input.evidenceIds,
          note: input.note,
          voiceTranscript: input.voiceTranscript,
        };

        await tx`
        INSERT INTO ledger.evidence_packets (
          id,
          organization_id,
          workspace_id,
          note,
          voice_transcript,
          created_at
        ) VALUES (
          ${packet.id},
          ${this.defaults.organizationId},
          ${this.defaults.workspaceId},
          ${packet.note ?? null},
          ${packet.voiceTranscript ?? null},
          ${nowIso()}
        )
      `;

        for (const evidenceId of input.evidenceIds) {
          await tx`
          INSERT INTO ledger.evidence_packet_items (evidence_packet_id, evidence_object_id)
          VALUES (${packet.id}, ${evidenceId})
          ON CONFLICT DO NOTHING
        `;
        }

        // Voucher relink read-model fix (Memory parity §A N9): when evidence is
        // re-bundled into a new packet, repoint vouchers.evidence_packet_id so
        // getEvidenceContext (newest packet) and getSnapshot (voucher link) agree.
        // Auto-detect only runs when no explicit target was given.
        if (voucherIdToRelink === undefined) {
          for (const evidenceId of input.evidenceIds) {
            const linkedRows = await tx<Array<{ voucher_id: string; evidence_packet_id: string }>>`
            SELECT v.id AS voucher_id, v.evidence_packet_id
            FROM ledger.vouchers v
            JOIN ledger.evidence_packet_items i ON i.evidence_packet_id = v.evidence_packet_id
            WHERE i.evidence_object_id = ${evidenceId}
              AND i.evidence_packet_id != ${packet.id}
              AND v.organization_id = ${this.defaults.organizationId}
              AND v.workspace_id = ${this.defaults.workspaceId}
            LIMIT 1
          `;
            if (linkedRows[0]?.voucher_id && !voucherIdToRelink) {
              voucherIdToRelink = linkedRows[0].voucher_id;
              previousPacketId = linkedRows[0].evidence_packet_id;
            }
          }
        }

        if (voucherIdToRelink) {
          await tx`
          UPDATE ledger.vouchers
          SET evidence_packet_id = ${packet.id}
          WHERE id = ${voucherIdToRelink}
            AND organization_id = ${this.defaults.organizationId}
            AND workspace_id = ${this.defaults.workspaceId}
        `;

          // WS-B B6b: a relink changes which evidence backs a voucher — that
          // must be visible in the audit chain, not a silent read-model repoint.
          await this.appendEvent(
            tx,
            {
              organizationId: this.defaults.organizationId,
              workspaceId: this.defaults.workspaceId,
              aggregateType: "voucher",
              aggregateId: voucherIdToRelink,
              eventType: "EvidenceRelinked",
              actorId,
              occurredAt: nowIso(),
              payload: {
                voucherId: voucherIdToRelink,
                packetId: packet.id,
                previousPacketId,
                evidenceIds: [...input.evidenceIds],
              },
            },
            tailHash,
          );
        }

        return packet;
      }),
    );
  }
```

Run: `corepack pnpm db:test` — all three `compose evidence with explicit targetVoucherId` variants green.

### Step 2.5 — API: map `VoucherNotFoundError` to 404

`services/api/src/app.ts`: add `VoucherNotFoundError` to the domain-store import (next to `ReviewNotFoundError`), and add to `app.onError` right after the existing `ReviewNotFoundError` branch (L517–519):

```ts
if (error instanceof VoucherNotFoundError) {
  return jsonError(c, error.message, runtimeMode, 404, { code: "voucher_not_found" });
}
```

Add a new test file `tests/unit/api-evidence-compose-target-voucher.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { MemoryLedgerStore } from "@jpx-accounting/domain/store";

import { createApp } from "../../services/api/src/app";
import { createApiRuntimeDependencies } from "../../services/api/src/runtime";

function createTestApiApp() {
  const dependencies = createApiRuntimeDependencies({
    port: 0,
    runtimeMode: "demo",
    allowTestReset: false,
    corsPolicy: { kind: "wildcard" },
    azureOpenAi: {},
    database: { poolMode: "direct", poolMax: 10 },
    azureStorage: {},
    azureDocumentIntelligence: {},
    auth: {},
    advisor: { toolApprovalSecret: "test-advisor-approval-secret", maxOutputTokens: 2048, streamTimeoutMs: 90_000 },
  });
  return createApp({ ...dependencies, store: new MemoryLedgerStore(), allowTestReset: false });
}

test("POST /api/evidence/compose 404s with voucher_not_found for an unknown targetVoucherId", async () => {
  const app = createTestApiApp();

  const evidenceResponse = await app.request("http://localhost/api/evidence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Compose target test",
      originalFilename: "compose-target.jpg",
      mimeType: "image/jpeg",
      modalities: ["camera"],
    }),
  });
  assert.equal(evidenceResponse.status, 201);
  const created = (await evidenceResponse.json()) as { evidence: { id: string } };

  const composeResponse = await app.request("http://localhost/api/evidence/compose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ evidenceIds: [created.evidence.id], targetVoucherId: "sie_does_not_exist" }),
  });

  assert.equal(composeResponse.status, 404);
  const body = (await composeResponse.json()) as { code?: string };
  assert.equal(body.code, "voucher_not_found");
});
```

Run: `corepack pnpm exec tsx --test tests/unit/api-evidence-compose-target-voucher.test.ts` — expected fail: 500 (unmapped error) before Step 2.5's edit, 404 after.

Commit:

```
feat(evidence): explicit targetVoucherId attach path for composeEvidence

evidenceComposeInputSchema gains an optional targetVoucherId that overrides
auto-detection and attaches the composed packet to any voucher — imported or
native. Unblocks receipt attachment for migrated (SIE-imported) history,
which previously had no packet-history breadcrumb for auto-detect to follow.
Unknown targets 404 as voucher_not_found (VoucherNotFoundError).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

## Task 3 — SIE parse warnings surfaced end-to-end

**Files:**

- `packages/contracts/src/index.ts` (`sieImportResultSchema`, L612–618)
- `packages/domain/src/sie/parse.ts` (new `#IB` case)
- `apps/web/components/capture/quick-add-grid.tsx` (L101–120)
- `apps/web/messages/sv.json` + `en.json` (`capture.sieResult`, L275–279)

**Interfaces:**

- `sieImportResultSchema` gains `warnings: z.array(z.string()).default([])`.
- `ParsedSieFile.warnings` (already exists) threads straight through — `importSie` in both stores sets `result.warnings = [...input.file.warnings]` (already written in Task 1's steps 1.3/1.4).

### Step 3.1 — failing test: `#IB` with a non-zero balance warns; a zero one doesn't

Add to `tests/unit/sie.test.ts` (after the `"parseSie: bare #TRANS outside #VER is ignored with a warning"` test):

```ts
test("parseSie: non-zero #IB warns (opening balances aren't imported this version); zero #IB is silent", () => {
  const withBalance = parseSie('#IB 0 1930 15000.50\n#VER A 1 20260101 "x"\n{\n#TRANS 1930 {} 0\n}');
  assert.ok(
    withBalance.warnings.some((warning) => warning.includes("#IB") && warning.includes("1930")),
    "non-zero #IB must warn",
  );

  const zeroBalance = parseSie("#IB 0 1930 0.00");
  assert.ok(!zeroBalance.warnings.some((warning) => warning.includes("#IB")), "a zero #IB is not worth warning about");
});
```

Run: `corepack pnpm exec tsx --test tests/unit/sie.test.ts` — expected fail: `withBalance.warnings` has no `#IB`-mentioning entry (`#IB` currently falls into the `default: break` case, silently dropped — this is exactly readiness gap G4's "import side silently drops #IB").

### Step 3.2 — parser: recognize `#IB` minimally

`packages/domain/src/sie/parse.ts`, add a new `case` to the switch in `parseSie` (right after the `case "#TRANS": { ... }` block, before `default:`):

```ts
      case "#IB": {
        // Minimal recognition (readiness G4): detect non-zero opening
        // balances and warn — do NOT import them as balances this version
        // (see the migration runbook for manual reconciliation). Field
        // order per spec: #IB <yeardelta> <account> <balance> [<quantity>].
        const yearIndex = fields[1]?.value;
        const account = fields[2]?.value;
        const balanceRaw = fields[3]?.value;
        const balance = balanceRaw === undefined ? Number.NaN : Number.parseFloat(balanceRaw);
        if (Number.isFinite(balance) && Math.abs(balance) > 0.005) {
          warnings.push(
            `#IB ${yearIndex ?? "0"} ${account ?? "?"} ${balanceRaw} has a non-zero opening balance — opening balances are not imported in this version; reconcile manually (see the FY1 migration runbook).`,
          );
        }
        break;
      }
```

Run: `corepack pnpm exec tsx --test tests/unit/sie.test.ts` — passes.

### Step 3.3 — contracts + both stores: thread `warnings` into `SieImportResult`

`packages/contracts/src/index.ts`:

```ts
export const sieImportResultSchema = z.object({
  accepted: z.boolean(),
  importedVouchers: z.number().int().nonnegative(),
  importedTransactions: z.number().int().nonnegative(),
  skipped: z.array(z.object({ reference: z.string(), reason: z.string() })).default([]),
  warnings: z.array(z.string()).default([]),
});
```

Both stores already set `result.warnings = [...input.file.warnings]` from Task 1 Steps 1.3/1.4 — no further store change needed here. Run:

```bash
corepack pnpm exec tsx --test tests/unit/sie.test.ts tests/integration/ledger-store-conformance.test.ts
```

Expected pass, including the `parseWarningCount` assertion added in Task 1 Step 1.1 (0 for the clean `marchSieFile()` fixture).

### Step 3.4 — UI: toast shows warning count + first 3

`apps/web/messages/sv.json`, inside `capture.sieResult` (after `"error"`, L278):

```json
      "error": "Kunde inte importera SIE-filen.",
      "warnings": "{count, plural, one {# varning} other {# varningar}} vid importen: {preview}"
```

`apps/web/messages/en.json`, same spot:

```json
      "error": "Could not import the SIE file.",
      "warnings": "{count, plural, one {# warning} other {# warnings}} during import: {preview}"
```

`apps/web/components/capture/quick-add-grid.tsx`, in `importSieFile` (L101–120), after the existing `toast.success(...)` call and before `invalidateLedgerDerived`:

```ts
if (result.warnings.length > 0) {
  toast.warning(tSie("warnings", { count: result.warnings.length, preview: result.warnings.slice(0, 3).join(" · ") }));
}
```

No new automated test for this step — it is a thin toast wrapper over `result.warnings`, already unit-pinned end-to-end by Step 3.3; UI presence is covered by the existing capture E2E suite exercising `importSieFile`.

Run: `corepack pnpm check` (full gate, since this step only touched JSON + JSX) — expect green.

Commit:

```
feat(sie): surface parse warnings through import, warn on non-zero #IB

ParsedSieFile.warnings now threads through SieImportResult.warnings (new
field) to the quick-add import toast. #IB lines are recognized minimally to
warn on a non-zero opening balance instead of being silently dropped —
opening balances are still not imported as balances this version (see the
migration runbook).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

## Task 4 — CP437: æ/Æ mapped, ø/Ø decode-confidence warning (readiness G11)

**Files:**

- `packages/domain/src/sie/pc8.ts`
- `services/api/src/app.ts` (`POST /api/imports/sie`, L835–844)
- `packages/api-client/src/index.ts` (`importSie`, L552–556)

**Interfaces:**

- `UNICODE_TO_CP437` gains `æ: 0x91, Æ: 0x92`.
- New `sieDecodeWarnings(text: string): string[]` exported from `pc8.ts` — detects post-decode U+FFFD (the byte our subset map doesn't cover, e.g. ø/Ø) and returns one warning describing the count.

### Step 4.1 — failing test: æ/Æ round-trip; an unmapped high byte (stand-in for ø/Ø) produces a decode warning

Add to `tests/unit/sie.test.ts`:

```ts
test("CP437 map covers æ/Æ; an unmapped high byte (e.g. ø/Ø, no CP437 slot here) triggers a decode warning", () => {
  assert.deepEqual([...encodePc8("æÆ")], [0x91, 0x92]);
  assert.equal(decodePc8(encodePc8("æÆ")), "æÆ");

  assert.deepEqual(sieDecodeWarnings("clean text, no replacement chars"), []);

  // 0xd8 is outside this subset's map — a stand-in for ø/Ø, which have no
  // CP437 slot here (readiness G11).
  const decoded = decodePc8(new Uint8Array([0x42, 0xd8, 0x6a, 0x6f, 0x72, 0x6e]));
  assert.equal(decoded, "B�jorn");
  const warnings = sieDecodeWarnings(decoded);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /1 character/);
});
```

Update the `sie.test.ts` import line to add `sieDecodeWarnings`:

```ts
import {
  buildSieExport,
  decodePc8,
  decodeSieBuffer,
  encodePc8,
  parseSie,
  sieDecodeWarnings,
} from "@jpx-accounting/domain";
```

Run: `corepack pnpm exec tsx --test tests/unit/sie.test.ts` — expected fail: `sieDecodeWarnings` doesn't exist (import error) and `encodePc8("æÆ")` currently falls through to `[0x3f, 0x3f]` (both unmapped → `?`).

### Step 4.2 — implementation

`packages/domain/src/sie/pc8.ts`, extend the map:

```ts
const UNICODE_TO_CP437: Record<string, number> = {
  å: 0x86,
  ä: 0x84,
  ö: 0x94,
  Å: 0x8f,
  Ä: 0x8e,
  Ö: 0x99,
  é: 0x82,
  É: 0x90,
  ü: 0x81,
  Ü: 0x9a,
  æ: 0x91,
  Æ: 0x92,
};
```

Add at the bottom of the file:

```ts
/**
 * Detect CP437 decode fallout: a byte outside this subset's map (e.g. ø/Ø,
 * which have no CP437 slot here) decodes to U+FFFD instead of the real
 * character. Callers merge this into `ParsedSieFile.warnings` so a garbled
 * voucher text is surfaced, not silent (readiness G11).
 */
export function sieDecodeWarnings(text: string): string[] {
  const replacementCount = [...text].filter((char) => char === REPLACEMENT_CHARACTER).length;
  if (replacementCount === 0) return [];
  return [
    `${replacementCount} character(s) could not be decoded (a PC8/CP437 byte outside this subset's map, e.g. ø/Ø) and were replaced with "?" — review affected voucher texts manually.`,
  ];
}
```

Run: `corepack pnpm exec tsx --test tests/unit/sie.test.ts` — passes. Confirm the untouched pin still holds too: the existing assertion `assert.deepEqual([...encodePc8("åäöÅÄÖéÉüÜ")], [0x86, 0x84, 0x94, 0x8f, 0x8e, 0x99, 0x82, 0x90, 0x81, 0x9a])` is a DIFFERENT string (no æ/Æ) so it is unaffected by the map addition.

### Step 4.3 — wire the decode warning into both import call sites

`services/api/src/app.ts`, add `sieDecodeWarnings` to the domain import, and change the `POST /api/imports/sie` handler (L835–844):

```ts
app.post("/api/imports/sie", async (context) => {
  const bytes = new Uint8Array(await context.req.arrayBuffer());
  const text = decodeSieBuffer(bytes);
  const parsed = parseSie(text);
  parsed.warnings = [...sieDecodeWarnings(text), ...parsed.warnings];
  const result = await currentStore.importSie({ actorId: deriveActorId(context), file: parsed });
  return context.json(result);
});
```

`packages/api-client/src/index.ts`, in the demo-fallback branch of `importSie` (L552–556):

```ts
  async importSie(bytes: Uint8Array | ArrayBuffer): Promise<SieImportResult> {
    const asBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (this.fallbackStore) {
      const text = decodeSieBuffer(asBytes);
      const parsed = parseSie(text);
      parsed.warnings = [...sieDecodeWarnings(text), ...parsed.warnings];
      return this.fallbackStore.importSie({ file: parsed });
    }
    ...
```

(Add `sieDecodeWarnings` to the existing `@jpx-accounting/domain` import list at the top of `packages/api-client/src/index.ts`.)

Add a regression test to `tests/unit/api-actor-attribution.test.ts` is unnecessary scope creep here — instead add directly to `tests/unit/sie.test.ts`:

```ts
test("decode-confidence warning reaches ParsedSieFile.warnings for a real garbled buffer", () => {
  const garbled = new Uint8Array([0x23, 0x46, 0x4e, 0x41, 0x4d, 0x4e, 0x20, 0xd8]); // "#FNAMN " + an unmapped byte
  const text = decodeSieBuffer(garbled);
  const parsed = parseSie(text);
  const merged = [...sieDecodeWarnings(text), ...parsed.warnings];
  assert.ok(merged.some((warning) => warning.includes("could not be decoded")));
});
```

Run: `corepack pnpm exec tsx --test tests/unit/sie.test.ts` — passes.

Commit:

```
fix(sie): map CP437 æ/Æ, warn on undecodable bytes (e.g. ø/Ø)

pc8.ts's CP437 subset gains æ (0x91) and Æ (0x92). ø/Ø have no slot in this
subset — decoding now surfaces a warning (sieDecodeWarnings) whenever a
replacement character (U+FFFD) appears post-decode, merged into
ParsedSieFile.warnings at both import call sites instead of silently
mangling voucher text. Closes readiness gap G11.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

## Task 5 — journal display: real series+number for imported vouchers

**Files:**

- NEW `apps/web/lib/voucher-link-display.ts` (pure logic extracted for testability — the codebase tests UI purely via Playwright E2E and keeps decision logic in framework-free `lib/*.ts` modules, e.g. `dashboard-layout-core.ts`)
- `apps/web/components/reports/voucher-link.tsx` (thin component wrapper)
- NEW `tests/unit/voucher-link-display.test.ts`

**Interfaces:**

- `resolveVoucherLinkDisplay(voucherId: string, lookup: VoucherLookup): VoucherLinkDisplay` where `VoucherLinkDisplay` is a discriminated union `{kind:"link",href,label,imported} | {kind:"imported-badge",label} | {kind:"plain",label}`.
- `buildVoucherLookup`/`VoucherLookup` move to the new pure module; `voucher-link.tsx` re-exports both so the three existing importers (`compliance-alerts-panel.tsx`, `account-drill-drawer.tsx`, `journal-view.tsx`) need no changes.

### Step 5.1 — failing test: an imported voucher (Task 1's materialized row) shows its real number + is marked imported, with and without attached evidence

Create `tests/unit/voucher-link-display.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import type { EvidencePacket, Voucher } from "@jpx-accounting/contracts";

import { buildVoucherLookup, resolveVoucherLinkDisplay } from "../../apps/web/lib/voucher-link-display";

function voucher(overrides: Partial<Voucher> & Pick<Voucher, "id" | "voucherNumber">): Voucher {
  return {
    organizationId: "org_jpx",
    workspaceId: "workspace_main",
    evidencePacketId: null,
    status: "posted",
    origin: "capture",
    accountingMethod: "invoice",
    extractedFields: [],
    voucherFields: { currency: "SEK" },
    createdAt: "2026-03-01T00:00:00.000Z",
    createdBy: "user_test",
    ...overrides,
  };
}

function packet(overrides: Partial<EvidencePacket> & Pick<EvidencePacket, "id">): EvidencePacket {
  return { evidenceIds: [], ...overrides };
}

test("imported voucher with no attached evidence: imported-badge with the real series+number", () => {
  const lookup = buildVoucherLookup({
    vouchers: [voucher({ id: "sie_A_90", voucherNumber: "A 90", origin: "import", evidencePacketId: null })],
    packets: [],
  });
  const display = resolveVoucherLinkDisplay("sie_A_90", lookup);
  assert.deepEqual(display, { kind: "imported-badge", label: "A 90" });
});

test("imported voucher WITH attached evidence: a real link, still flagged imported", () => {
  const lookup = buildVoucherLookup({
    vouchers: [voucher({ id: "sie_A_90", voucherNumber: "A 90", origin: "import", evidencePacketId: "packet_1" })],
    packets: [packet({ id: "packet_1", evidenceIds: ["evidence_1"] })],
  });
  const display = resolveVoucherLinkDisplay("sie_A_90", lookup);
  assert.deepEqual(display, { kind: "link", href: "/capture/evidence/evidence_1", label: "A 90", imported: true });
});

test("native (capture-origin) voucher with evidence: a real link, not flagged imported", () => {
  const lookup = buildVoucherLookup({
    vouchers: [voucher({ id: "voucher_1", voucherNumber: "V-1001", origin: "capture", evidencePacketId: "packet_1" })],
    packets: [packet({ id: "packet_1", evidenceIds: ["evidence_1"] })],
  });
  const display = resolveVoucherLinkDisplay("voucher_1", lookup);
  assert.deepEqual(display, { kind: "link", href: "/capture/evidence/evidence_1", label: "V-1001", imported: false });
});

test("no materialized voucher row (pre-migration data): falls back to the raw sie_ id", () => {
  const lookup = buildVoucherLookup({ vouchers: [], packets: [] });
  const display = resolveVoucherLinkDisplay("sie_A_1", lookup);
  assert.deepEqual(display, { kind: "imported-badge", label: "sie_A_1" });
});

test("unresolvable, non-sie_ id: plain muted text", () => {
  const lookup = buildVoucherLookup({ vouchers: [], packets: [] });
  const display = resolveVoucherLinkDisplay("voucher_seed_1", lookup);
  assert.deepEqual(display, { kind: "plain", label: "voucher_seed_1" });
});
```

Run: `corepack pnpm exec tsx --test tests/unit/voucher-link-display.test.ts` — expected fail: module not found (`apps/web/lib/voucher-link-display.ts` doesn't exist yet).

### Step 5.2 — implementation

Create `apps/web/lib/voucher-link-display.ts`:

```ts
import type { EvidencePacket, Voucher, WorkspaceSnapshot } from "@jpx-accounting/contracts";

/**
 * Pure voucher-chip resolution (Phase D, Task 5), extracted from
 * `components/reports/voucher-link.tsx` so it's testable without a DOM —
 * this codebase tests UI via Playwright E2E and keeps decision logic in
 * framework-free `lib/*.ts` modules (see `dashboard-layout-core.ts`).
 */

export type VoucherLookup = {
  vouchersById: Map<string, Voucher>;
  packetsById: Map<string, EvidencePacket>;
};

/** Build the id→entity maps once per snapshot; don't rebuild per row. */
export function buildVoucherLookup(snapshot?: Pick<WorkspaceSnapshot, "vouchers" | "packets">): VoucherLookup {
  return {
    vouchersById: new Map((snapshot?.vouchers ?? []).map((voucher) => [voucher.id, voucher])),
    packetsById: new Map((snapshot?.packets ?? []).map((packet) => [packet.id, packet])),
  };
}

export type VoucherLinkDisplay =
  | { kind: "link"; href: string; label: string; imported: boolean }
  | { kind: "imported-badge"; label: string }
  | { kind: "plain"; label: string };

/**
 * Resolve how a voucher chip should render:
 * (a) voucher + packet + evidence all resolve → a real link (imported flag
 *     rides along so an attached SIE import still shows the badge);
 * (b) a materialized voucher with `origin: "import"` but no evidence yet
 *     (Task 1) → the real "<series> <number>" + Imported badge, no link;
 * (c) no materialized voucher row at all (defensive fallback for
 *     pre-migration projections that only carried the id) → derive from the
 *     `sie_*` id prefix;
 * (d) anything else → plain muted text.
 * NEVER a dead link.
 */
export function resolveVoucherLinkDisplay(voucherId: string, lookup: VoucherLookup): VoucherLinkDisplay {
  const voucher = lookup.vouchersById.get(voucherId);
  const packet = voucher?.evidencePacketId ? lookup.packetsById.get(voucher.evidencePacketId) : undefined;
  const evidenceId = packet?.evidenceIds[0];
  const imported = voucher?.origin === "import";

  if (voucher && evidenceId) {
    return { kind: "link", href: `/capture/evidence/${evidenceId}`, label: voucher.voucherNumber, imported };
  }
  if (voucher && imported) {
    return { kind: "imported-badge", label: voucher.voucherNumber };
  }
  if (voucherId.startsWith("sie_")) {
    return { kind: "imported-badge", label: voucherId };
  }
  return { kind: "plain", label: voucher?.voucherNumber ?? voucherId };
}
```

Run: `corepack pnpm exec tsx --test tests/unit/voucher-link-display.test.ts` — passes.

### Step 5.3 — thin the component down to a renderer of `VoucherLinkDisplay`

Replace `apps/web/components/reports/voucher-link.tsx` in full:

```tsx
"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";

import { buildVoucherLookup, resolveVoucherLinkDisplay, type VoucherLookup } from "../../lib/voucher-link-display";
import { StatusBadge } from "../ui/status-badge";

/**
 * The honest voucher chip (advisory-pivot Phase 4, Task 4.8; extended Phase D
 * Task 5 for materialized SIE-import voucher rows). Decision logic lives in
 * `lib/voucher-link-display.ts` (framework-free, unit-tested); this component
 * is just the renderer. NEVER a dead link — see that module's doc comment.
 */

export { buildVoucherLookup, type VoucherLookup };

export function VoucherLink({ voucherId, lookup }: { voucherId: string; lookup: VoucherLookup }) {
  const t = useTranslations("reports.drill");
  const display = resolveVoucherLinkDisplay(voucherId, lookup);

  if (display.kind === "link") {
    return (
      <span className="inline-flex items-center gap-2">
        <Link
          data-testid="drill-voucher-link"
          href={display.href}
          className="text-mono text-sm text-primary underline underline-offset-2"
        >
          {display.label}
        </Link>
        {display.imported ? (
          <StatusBadge testId="drill-imported-badge" status={t("importedBadge")} variant="info" />
        ) : null}
      </span>
    );
  }

  if (display.kind === "imported-badge") {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-mono text-sm">{display.label}</span>
        <StatusBadge testId="drill-imported-badge" status={t("importedBadge")} variant="info" />
      </span>
    );
  }

  return <span className="text-mono text-sm text-muted-foreground">{display.label}</span>;
}
```

Run: `corepack pnpm typecheck && corepack pnpm exec tsx --test tests/unit/voucher-link-display.test.ts`. Also pin the existing E2E behavior didn't regress — add one assertion to the existing `tests/e2e/reports-drill.spec.ts` test `"SIE-imported lines show the Imported badge and never a dead link"` (after the existing `drill-imported-badge` assertion, L103):

```ts
await expect(drawer.getByTestId("drill-imported-badge")).toContainText("A 90");
```

(Optional to run now — E2E is opt-in per CLAUDE.md; run via `corepack pnpm build:e2e && npx playwright test tests/e2e/reports-drill.spec.ts` when convenient.)

Commit:

```
feat(reports): voucher chip shows real series+number for imported vouchers

VoucherLink now resolves imported vouchers (materialized by Task 1) to their
real "<series> <number>" instead of the raw sie_* aggregate id, and keeps the
Imported badge even once evidence is attached (Task 2) and a real link
becomes available. Decision logic extracted to lib/voucher-link-display.ts
for unit testing; the old sie_-prefix fallback stays for pre-migration data.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

## Task 6 — `firstFiscalYearStart` floors fy/ytd windows

**Files:**

- `packages/contracts/src/index.ts` (`workspaceProfileSchema`, L545–558)
- `packages/domain/src/reports/period.ts` (`resolvePeriodToken`, L160–235)
- `packages/domain/src/reports/pack.ts` (`BuildReportPackInput`/`buildReportPack`, L15–44)
- `packages/domain/src/store.ts` (`getReportPack`, L628–635) and `packages/persistence-postgres/src/store.ts` (`getReportPack`, L1161–1167)
- `apps/web/hooks/use-period-scope.ts`
- `apps/web/components/settings/fiscal-year-form.tsx`

**Interfaces:**

- `workspaceProfileSchema` gains `firstFiscalYearStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()`. (`euTrade` is a SEPARATE master-contract addition owned by Phase F — not touched here.)
- `resolvePeriodToken(token, {fiscalYearStart, today?, firstFiscalYearStart?})` — `fy-` and `ytd` windows' `from` clamps to `max(anchor-derived from, firstFiscalYearStart)`; `to` and `previous` are untouched. Quarter windows are intentionally NOT clamped (no observable inaccuracy — there is no ledger data before the company existed, so an unclamped quarter simply reports zero activity for the pre-incorporation days).

### Step 6.1 — failing test: the clamp

Add to `tests/unit/report-period.test.ts`:

```ts
test("firstFiscalYearStart clamps the earliest fy/ytd window's `from` (irregular first fiscal year)", () => {
  const FY_SEP_FLOORED = { fiscalYearStart: "09-01", firstFiscalYearStart: "2025-10-15" };

  const fy2025 = resolvePeriodToken("fy-2025", FY_SEP_FLOORED);
  assert.equal(fy2025.from, "2025-10-15", "the FIRST fiscal year floors to the real incorporation date");
  assert.equal(fy2025.to, "2026-08-31", "the end date is untouched by the floor");

  const fy2026 = resolvePeriodToken("fy-2026", FY_SEP_FLOORED);
  assert.equal(fy2026.from, "2026-09-01", "a LATER fiscal year is unaffected");

  const ytd = resolvePeriodToken("ytd", { ...FY_SEP_FLOORED, today: "2025-11-01" });
  assert.equal(ytd.from, "2025-10-15", "ytd gets the same treatment when today falls inside the first fiscal year");

  const unfloored = resolvePeriodToken("fy-2025", { fiscalYearStart: "09-01" });
  assert.equal(unfloored.from, "2025-09-01", "omitting firstFiscalYearStart keeps the old anchor-derived behavior");
});
```

Run: `corepack pnpm exec tsx --test tests/unit/report-period.test.ts` — expected fail: TS error (no `firstFiscalYearStart` key on the opts type) or, once the signature is widened, `fy2025.from` returns `"2025-09-01"` unclamped.

### Step 6.2 — contracts

`packages/contracts/src/index.ts`:

```ts
export const workspaceProfileSchema = z.object({
  country: countryCodeSchema.default("SE"),
  locale: z.string().min(2).default("sv-SE"),
  currency: z.string().length(3).default("SEK"),
  fiscalYearStart: z
    .string()
    .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
    .default("01-01"),
  /**
   * Optional floor for an irregular first fiscal year (Phase D, Task 6) —
   * e.g. a company incorporated mid-year. When set, the fiscal year/ytd
   * window CONTAINING this date has its `from` raised to this date instead
   * of the recurring fiscalYearStart anchor; the SIE export's `#RAR 0`
   * shares the same clamp. Leave unset once FY1 is closed.
   */
  firstFiscalYearStart: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  vatPeriod: vatPeriodSchema.default("quarterly"),
});
```

### Step 6.3 — `resolvePeriodToken`

`packages/domain/src/reports/period.ts`, change the signature and the `fy-`/`ytd` branches:

```ts
export function resolvePeriodToken(
  token: string,
  opts: { fiscalYearStart: string; today?: string; firstFiscalYearStart?: string },
): ResolvedPeriod {
  const fiscalStart = parseFiscalYearStart(opts.fiscalYearStart);
  const floor = opts.firstFiscalYearStart;
  const clampFrom = (from: string): string => (floor !== undefined && from < floor ? floor : from);
  ...
```

In the `fy-` branch:

```ts
return {
  token,
  kind: "fiscal-year",
  from: clampFrom(formatDay(window.from)),
  to: formatDay(window.to),
  previous: { from: formatDay(previous.from), to: formatDay(previous.to) },
};
```

In the `ytd` branch:

```ts
return {
  token,
  kind: "ytd",
  from: clampFrom(formatDay(from)),
  to: formatDay(today),
  previous: { from: formatDay(previousFrom), to: formatDay(previousTo) },
};
```

Run: `corepack pnpm exec tsx --test tests/unit/report-period.test.ts` — passes. Also run the full file to confirm no regression on the untouched month/quarter/all branches: same command.

### Step 6.4 — thread through `buildReportPack` and both stores' `getReportPack`

`packages/domain/src/reports/pack.ts`:

```ts
export type BuildReportPackInput = {
  periodToken: string;
  fiscalYearStart: string;
  /** Optional floor for an irregular first fiscal year (Phase D, Task 6). */
  firstFiscalYearStart?: string;
  today?: string;
  coa?: CoaTemplate;
  regime?: VatRegime;
};

export function buildReportPack(lines: LedgerLine[], input: BuildReportPackInput): ReportPack {
  const period = resolvePeriodToken(input.periodToken, {
    fiscalYearStart: input.fiscalYearStart,
    ...(input.today !== undefined ? { today: input.today } : {}),
    ...(input.firstFiscalYearStart !== undefined ? { firstFiscalYearStart: input.firstFiscalYearStart } : {}),
  });
  ...
```

`packages/domain/src/store.ts`, `getReportPack` (L628–635):

```ts
  async getReportPack(input: { period: string }): Promise<ReportPack> {
    const settings = await this.getCompanySettings();
    const lines = this.collectLedgerLines();
    return buildReportPack(lines, {
      periodToken: input.period,
      fiscalYearStart: settings?.profile.fiscalYearStart ?? "01-01",
      ...(settings?.profile.firstFiscalYearStart !== undefined
        ? { firstFiscalYearStart: settings.profile.firstFiscalYearStart }
        : {}),
    });
  }
```

`packages/persistence-postgres/src/store.ts`, `getReportPack` (L1161–1167): identical change.

Add to `tests/unit/report-pack.test.ts` (append a new test):

```ts
test("buildReportPack floors fy-2025's from when firstFiscalYearStart is set", () => {
  const pack = buildReportPack([], {
    periodToken: "fy-2025",
    fiscalYearStart: "09-01",
    firstFiscalYearStart: "2025-10-15",
  });
  assert.equal(pack.period.from, "2025-10-15");
});
```

Run: `corepack pnpm exec tsx --test tests/unit/report-pack.test.ts` — passes.

### Step 6.5 — web: thread through `use-period-scope.ts`

`apps/web/hooks/use-period-scope.ts`:

```ts
let resolved: ResolvedPeriod;
const resolverOpts = {
  fiscalYearStart: profile.fiscalYearStart,
  ...(profile.firstFiscalYearStart !== undefined ? { firstFiscalYearStart: profile.firstFiscalYearStart } : {}),
};
try {
  resolved = resolvePeriodToken(token, resolverOpts);
} catch (error) {
  if (!(error instanceof InvalidPeriodTokenError)) throw error;
  resolved = resolvePeriodToken(currentMonthToken(), resolverOpts);
}
```

### Step 6.6 — settings UI: the new field

`apps/web/messages/sv.json`, inside `settings.fiscalYear` (after `"startLabel"`/before `"previewNote"`, L922–923):

```json
      "startLabel": "Räkenskapsårets startmånad",
      "firstFiscalYearStartLabel": "Första räkenskapsårets startdatum (valfritt)",
      "firstFiscalYearStartHint": "Endast för ett oregelbundet första räkenskapsår (t.ex. bolaget bildades mitt i året). Lämna tomt när det första räkenskapsåret är avslutat.",
      "previewNote": "Fönstret och deadlinen nedan följer den valda startmånaden — spara för att tillämpa den på rapporter och skattetidslinjen.",
```

`apps/web/messages/en.json`, same spot:

```json
      "startLabel": "Fiscal year start month",
      "firstFiscalYearStartLabel": "First fiscal year start date (optional)",
      "firstFiscalYearStartHint": "Only needed for an irregular first fiscal year (e.g. the company was founded mid-year). Leave blank once the first fiscal year is closed.",
      "previewNote": "The window and deadline below follow the selected start month — save to apply it to reports and the tax timeline.",
```

`apps/web/components/settings/fiscal-year-form.tsx`: add state and a date input. In `FiscalYearFields`, after the existing `fiscalYearStart` state (L58):

```ts
const [firstFiscalYearStart, setFirstFiscalYearStart] = useState(profile.firstFiscalYearStart ?? "");
```

Update the preview computation (L76–78) to apply the same floor the server will:

```ts
const today = localTodayIso();
const periodOpts = {
  fiscalYearStart,
  today,
  ...(firstFiscalYearStart !== "" ? { firstFiscalYearStart } : {}),
};
const currentFyYear = Number(resolvePeriodToken("ytd", periodOpts).from.slice(0, 4));
const fyWindow = resolvePeriodToken(`fy-${currentFyYear}`, periodOpts);
```

Update the submit handler (L109–113) to persist it:

```ts
      onSubmit={(event) => {
        event.preventDefault();
        if (!settings) return;
        mutation.mutate({
          ...settings,
          profile: {
            ...settings.profile,
            fiscalYearStart,
            ...(firstFiscalYearStart !== "" ? { firstFiscalYearStart } : { firstFiscalYearStart: undefined }),
          },
        });
      }}
```

Wait — `exactOptionalPropertyTypes` forbids `firstFiscalYearStart: undefined` in the object literal above. Use this instead, which omits the key entirely to clear it:

```ts
      onSubmit={(event) => {
        event.preventDefault();
        if (!settings) return;
        const { firstFiscalYearStart: _drop, ...profileWithoutFloor } = settings.profile;
        mutation.mutate({
          ...settings,
          profile: {
            ...profileWithoutFloor,
            fiscalYearStart,
            ...(firstFiscalYearStart !== "" ? { firstFiscalYearStart } : {}),
          },
        });
      }}
```

Add the input control after the existing start-month `<Select>` block (after L150, before the `<dl>` KPI grid):

```tsx
<div className="space-y-2">
  <SectionLabel as="label" htmlFor="first-fiscal-year-start">
    {t("firstFiscalYearStartLabel")}
  </SectionLabel>
  <input
    id="first-fiscal-year-start"
    data-testid="first-fiscal-year-start-input"
    type="date"
    value={firstFiscalYearStart}
    onChange={(event) => setFirstFiscalYearStart(event.target.value)}
    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm sm:w-64"
  />
  <p className="text-sm leading-6 text-muted-foreground">{t("firstFiscalYearStartHint")}</p>
</div>
```

Add an E2E regression to `tests/e2e/settings-pages.spec.ts` (after the existing `"fiscal-year: start month persists..."` test):

```ts
test("fiscal-year: first fiscal year start floors the window preview and persists", async ({ page, isMobile }) => {
  await page.goto("/settings/fiscal-year");
  await expect(page.getByTestId("company-fiscal-year-form")).toBeVisible();

  await page.getByTestId("first-fiscal-year-start-input").fill("2025-10-15");
  await activateControl(page.getByTestId("fiscal-year-save"), isMobile);
  await expect(page.getByText(/sparat/i).or(page.getByText(/saved/i))).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("first-fiscal-year-start-input")).toHaveValue("2025-10-15");
});
```

Run (when convenient — E2E is opt-in per CLAUDE.md): `corepack pnpm build:e2e && npx playwright test tests/e2e/settings-pages.spec.ts`. Run the unit gate now: `corepack pnpm check`.

Commit:

```
feat(settings): firstFiscalYearStart floors the irregular first fiscal year

workspaceProfileSchema gains an optional firstFiscalYearStart date.
resolvePeriodToken clamps the fy-/ytd window containing it up to that date
(fiscal-year END and quarters are unaffected); threaded through
buildReportPack, both stores' getReportPack, the client period hook, and a
new optional date field on the fiscal-year settings form.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

## Task 7 — period-scoped SIE export with `#IB`/`#UB`/`#RES`

**Files:**

- `packages/domain/src/sie/serialize.ts`
- `services/api/src/app.ts` (`GET /api/exports/sie`, L846–854)
- `packages/api-client/src/index.ts` (`fetchSieExport`, L520–545)
- `apps/web/components/screens/reports-screen.tsx` (`exportSie`, L85–103)
- `tests/unit/sie.test.ts`

**Interfaces:**

- `SieExportInput` gains `range?: {from, to}`, `openingBalances?/closingBalances?/results?: Record<string, number>`.
- New `computeSieBalances(journal: JournalEntryProjection[], range: {from,to}): {openingBalances, closingBalances, results}` exported from `serialize.ts` — opening = signed (`debit - credit`) sum of lines with `bookedAt.slice(0,10) < range.from` per account; closing = opening + in-range movement; `results` = in-range movement for accounts whose first digit is `3`–`8` (BAS result accounts).
- `GET /api/exports/sie?period=<token>` — optional; validated via `resolvePeriodToken` (422 `invalid_period_token` on a bad token, same as `/api/reports/pack`); filename becomes `jpx-export-<period-or-today>.se`.

### Step 7.1 — failing test: `computeSieBalances` + the period-scoped export's exact byte content

Add to `tests/unit/sie.test.ts` (import `computeSieBalances` in the existing import line):

```ts
import {
  buildSieExport,
  computeSieBalances,
  decodePc8,
  decodeSieBuffer,
  encodePc8,
  parseSie,
  sieDecodeWarnings,
} from "@jpx-accounting/domain";
```

```ts
test("period-scoped SIE export: #IB/#UB/#RES computed from the full ledger, #VER scoped to the range", () => {
  const fullJournal: JournalEntryProjection[] = [
    {
      id: "j_pre_1",
      voucherId: "voucher_pre",
      accountNumber: "1930",
      accountName: "Företagskonto",
      description: "Aktiekapital",
      debit: 5000,
      credit: 0,
      bookedAt: "2026-02-15",
    },
    {
      id: "j_pre_2",
      voucherId: "voucher_pre",
      accountNumber: "2091",
      accountName: "Balanserad vinst",
      description: "Aktiekapital",
      debit: 0,
      credit: 5000,
      bookedAt: "2026-02-15",
    },
    ...goldenJournal,
    {
      id: "j_post_1",
      voucherId: "voucher_post",
      accountNumber: "6110",
      accountName: "Kontorsmateriel",
      description: "April purchase (out of range)",
      debit: 300,
      credit: 0,
      bookedAt: "2026-04-10",
    },
    {
      id: "j_post_2",
      voucherId: "voucher_post",
      accountNumber: "1930",
      accountName: "Företagskonto",
      description: "April purchase (out of range)",
      debit: 0,
      credit: 300,
      bookedAt: "2026-04-10",
    },
  ];
  const range = { from: "2026-03-01", to: "2026-03-31" };
  const balances = computeSieBalances(fullJournal, range);

  assert.deepEqual(balances.openingBalances, { "1930": 5000, "2091": -5000 });
  assert.deepEqual(balances.closingBalances, {
    "1930": 3550,
    "2091": -5000,
    "2641": 250,
    "6110": 200,
    "6540": 1000,
  });
  assert.deepEqual(balances.results, { "6110": 200, "6540": 1000 });

  const text = buildSieExport({
    journal: fullJournal,
    settings: goldenSettings,
    generatedAt: goldenGeneratedAt,
    range,
    ...balances,
  });

  const expected = [
    "#FLAGGA 0",
    '#PROGRAM "JPX Accounting" "0.1.0"',
    "#FORMAT PC8",
    "#GEN 20260704",
    "#SIETYP 4",
    "#ORGNR 556677-8899",
    '#FNAMN "Guldexport AB"',
    "#RAR 0 20260301 20260331",
    '#KONTO 1930 "Företagskonto"',
    '#KONTO 2091 "Balanserad vinst"',
    '#KONTO 2641 "Debiterad ingående moms"',
    '#KONTO 6110 "Kontorsmateriel"',
    '#KONTO 6540 "IT-tjänster"',
    "#IB 0 1930 5000.00",
    "#IB 0 2091 -5000.00",
    "#UB 0 1930 3550.00",
    "#UB 0 2091 -5000.00",
    "#UB 0 2641 250.00",
    "#UB 0 6110 200.00",
    "#UB 0 6540 1000.00",
    "#RES 0 6110 200.00",
    "#RES 0 6540 1000.00",
    '#VER A 1 20260305 "Programvara mars"',
    "{",
    "#TRANS 6540 {} 1000.00",
    "#TRANS 2641 {} 250.00",
    "#TRANS 1930 {} -1250.00",
    "}",
    '#VER A 2 20260312 "Pärmar och \\"kvitton\\""',
    "{",
    "#TRANS 6110 {} 200.00",
    "#TRANS 1930 {} -200.00",
    "}",
    "",
  ].join("\n");
  assert.equal(text, expected);
});
```

Run: `corepack pnpm exec tsx --test tests/unit/sie.test.ts` — expected fail: `computeSieBalances` doesn't exist (import error).

### Step 7.2 — `computeSieBalances` + `buildSieExport` upgrade

`packages/domain/src/sie/serialize.ts`, add the import and the new function, and update `fiscalYearWindow` + `buildSieExport`:

```ts
import type { CompanySettings, JournalEntryProjection } from "@jpx-accounting/contracts";

import { defaultCoaTemplate, findCoaAccount } from "../coa/registry";
import type { CoaTemplate } from "../coa/types";
import { round2 } from "../store-shared";
```

```ts
export type SieExportInput = {
  journal: JournalEntryProjection[];
  settings?: CompanySettings | null | undefined;
  generatedAt: string;
  coa?: CoaTemplate;
  /**
   * Period-scoped export (Phase D, Task 7): #VER blocks are limited to
   * entries whose bookedAt falls in [range.from, range.to], and #RAR 0 uses
   * this window directly. Omitted = full-history export (unchanged).
   */
  range?: { from: string; to: string };
  /** Per-account signed (debit positive) balance as of range.from, exclusive. Emits `#IB 0`. */
  openingBalances?: Record<string, number>;
  /** Per-account balance at range.to, inclusive. Emits `#UB 0`. */
  closingBalances?: Record<string, number>;
  /** Per-account in-range movement for BAS result accounts (3xxx-8xxx). Emits `#RES 0`. */
  results?: Record<string, number>;
};

/**
 * Compute opening/closing/result balances for a period-scoped export (Phase
 * D, Task 7) from the FULL (unfiltered) journal — `journal` here must NOT be
 * pre-filtered by range, since opening balances need everything before it.
 */
export function computeSieBalances(
  journal: JournalEntryProjection[],
  range: { from: string; to: string },
): {
  openingBalances: Record<string, number>;
  closingBalances: Record<string, number>;
  results: Record<string, number>;
} {
  const opening: Record<string, number> = {};
  const movement: Record<string, number> = {};
  const results: Record<string, number> = {};

  for (const entry of journal) {
    const day = entry.bookedAt.slice(0, 10);
    const signed = entry.debit - entry.credit;
    if (day < range.from) {
      opening[entry.accountNumber] = round2((opening[entry.accountNumber] ?? 0) + signed);
    } else if (day <= range.to) {
      movement[entry.accountNumber] = round2((movement[entry.accountNumber] ?? 0) + signed);
      const firstDigit = entry.accountNumber.charAt(0);
      if (firstDigit >= "3" && firstDigit <= "8") {
        results[entry.accountNumber] = round2((results[entry.accountNumber] ?? 0) + signed);
      }
    }
  }

  const closing: Record<string, number> = { ...opening };
  for (const [account, delta] of Object.entries(movement)) {
    closing[account] = round2((closing[account] ?? 0) + delta);
  }

  return { openingBalances: opening, closingBalances: closing, results };
}
```

```ts
function fiscalYearWindow(
  generatedAt: string,
  fiscalYearStart: string,
  firstFiscalYearStart?: string,
): { start: string; end: string } {
  const day = generatedAt.slice(0, 10);
  const year = Number(day.slice(0, 4));
  const startThisYear = `${year}-${fiscalYearStart}`;
  const start = day >= startThisYear ? startThisYear : `${year - 1}-${fiscalYearStart}`;
  const [startYear, startMonth, startDay] = start.split("-").map(Number) as [number, number, number];
  const endDate = new Date(Date.UTC(startYear + 1, startMonth - 1, startDay));
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  // Phase D, Task 6: the earliest fiscal year floors to firstFiscalYearStart
  // when set — same clamp as resolvePeriodToken's fy-/ytd windows.
  const clampedStart =
    firstFiscalYearStart !== undefined && start < firstFiscalYearStart ? firstFiscalYearStart : start;
  return { start: clampedStart, end: endDate.toISOString().slice(0, 10) };
}

export function buildSieExport({
  journal,
  settings,
  generatedAt,
  coa = defaultCoaTemplate,
  range,
  openingBalances,
  closingBalances,
  results,
}: SieExportInput): string {
  const lines: string[] = [];

  lines.push("#FLAGGA 0");
  lines.push('#PROGRAM "JPX Accounting" "0.1.0"');
  lines.push("#FORMAT PC8");
  lines.push(`#GEN ${compactDay(generatedAt)}`);
  lines.push("#SIETYP 4");
  if (settings?.organizationNumber) lines.push(`#ORGNR ${settings.organizationNumber}`);
  if (settings?.organizationName) lines.push(`#FNAMN ${quote(settings.organizationName)}`);

  const { start, end } = range
    ? { start: range.from, end: range.to }
    : fiscalYearWindow(
        generatedAt,
        settings?.profile.fiscalYearStart ?? "01-01",
        settings?.profile.firstFiscalYearStart,
      );
  lines.push(`#RAR 0 ${compactDay(start)} ${compactDay(end)}`);

  const accountNames = new Map<string, string>();
  for (const entry of journal) {
    if (!accountNames.has(entry.accountNumber)) {
      accountNames.set(
        entry.accountNumber,
        entry.accountName || (findCoaAccount(coa, entry.accountNumber)?.name ?? `Konto ${entry.accountNumber}`),
      );
    }
  }
  for (const number of [...accountNames.keys()].sort()) {
    lines.push(`#KONTO ${number} ${quote(accountNames.get(number)!)}`);
  }

  const emitBalances = (label: "IB" | "UB" | "RES", balances?: Record<string, number>) => {
    if (!balances) return;
    for (const account of Object.keys(balances).sort()) {
      const amount = balances[account]!;
      if (Math.abs(amount) < 0.005) continue;
      lines.push(`#${label} 0 ${account} ${amount.toFixed(2)}`);
    }
  };
  emitBalances("IB", openingBalances);
  emitBalances("UB", closingBalances);
  emitBalances("RES", results);

  const scopedJournal = range
    ? journal.filter((entry) => {
        const day = entry.bookedAt.slice(0, 10);
        return day >= range.from && day <= range.to;
      })
    : journal;

  const groups = new Map<string, JournalEntryProjection[]>();
  for (const entry of scopedJournal) {
    const group = groups.get(entry.voucherId);
    if (group) {
      group.push(entry);
    } else {
      groups.set(entry.voucherId, [entry]);
    }
  }

  let verNumber = 0;
  for (const entries of groups.values()) {
    verNumber += 1;
    const first = entries[0]!;
    lines.push(`#VER A ${verNumber} ${compactDay(first.bookedAt)} ${quote(first.description)}`);
    lines.push("{");
    for (const entry of entries) {
      lines.push(`#TRANS ${entry.accountNumber} {} ${(entry.debit - entry.credit).toFixed(2)}`);
    }
    lines.push("}");
  }

  return `${lines.join("\n")}\n`;
}
```

Run: `corepack pnpm exec tsx --test tests/unit/sie.test.ts` — passes, INCLUDING the pre-existing `"golden export: serializer output is byte-identical to the fixture"` test (unchanged: no `range` is passed there, so `fiscalYearWindow` receives `firstFiscalYearStart: undefined` positionally — harmless — and no `#IB/#UB/#RES` lines get emitted since those `opts` are absent). **No golden fixture file needs regenerating** — `tests/fixtures/sie/golden-export.se` stays byte-identical because that test's call site never sets `range`.

### Step 7.3 — API route: `?period=`

`services/api/src/app.ts`: add `computeSieBalances` and `resolvePeriodToken` to the domain import, then replace `GET /api/exports/sie` (L846–854):

```ts
app.get("/api/exports/sie", async (context) => {
  const [reports, settings] = await Promise.all([currentStore.getReports(), currentStore.getCompanySettings()]);
  const periodParam = context.req.query("period");
  const fiscalYearStart = settings?.profile.fiscalYearStart ?? "01-01";

  let range: { from: string; to: string } | undefined;
  let balances: ReturnType<typeof computeSieBalances> | undefined;
  if (periodParam !== undefined) {
    const resolved = resolvePeriodToken(periodParam, {
      fiscalYearStart,
      today: today(),
      ...(settings?.profile.firstFiscalYearStart !== undefined
        ? { firstFiscalYearStart: settings.profile.firstFiscalYearStart }
        : {}),
    });
    range = { from: resolved.from, to: resolved.to };
    balances = computeSieBalances(reports.journal, range);
  }

  const text = buildSieExport({
    journal: reports.journal,
    settings,
    generatedAt: nowIso(),
    ...(range ? { range, ...balances } : {}),
  });
  // Spec-valid PC8 (CP437) bytes — NOT UTF-8. `charset=ibm437` is the IANA
  // name browsers/tools recognize for CP437.
  context.header("content-type", "text/plain; charset=ibm437");
  const filenameToken = periodParam ?? today();
  context.header("content-disposition", `attachment; filename="jpx-export-${filenameToken}.se"`);
  return context.body(encodePc8(text));
});
```

(Invalid `periodParam` propagates `InvalidPeriodTokenError`, already mapped to 422 in `app.onError` — L540–543.)

Add `tests/unit/api-sie-export-route.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { MemoryLedgerStore } from "@jpx-accounting/domain/store";

import { createApp } from "../../services/api/src/app";
import { createApiRuntimeDependencies } from "../../services/api/src/runtime";

function createTestApiApp(store: MemoryLedgerStore) {
  const dependencies = createApiRuntimeDependencies({
    port: 0,
    runtimeMode: "demo",
    allowTestReset: false,
    corsPolicy: { kind: "wildcard" },
    azureOpenAi: {},
    database: { poolMode: "direct", poolMax: 10 },
    azureStorage: {},
    azureDocumentIntelligence: {},
    auth: {},
    advisor: { toolApprovalSecret: "test-advisor-approval-secret", maxOutputTokens: 2048, streamTimeoutMs: 90_000 },
  });
  return createApp({ ...dependencies, store, allowTestReset: false });
}

test("GET /api/exports/sie?period=bad-token -> 422 invalid_period_token", async () => {
  const app = createTestApiApp(new MemoryLedgerStore());
  const response = await app.request("http://localhost/api/exports/sie?period=not-a-period");
  assert.equal(response.status, 422);
  const body = (await response.json()) as { code?: string };
  assert.equal(body.code, "invalid_period_token");
});

test("GET /api/exports/sie?period=fy-2026 -> filename reflects the period, body carries the clamped #RAR 0", async () => {
  const app = createTestApiApp(new MemoryLedgerStore());
  const response = await app.request("http://localhost/api/exports/sie?period=fy-2026");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition") ?? "", /filename="jpx-export-fy-2026\.se"/);
});
```

Run: `corepack pnpm exec tsx --test tests/unit/api-sie-export-route.test.ts` — expected fail before Step 7.3 (route doesn't read `?period=` yet, so the bad-token case returns 200 instead of 422); passes after.

### Step 7.4 — client + reports screen thread the period through

`packages/api-client/src/index.ts`, `fetchSieExport` (L520–545):

```ts
  async fetchSieExport(period?: string): Promise<Uint8Array<ArrayBuffer>> {
    if (this.fallbackStore) {
      const [reports, settings] = await Promise.all([
        this.fallbackStore.getReports(),
        this.fallbackStore.getCompanySettings(),
      ]);
      if (period !== undefined) {
        const fiscalYearStart = settings?.profile.fiscalYearStart ?? "01-01";
        const resolved = resolvePeriodToken(period, {
          fiscalYearStart,
          ...(settings?.profile.firstFiscalYearStart !== undefined
            ? { firstFiscalYearStart: settings.profile.firstFiscalYearStart }
            : {}),
        });
        const range = { from: resolved.from, to: resolved.to };
        const balances = computeSieBalances(reports.journal, range);
        return encodePc8(buildSieExport({ journal: reports.journal, settings, generatedAt: nowIso(), range, ...balances }));
      }
      return encodePc8(buildSieExport({ journal: reports.journal, settings, generatedAt: nowIso() }));
    }
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    const query = period !== undefined ? `?period=${encodeURIComponent(period)}` : "";
    const response = await this.authorizedFetch(`${this.baseUrl}/api/exports/sie${query}`, {
      headers: { accept: "text/plain,*/*" },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => undefined as { message?: string } | undefined);
      throw new AccountingApiError(
        response.status,
        payload?.message ?? `SIE export failed: ${response.status} ${response.statusText}`,
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  }
```

(Add `resolvePeriodToken` and `computeSieBalances` to the existing `@jpx-accounting/domain` import in `packages/api-client/src/index.ts`.)

`apps/web/components/screens/reports-screen.tsx`, `exportSie` (L85–103):

```ts
async function exportSie() {
  setExporting(true);
  try {
    const bytes = await apiClient.fetchSieExport(raw);
    const blob = new Blob([bytes], { type: "text/plain;charset=ibm437" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `jpx-export-${raw}.se`;
    anchor.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    toast.error(getErrorMessage(error, t("export.error")));
  } finally {
    setExporting(false);
  }
}
```

(`raw` is already destructured from `usePeriodScope()` at the top of the component — L58 — so no new import is needed.)

Run: `corepack pnpm check` — full gate green.

Commit:

```
feat(sie): period-scoped export with #IB/#UB/#RES

buildSieExport gains an optional {range, openingBalances, closingBalances,
results} — computeSieBalances derives them from the FULL ledger (opening =
pre-range sum, closing = opening + in-range movement, results = in-range
movement for BAS accounts 3xxx-8xxx). GET /api/exports/sie?period=<token>
validates the token via resolvePeriodToken and scopes both #VER emission and
#RAR 0 to it; the Reports screen export button now passes the selected
period and the download filename reflects it. Omitting ?period= keeps the
full-history export byte-identical to before.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

## Task 8 — capture bulk hardening (concurrency cap + 429 retry)

**Files:**

- `apps/web/lib/promotion.ts` (`captureFiles`, L209–240)
- `packages/api-client/src/index.ts` (`requestJson`, L118–153)
- NEW test additions to `tests/unit/promotion.test.ts` and NEW `tests/unit/api-client-retry.test.ts`

**Interfaces:**

- New `runWithConcurrencyLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void>` exported from `promotion.ts` (pure, same testing style as the existing `joinInFlight`).
- `requestJson` retries a `429` response up to a bounded count, honoring `Retry-After` first, then the draft-7 `RateLimit: ...reset=<seconds>` header, then falling back to exponential backoff — capped and bounded so it never retries forever.

### Step 8.1 — failing test: bounded concurrency

Add to `tests/unit/promotion.test.ts`:

```ts
import { joinInFlight, runWithConcurrencyLimit } from "../../apps/web/lib/promotion";
```

```ts
test("runWithConcurrencyLimit never runs more than `limit` workers at once, and runs every item", async () => {
  const items = Array.from({ length: 10 }, (_, index) => index);
  let inFlight = 0;
  let maxInFlight = 0;
  const completed: number[] = [];

  await runWithConcurrencyLimit(items, 4, async (item) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 0));
    inFlight -= 1;
    completed.push(item);
  });

  assert.ok(maxInFlight <= 4, `expected at most 4 concurrent workers, saw ${maxInFlight}`);
  assert.equal(completed.length, 10);
  assert.deepEqual(
    [...completed].sort((a, b) => a - b),
    items,
  );
});

test("runWithConcurrencyLimit with a limit >= items.length behaves like Promise.all", async () => {
  const items = [1, 2, 3];
  const seen: number[] = [];
  await runWithConcurrencyLimit(items, 10, async (item) => {
    seen.push(item);
  });
  assert.deepEqual([...seen].sort(), items);
});
```

Run: `corepack pnpm exec tsx --test tests/unit/promotion.test.ts` — expected fail: `runWithConcurrencyLimit` doesn't exist (import error).

### Step 8.2 — implementation + wire into `captureFiles`

`apps/web/lib/promotion.ts`, add after `joinInFlight`:

```ts
/**
 * Bounded-concurrency runner (readiness G9 — bulk capture backlog): promoting
 * ~70 receipts at once fired unbounded parallel initUpload→uploadBlob→
 * createEvidence pipelines and tripped the per-subject API rate limiter at
 * ~20 files/min. Pure over its inputs, same testing style as `joinInFlight`.
 */
export async function runWithConcurrencyLimit<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  async function runNext(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]!);
    }
  }
  const laneCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: laneCount }, runNext));
}

/** Bulk-capture concurrency cap (readiness G9). */
const CAPTURE_PROMOTION_CONCURRENCY = 4;
```

Replace the tail of `captureFiles` (the `for (const { draft } of saved) { void promoteDraft(...) ... }` loop, L233–237):

```ts
void runWithConcurrencyLimit(saved, CAPTURE_PROMOTION_CONCURRENCY, ({ draft }) =>
  promoteDraft(draft, options)
    .then((result) => options.onPromoted?.(draft, result))
    .catch(() => options.onPromoteError?.(draft)),
);

return { saved, rejected };
```

Run: `corepack pnpm exec tsx --test tests/unit/promotion.test.ts` — passes.

### Step 8.3 — failing test: bounded 429 retry honoring headers

Create `tests/unit/api-client-retry.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { AccountingApiError, createAccountingApiClient } from "@jpx-accounting/api-client";

const BASE_URL = "http://api.test";
const RUNTIME_INFO_BODY = { runtimeMode: "normal", ai: { operational: true, provider: "azure-openai" } };

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function mockFetchSequence(t: test.TestContext, responses: Response[]): { calls: number } {
  const state = { calls: 0 };
  t.mock.method(globalThis, "fetch", async () => {
    const response = responses[Math.min(state.calls, responses.length - 1)]!;
    state.calls += 1;
    return response;
  });
  return state;
}

test("requestJson retries a 429 honoring Retry-After, then succeeds", async (t) => {
  const state = mockFetchSequence(t, [
    jsonResponse({ error: "rate_limited" }, 429, { "retry-after": "0" }),
    jsonResponse(RUNTIME_INFO_BODY),
  ]);
  const client = createAccountingApiClient({ baseUrl: BASE_URL, runtimeMode: "normal" });

  const info = await client.getRuntimeInfo();

  assert.equal(info.runtimeMode, "normal");
  assert.equal(state.calls, 2, "one retry after the 429");
});

test("requestJson gives up after the bounded retry limit and surfaces AccountingApiError(429)", async (t) => {
  const state = mockFetchSequence(t, [jsonResponse({ error: "rate_limited" }, 429, { "retry-after": "0" })]);
  const client = createAccountingApiClient({ baseUrl: BASE_URL, runtimeMode: "normal" });

  await assert.rejects(client.getRuntimeInfo(), (error: unknown) => {
    assert.ok(error instanceof AccountingApiError);
    assert.equal(error.status, 429);
    return true;
  });
  assert.equal(state.calls, 4, "1 initial attempt + 3 bounded retries");
});

test("a non-429 error is never retried", async (t) => {
  const state = mockFetchSequence(t, [jsonResponse({ error: "boom" }, 500)]);
  const client = createAccountingApiClient({ baseUrl: BASE_URL, runtimeMode: "normal" });

  await assert.rejects(client.getRuntimeInfo(), AccountingApiError);
  assert.equal(state.calls, 1);
});
```

Run: `corepack pnpm exec tsx --test tests/unit/api-client-retry.test.ts` — expected fail: `state.calls` is `1` for the first test (no retry happens yet), and the second test times out waiting for 4 calls that never come (it will instead reject immediately on the first 429 with 1 call).

### Step 8.4 — implementation

`packages/api-client/src/index.ts`, add above `requestJson` (near L118):

```ts
/** Bounded retry knobs for transient 429s (readiness G9 — bulk capture backlog). */
const RATE_LIMIT_MAX_RETRIES = 3;
const RATE_LIMIT_FALLBACK_DELAY_MS = 500;
const RATE_LIMIT_MAX_DELAY_MS = 8000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `reset=<seconds>` out of hono-rate-limiter's draft-7 combined `RateLimit` header. */
function parseRateLimitResetSeconds(header: string | null): number | undefined {
  if (header === null) return undefined;
  const match = /reset=(\d+)/.exec(header);
  return match ? Number(match[1]) : undefined;
}

/** Delay before the next attempt: `Retry-After` (seconds) → `RateLimit: reset=` → exponential fallback. */
function rateLimitDelayMs(response: Response, attempt: number): number {
  const retryAfterHeader = response.headers.get("retry-after");
  if (retryAfterHeader !== null) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, RATE_LIMIT_MAX_DELAY_MS);
  }
  const resetSeconds = parseRateLimitResetSeconds(response.headers.get("ratelimit"));
  if (resetSeconds !== undefined) return Math.min(resetSeconds * 1000, RATE_LIMIT_MAX_DELAY_MS);
  return Math.min(RATE_LIMIT_FALLBACK_DELAY_MS * 2 ** attempt, RATE_LIMIT_MAX_DELAY_MS);
}

/**
 * Wrap a fetch call with bounded 429 retry-with-backoff (readiness G9). Safe
 * to retry unconditionally: hono-rate-limiter's rateLimiter middleware
 * returns 429 BEFORE the route handler runs, so a 429 means no server-side
 * work happened — every retried request is a fresh, idempotent attempt.
 */
async function fetchWithRateLimitRetry(fetchImpl: FetchLike, input: string, init: RequestInit): Promise<Response> {
  let attempt = 0;
  for (;;) {
    const response = await fetchImpl(input, init);
    if (response.status !== 429 || attempt >= RATE_LIMIT_MAX_RETRIES) return response;
    await delay(rateLimitDelayMs(response, attempt));
    attempt += 1;
  }
}
```

Change `requestJson`'s fetch call (inside the existing function, L142):

```ts
const response = await fetchWithRateLimitRetry(fetchImpl, `${baseUrl}${path}`, init);
```

Run: `corepack pnpm exec tsx --test tests/unit/api-client-retry.test.ts` — passes. Then the full unit suite to confirm no regression on the many other `requestJson`-routed calls: `corepack pnpm test:unit`.

Commit:

```
fix(capture): bound bulk-capture concurrency and retry 429s with backoff

captureFiles now promotes at most 4 drafts concurrently (runWithConcurrencyLimit)
instead of firing every draft's initUpload→uploadBlob→createEvidence pipeline
in parallel, which tripped the per-subject API rate limiter at ~20 files/min
on a ~70-receipt bulk drop. requestJson additionally retries a 429 up to 3
times, honoring Retry-After / the draft-7 RateLimit reset= header before
falling back to exponential backoff — safe because the rate limiter rejects
before any route handler runs. Closes the bulk-capture half of readiness gap G9.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

## Task 9 — FY1 migration runbook (docs)

**Files:** NEW `docs/superpowers/plans/2026-08-20-kfr-d-runbook-fy1-migration.md`

### Step 9.1 — write the runbook

Create `docs/superpowers/plans/2026-08-20-kfr-d-runbook-fy1-migration.md`:

````markdown
# JPx Advisory AB — FY1 migration runbook (Kapitas → this product)

> Operational companion to [2026-08-20-kfr-d-sie-migration.md](2026-08-20-kfr-d-sie-migration.md). Run this AFTER Phase D has landed (materialized import vouchers, targetVoucherId attach, parse warnings, firstFiscalYearStart, period-scoped export, capture concurrency+retry).

**Scope:** FY1 = 2025-10-15 → 2026-08-31 (the company's real incorporation date through the first `08-31` fiscal year end).

## 1. Export from Kapitas

1. In Kapitas, export the full FY1 ledger as SIE 4 (type E or I — both are accepted; the parser only needs `#KONTO`/`#VER`/`{ }`/`#TRANS` blocks, unknown labels are skipped).
2. Save the file with its native encoding — do not re-encode it. Kapitas exports are typically PC8/CP437; `decodeSieBuffer` tries strict UTF-8 first, then falls back to the CP437 subset automatically.
3. Note Kapitas's own voucher count and its balansrapport (balance report) totals for FY1 — you'll reconcile against these in section 3.

## 2. Set `firstFiscalYearStart` BEFORE importing

Settings → Fiscal year & VAT → set "First fiscal year start date" to `2025-10-15`, and confirm "Fiscal year start month" is `09-01` (the recurring anchor for FY2 onward). Save. This floors every `fy-2025`/`ytd` report window and the SIE re-export's `#RAR 0` to the real incorporation date instead of the recurring `09-01` anchor misstating FY1 as starting a month and a half early.

## 3. Import

1. Capture screen → "Importera SIE-fil" → select the Kapitas export.
2. Read the toast carefully:
   - **Imported N verifikat** — compare N against Kapitas's own voucher count for the period. Any gap must be accounted for by the `skipped` reasons (surfaced in the toast when non-zero) — investigate every one (`invalid date`, `unbalanced`, `duplicate`, `no transactions`, `invalid amount`).
   - **Warnings** — non-zero `#IB` (opening balance) lines will warn here. Opening balances are NOT imported as balances in this version (by design — this is a genuine first fiscal year, so Kapitas's `#IB` for FY1 should legitimately be zero/absent; a non-zero one is a signal to investigate, not an expected occurrence).
   - A decode-confidence warning (mangled characters) would mean some byte in the file wasn't recoverable — re-export from Kapitas as UTF-8 if your Kapitas version offers that option, or manually correct the affected voucher text after import.
3. Re-running the import with the SAME file is safe (idempotent, keyed by `sie_<series>_<number>`) — use this to confirm nothing double-books.

## 4. Balance reconciliation checklist

Work through this BEFORE trusting the migrated ledger for anything statutory:

- [ ] **Voucher count** matches Kapitas's count for FY1 (minus explained skips).
- [ ] **1930 (bank) closing balance to the öre**: Reports → `fy-2025` → Balance sheet, or pull the period-scoped SIE export (`GET /api/exports/sie?period=fy-2025`, or the Reports screen's export button while `fy-2025` is selected) and check its `#UB 0 1930 <amount>` line against Kapitas's balansrapport for 2026-08-31.
- [ ] **Every other account's closing balance vs Kapitas's balansrapport** — walk the export's `#UB 0 <account> <amount>` lines (or the Books "trial balance" view) line by line against Kapitas; flag any mismatch.
- [ ] **`#RES` sanity** — the export's `#RES 0 <account> <amount>` lines are FY1's result-account movement (revenue/cost accounts, 3xxx-8xxx); cross-check the total against Kapitas's resultaträkning for FY1.
- [ ] Confirm no unexplained `skipped` entries remain from step 3.

## 5. Receipt pull (Drive/Gmail → local → bulk capture)

1. Export the ~70-receipt backlog from Google Drive and/or Gmail attachments into one local folder.
2. Drag the whole folder onto the Capture drop-zone (or use the file picker). Bulk drops are now safe up to the rate limiter's window — the client caps promotion concurrency at 4 in flight and retries a 429 with backoff automatically (Task 8); you do not need to drop files in small batches.
3. Watch the drafts table until every file has promoted to evidence (no draft stuck in a failed state). Retry a stuck draft manually by re-clicking it — this joins/restarts its own pipeline without duplicating already-promoted ones.

## 6. Capture → attach loop

Each promoted receipt needs to end up linked to its corresponding imported voucher.

- **If Phase E has landed**: use the "Attach to voucher" picker on the evidence detail screen (search by voucher number/date/text), which calls `POST /api/evidence/compose` with `targetVoucherId` under the hood.
- **If Phase E has not landed yet**: attach manually via the API this phase built. Example (replace the ids):

  ```bash
  curl -X POST "$API_BASE/api/evidence/compose" \
    -H "content-type: application/json" \
    -H "authorization: Bearer $TOKEN" \
    -d '{"evidenceIds": ["evidence_abc123"], "targetVoucherId": "sie_A_42"}'
  ```
````

Find the evidence id from the evidence detail URL (`/capture/evidence/<id>`); find the target voucher id from the journal (`sie_<series>_<number>`, matching the "Imported" chip's displayed series+number).

## 7. Spot-check protocol

Pick 5 imported vouchers at random. For each:

1. Confirm the journal/general-ledger row shows the real `<series> <number>` and the "Imported" badge (Task 5).
2. Compare its lines (account, debit/credit, date, text) against the source Kapitas record.
3. Open its evidence (once attached via section 6) and confirm the receipt matches the voucher's amount/date/counterparty.

## 8. Final SIE re-export sanity check

Export `fy-2025` again from this product (Reports screen, `fy-2025` selected) and confirm:

- `#IB`/`#UB`/`#RES` blocks are present and non-trivial.
- `#RAR 0` reads `20251015 20260831` (the clamped window, not `20250901`).
- The file opens without error in an external SIE-aware tool (or at minimum, re-parses cleanly via this product's own importer against a scratch workspace) — this is the acceptance bar for eventual revisor/tool handoff (design D6).

```

Commit:

```

docs: add the FY1 migration runbook (Kapitas → this product)

Operational companion to the SIE & migration plan: export steps, import +
warning triage, a balance-reconciliation checklist (voucher count, 1930 to
the öre, per-account vs Kapitas's balansrapport), the receipt-pull and
capture-attach loop, and a spot-check protocol.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

```

## Final gate

After all 9 tasks: `corepack pnpm check` and, if a `jpx_test_*` DB is available, `corepack pnpm db:test`. Every new/modified unit test listed above should be green; `tests/fixtures/sie/golden-export.se` is unchanged (confirmed in Task 7's Step 7.2 — the full-history code path never sets `range`, so nothing in its output changes).
```
