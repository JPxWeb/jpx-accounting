# Auth & Database Operations Implementation Plan

> **Superseded (2026-05-19):** Use the active checklist in [`2026-05-19-supabase-backend-track.md`](./2026-05-19-supabase-backend-track.md). This file is kept as historical reference for auth/SSR task snippets.

> **Progress:** Partial — `SupabaseLedgerStore` writes, `authMiddleware`, `packages/supabase-client`. See [DEV_STATUS.md](../../DEV_STATUS.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-memory demo scaffold with Supabase Auth (JWT-based) and a `SupabaseLedgerStore` that reads/writes the existing Postgres schema, so normal mode becomes functional end-to-end.

**Architecture:** Supabase Auth issues JWTs. The Next.js web app manages sessions via `@supabase/ssr` middleware. The API proxy forwards the `Authorization` header (already implemented). The Hono API validates JWTs, extracts `organization_id` from claims, sets the Postgres `app.organization_id` session variable for RLS, and delegates to `SupabaseLedgerStore`. Demo mode remains unchanged.

**Tech Stack:** `@supabase/supabase-js` (API + shared), `@supabase/ssr` (Next.js), Hono middleware, Postgres via Supabase client, existing Zod schemas from `@jpx-accounting/contracts`.

---

## File Structure

| Action | Path                                        | Responsibility                                                       |
| ------ | ------------------------------------------- | -------------------------------------------------------------------- |
| Create | `packages/supabase-client/src/index.ts`     | Shared Supabase client factory (server-side, with service role key)  |
| Create | `packages/supabase-client/package.json`     | Package config                                                       |
| Create | `packages/supabase-client/tsconfig.json`    | TypeScript config                                                    |
| Create | `packages/domain/src/supabase-store.ts`     | `SupabaseLedgerStore` implementing `LedgerStore` interface           |
| Create | `services/api/src/middleware/auth.ts`       | Hono middleware: JWT verification + RLS session variable             |
| Create | `apps/web/src/lib/supabase/server.ts`       | Server-side Supabase client for Next.js (cookie-based)               |
| Create | `apps/web/src/lib/supabase/client.ts`       | Browser-side Supabase client for Next.js                             |
| Create | `apps/web/middleware.ts`                    | Next.js middleware: session refresh + redirect unauthenticated users |
| Create | `apps/web/app/auth/login/page.tsx`          | Login page (email/password)                                          |
| Create | `apps/web/app/auth/callback/route.ts`       | OAuth/magic-link callback handler                                    |
| Modify | `services/api/src/config.ts`                | Add `supabaseUrl`, `supabaseServiceRoleKey` to config                |
| Modify | `services/api/src/runtime.ts`               | Wire `SupabaseLedgerStore` in normal mode                            |
| Modify | `services/api/src/app.ts`                   | Apply auth middleware to `/api/*` routes in normal mode              |
| Modify | `apps/web/app/api-proxy/[...path]/route.ts` | Forward Supabase auth cookie as Bearer token                         |
| Modify | `apps/web/app/layout.tsx`                   | Conditionally wrap with auth provider                                |
| Modify | `packages/contracts/src/index.ts`           | Add `userProfileSchema` for auth claims                              |
| Create | `tests/unit/supabase-store.test.ts`         | Unit tests for `SupabaseLedgerStore`                                 |
| Create | `tests/unit/auth-middleware.test.ts`        | Unit tests for Hono auth middleware                                  |

---

## Task 1: Add `userProfileSchema` to contracts

**Files:**

- Modify: `packages/contracts/src/index.ts`

This schema represents the authenticated user's identity as extracted from a Supabase JWT. It's used by the auth middleware and passed through to store methods.

- [ ] **Step 1: Add user profile schema and type export**

Add after the existing `roleSchema` block (around line 8) in `packages/contracts/src/index.ts`:

```typescript
export const userProfileSchema = z.object({
  userId: z.string(),
  email: z.string().email(),
  organizationId: z.string(),
  workspaceId: z.string(),
  role: roleSchema,
});

export type UserProfile = z.infer<typeof userProfileSchema>;
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (new schema is additive, no breaking changes)

- [ ] **Step 3: Commit**

```bash
git add packages/contracts/src/index.ts
git commit -m "feat(contracts): add userProfileSchema for auth claims"
```

---

## Task 2: Create `packages/supabase-client` shared package

**Files:**

- Create: `packages/supabase-client/package.json`
- Create: `packages/supabase-client/tsconfig.json`
- Create: `packages/supabase-client/src/index.ts`

This package exposes a factory that creates a Supabase client configured with the service role key. It's used by both the API (for RLS-bypassing admin operations) and the domain store (for per-request scoped queries).

- [ ] **Step 1: Create package.json**

Create `packages/supabase-client/package.json`:

```json
{
  "name": "@jpx-accounting/supabase-client",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.49.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Create `packages/supabase-client/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Write the Supabase client factory**

Create `packages/supabase-client/src/index.ts`:

```typescript
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type { SupabaseClient } from "@supabase/supabase-js";

export type SupabaseClientConfig = {
  url: string;
  serviceRoleKey: string;
};

/**
 * Creates a Supabase admin client using the service role key.
 * This client bypasses RLS — use only on the server side.
 */
export function createServiceClient(config: SupabaseClientConfig): SupabaseClient {
  return createClient(config.url, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Creates a Supabase client scoped to a specific user's JWT.
 * RLS policies will apply based on the token's claims.
 */
export function createScopedClient(config: SupabaseClientConfig, accessToken: string): SupabaseClient {
  return createClient(config.url, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}
```

- [ ] **Step 4: Add path alias to tsconfig.base.json**

Add to the `paths` object in `tsconfig.base.json`:

```json
"@jpx-accounting/supabase-client": ["packages/supabase-client/src/index.ts"]
```

- [ ] **Step 5: Install dependencies**

Run: `pnpm install`
Expected: Installs `@supabase/supabase-js` into the new workspace package.

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/supabase-client/ tsconfig.base.json pnpm-lock.yaml
git commit -m "feat: add @jpx-accounting/supabase-client shared package"
```

---

## Task 3: Implement `SupabaseLedgerStore`

**Files:**

- Create: `packages/domain/src/supabase-store.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/package.json`

This is the core task. `SupabaseLedgerStore` implements the `LedgerStore` interface against the Postgres schema defined in `supabase/migrations/20260324000000_schema_v2.sql`. Each method maps to SQL queries via the Supabase client. The store receives a scoped client (with RLS) and an organization/workspace context.

- [ ] **Step 1: Add supabase-client dependency to domain package**

In `packages/domain/package.json`, add to `dependencies`:

```json
"@jpx-accounting/supabase-client": "workspace:*"
```

- [ ] **Step 2: Write the failing test for createEvidence**

Create `tests/unit/supabase-store.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { SupabaseLedgerStore } from "@jpx-accounting/domain";

// We test against a mock Supabase client to verify SQL mapping
// without requiring a running database.

function createMockSupabaseClient(responses: Map<string, unknown>) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];

  function mockTable(table: string) {
    return {
      insert: (data: unknown) => {
        calls.push({ table, method: "insert", args: [data] });
        return {
          select: () => ({
            single: async () => ({ data: responses.get(`${table}.insert`) ?? data, error: null }),
          }),
          then: async (resolve: (v: unknown) => void) => resolve({ data, error: null }),
        };
      },
      select: (columns?: string) => {
        calls.push({ table, method: "select", args: [columns] });
        const chain = {
          eq: (_col: string, _val: string) => chain,
          order: (_col: string, _opts?: unknown) => chain,
          single: async () => ({ data: responses.get(`${table}.select.single`) ?? null, error: null }),
          then: async (resolve: (v: unknown) => void) =>
            resolve({ data: responses.get(`${table}.select`) ?? [], error: null }),
        };
        return chain;
      },
      update: (data: unknown) => {
        calls.push({ table, method: "update", args: [data] });
        return {
          eq: (_col: string, _val: string) => ({
            select: () => ({
              single: async () => ({ data: responses.get(`${table}.update`) ?? data, error: null }),
            }),
          }),
        };
      },
    };
  }

  const client = {
    from: (table: string) => mockTable(table),
    rpc: async (fn: string, params: unknown) => {
      calls.push({ table: "rpc", method: fn, args: [params] });
      return { data: responses.get(`rpc.${fn}`) ?? null, error: null };
    },
  };

  return { client: client as never, calls };
}

test("SupabaseLedgerStore.createEvidence inserts evidence, packet, voucher, and review", async () => {
  const responses = new Map<string, unknown>();
  const { client, calls } = createMockSupabaseClient(responses);

  const store = new SupabaseLedgerStore(client, {
    organizationId: "org_test",
    workspaceId: "ws_test",
  });

  const result = store.createEvidence({
    organizationId: "org_test",
    workspaceId: "ws_test",
    actorId: "user_1",
    title: "Test invoice",
    originalFilename: "test.pdf",
    mimeType: "application/pdf",
    modalities: ["pdf", "upload"],
  });

  // Verify that 4 tables were written to: evidence_objects, evidence_packets,
  // evidence_packet_items, vouchers (+ review_tasks, suggestions, events)
  const insertedTables = calls.filter((c) => c.method === "insert").map((c) => c.table);

  assert.ok(insertedTables.includes("ledger.evidence_objects"), "should insert evidence");
  assert.ok(insertedTables.includes("ledger.vouchers"), "should insert voucher");
  assert.ok(insertedTables.includes("ledger.review_tasks"), "should insert review");
  assert.ok(result.evidence, "should return evidence");
  assert.ok(result.voucher, "should return voucher");
  assert.ok(result.review, "should return review");
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `tsx --test tests/unit/supabase-store.test.ts`
Expected: FAIL — `SupabaseLedgerStore` is not exported from `@jpx-accounting/domain`

- [ ] **Step 4: Implement SupabaseLedgerStore**

Create `packages/domain/src/supabase-store.ts`:

```typescript
import type { SupabaseClient } from "@jpx-accounting/supabase-client";
import type {
  AccountingSuggestion,
  AssistantSession,
  CloseRun,
  ComplianceAlert,
  EvidenceComposeInput,
  EvidenceCreateInput,
  EvidenceCreateResult,
  EvidenceObject,
  EvidencePacket,
  LedgerEvent,
  ReportBundle,
  ReviewDecisionInput,
  ReviewTask,
  SimulationRequest,
  SimulationRun,
  Voucher,
  WorkspaceSnapshot,
  ExtractedField,
} from "@jpx-accounting/contracts";

import type { LedgerStore, ReviewAction } from "./store";
import { buildJournal, buildBalances, buildVat } from "./projections";
import { buildDeterministicSuggestion, evaluateVoucherRules } from "./rules";
import { buildEventHash } from "./hash-chain";
import { createId, nowIso } from "./ids";

type StoreContext = {
  organizationId: string;
  workspaceId: string;
};

export class SupabaseLedgerStore implements LedgerStore {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly ctx: StoreContext,
  ) {}

  // ── helpers ──────────────────────────────────────────────

  private async appendEvent(
    event: Omit<LedgerEvent, "id" | "eventHash" | "previousHash" | "digestDate" | "organizationId" | "workspaceId">,
  ): Promise<LedgerEvent> {
    // Fetch last event hash for chain continuity
    const { data: lastEvent } = await this.supabase
      .from("ledger.events")
      .select("event_hash")
      .eq("organization_id", this.ctx.organizationId)
      .eq("workspace_id", this.ctx.workspaceId)
      .order("sequence_number", { ascending: false })
      .limit(1)
      .single();

    const previousHash = lastEvent?.event_hash ?? "GENESIS";
    const payload = JSON.stringify(event.payload);
    const eventHash = buildEventHash(previousHash, payload);
    const digestDate = new Date().toISOString().slice(0, 10);

    const fullEvent = {
      id: createId("evt"),
      organization_id: this.ctx.organizationId,
      workspace_id: this.ctx.workspaceId,
      aggregate_type: event.aggregateType,
      aggregate_id: event.aggregateId,
      event_type: event.eventType,
      actor_id: event.actorId,
      occurred_at: event.occurredAt,
      payload: event.payload,
      previous_hash: previousHash,
      event_hash: eventHash,
      digest_date: digestDate,
    };

    const { error } = await this.supabase.from("ledger.events").insert(fullEvent);
    if (error) throw new Error(`Failed to append event: ${error.message}`);

    return this.mapEventRow(fullEvent);
  }

  private mapEventRow(row: Record<string, unknown>): LedgerEvent {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      workspaceId: row.workspace_id as string,
      aggregateType: row.aggregate_type as string,
      aggregateId: row.aggregate_id as string,
      eventType: row.event_type as string,
      actorId: row.actor_id as string,
      occurredAt: row.occurred_at as string,
      payload: row.payload as Record<string, unknown>,
      previousHash: row.previous_hash as string,
      eventHash: row.event_hash as string,
      digestDate: row.digest_date as string,
    };
  }

  private mapEvidenceRow(row: Record<string, unknown>): EvidenceObject {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      workspaceId: row.workspace_id as string,
      createdAt: row.created_at as string,
      createdBy: row.created_by as string,
      title: row.title as string,
      modalities: row.modalities as string[],
      originalFilename: row.original_filename as string,
      mimeType: row.mime_type as string,
      blobPath: row.blob_path as string,
      hash: row.hash as string,
      trustLevel: row.trust_level as "official" | "internal" | "user-upload",
    };
  }

  private mapVoucherRow(row: Record<string, unknown>): Voucher {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      workspaceId: row.workspace_id as string,
      evidencePacketId: row.evidence_packet_id as string,
      voucherNumber: row.voucher_number as string,
      status: row.status as string,
      accountingMethod: row.accounting_method as string,
      extractedFields: row.extracted_fields as ExtractedField[],
      voucherFields: row.voucher_fields as Voucher["voucherFields"],
      createdAt: row.created_at as string,
      createdBy: row.created_by as string,
    };
  }

  private mapReviewRow(row: Record<string, unknown>): ReviewTask {
    return {
      id: row.id as string,
      voucherId: row.voucher_id as string,
      title: row.title as string,
      status: row.status as string,
      blockedReason: (row.blocked_reason as string) ?? undefined,
      suggestedAction: row.suggested_action as string,
      suggestion: (row.suggestion as AccountingSuggestion) ?? undefined,
      provenanceTimeline: row.provenance_timeline as ReviewTask["provenanceTimeline"],
    };
  }

  // ── LedgerStore interface ────────────────────────────────

  createEvidence(input: EvidenceCreateInput): EvidenceCreateResult {
    const createdAt = nowIso();
    const evidenceId = createId("evidence");
    const packetId = createId("packet");
    const voucherId = createId("voucher");

    const evidence: EvidenceObject = {
      id: evidenceId,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      createdAt,
      createdBy: input.actorId,
      title: input.title,
      modalities: input.modalities,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      blobPath: `evidence/${evidenceId}/${input.originalFilename}`,
      hash: buildEventHash("file", `${input.originalFilename}:${input.title}:${createdAt}`),
      trustLevel: "user-upload",
    };

    const extractedFields = this.buildExtractedFields(input);
    const voucher: Voucher = {
      id: voucherId,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      evidencePacketId: packetId,
      voucherNumber: `V-${Date.now() % 100000}`,
      status: "needs-review",
      accountingMethod: input.title.toLowerCase().includes("invoice") ? "invoice" : "cash",
      extractedFields,
      voucherFields: {
        supplierName: extractedFields.find((f) => f.key === "supplierName")?.value,
        supplierVatNumber: extractedFields.find((f) => f.key === "supplierVatNumber")?.value,
        invoiceNumber: extractedFields.find((f) => f.key === "invoiceNumber")?.value,
        receiptDate: extractedFields.find((f) => f.key === "receiptDate")?.value,
        transactionDate: extractedFields.find((f) => f.key === "transactionDate")?.value,
        description: input.title,
        grossAmount: 0,
        netAmount: 0,
        vatAmount: 0,
        vatRate: 25,
        currency: "SEK",
      },
      createdAt,
      createdBy: input.actorId,
    };

    const ruleHits = evaluateVoucherRules(voucher);
    const suggestion = buildDeterministicSuggestion(voucher, ruleHits);

    const review: ReviewTask = {
      id: createId("review"),
      voucherId,
      title: `Review ${voucher.voucherNumber}`,
      status: "needs-review",
      blockedReason: ruleHits.some((r) => r.severity === "blocking")
        ? "Mandatory bookkeeping or VAT data must be confirmed before deductible VAT can be approved."
        : undefined,
      suggestedAction: ruleHits.some((r) => r.severity === "blocking")
        ? "Request more evidence or post without VAT deduction."
        : "Approve the proposed posting.",
      suggestion,
      provenanceTimeline: [
        { id: createId("step"), label: "Evidence received", timestamp: createdAt, actor: input.actorId },
        { id: createId("step"), label: "Fields extracted", timestamp: createdAt, actor: "system-extractor" },
        { id: createId("step"), label: "Rules applied", timestamp: createdAt, actor: "system-rules" },
        { id: createId("step"), label: "Suggestion generated", timestamp: createdAt, actor: "system-ai" },
      ],
    };

    const packet: EvidencePacket = {
      id: packetId,
      evidenceIds: [evidenceId],
      note: input.note,
      voiceTranscript: input.extractedText,
    };

    // Fire-and-forget: persist to Supabase asynchronously.
    // The method signature is synchronous (matching the LedgerStore interface),
    // so we kick off the writes without awaiting.
    this.persistCreateEvidence(evidence, packet, voucher, review, suggestion, input).catch((err) =>
      console.error("Failed to persist evidence:", err),
    );

    return { evidence, packet, voucher, review, voucherId };
  }

  private async persistCreateEvidence(
    evidence: EvidenceObject,
    packet: EvidencePacket,
    voucher: Voucher,
    review: ReviewTask,
    suggestion: AccountingSuggestion,
    input: EvidenceCreateInput,
  ) {
    // Insert evidence object
    await this.supabase.from("ledger.evidence_objects").insert({
      id: evidence.id,
      organization_id: evidence.organizationId,
      workspace_id: evidence.workspaceId,
      title: evidence.title,
      modalities: evidence.modalities,
      created_by: evidence.createdBy,
      created_at: evidence.createdAt,
      original_filename: evidence.originalFilename,
      mime_type: evidence.mimeType,
      blob_path: evidence.blobPath,
      hash: evidence.hash,
      trust_level: evidence.trustLevel,
    });

    // Insert evidence packet
    await this.supabase.from("ledger.evidence_packets").insert({
      id: packet.id,
      organization_id: this.ctx.organizationId,
      workspace_id: this.ctx.workspaceId,
      note: packet.note ?? null,
      voice_transcript: packet.voiceTranscript ?? null,
    });

    // Link evidence to packet
    await this.supabase.from("ledger.evidence_packet_items").insert({
      evidence_packet_id: packet.id,
      evidence_object_id: evidence.id,
    });

    // Insert voucher
    await this.supabase.from("ledger.vouchers").insert({
      id: voucher.id,
      organization_id: voucher.organizationId,
      workspace_id: voucher.workspaceId,
      evidence_packet_id: voucher.evidencePacketId,
      voucher_number: voucher.voucherNumber,
      accounting_method: voucher.accountingMethod,
      status: voucher.status,
      voucher_fields: voucher.voucherFields,
      extracted_fields: voucher.extractedFields,
      created_by: voucher.createdBy,
      created_at: voucher.createdAt,
    });

    // Insert suggestion
    await this.supabase.from("ledger.suggestions").insert({
      id: suggestion.id,
      voucher_id: suggestion.voucherId,
      account_number: suggestion.accountNumber,
      account_name: suggestion.accountName,
      vat_code: suggestion.vatCode,
      confidence: suggestion.confidence,
      reasoning: suggestion.reasoning,
      kind: suggestion.kind,
      citations: suggestion.citations,
      rule_hits: suggestion.ruleHits,
    });

    // Insert review task
    await this.supabase.from("ledger.review_tasks").insert({
      id: review.id,
      organization_id: this.ctx.organizationId,
      workspace_id: this.ctx.workspaceId,
      voucher_id: review.voucherId,
      title: review.title,
      status: review.status,
      blocked_reason: review.blockedReason ?? null,
      suggested_action: review.suggestedAction,
      suggestion: review.suggestion ?? null,
      provenance_timeline: review.provenanceTimeline,
    });

    // Append domain events
    await this.appendEvent({
      aggregateType: "evidence",
      aggregateId: evidence.id,
      eventType: "EvidenceReceived",
      actorId: input.actorId,
      occurredAt: evidence.createdAt,
      payload: evidence as unknown as Record<string, unknown>,
    });

    await this.appendEvent({
      aggregateType: "voucher",
      aggregateId: voucher.id,
      eventType: "VoucherCreated",
      actorId: input.actorId,
      occurredAt: evidence.createdAt,
      payload: voucher as unknown as Record<string, unknown>,
    });

    await this.appendEvent({
      aggregateType: "review",
      aggregateId: review.id,
      eventType: "SuggestionGenerated",
      actorId: "system-ai",
      occurredAt: evidence.createdAt,
      payload: suggestion as unknown as Record<string, unknown>,
    });
  }

  private buildExtractedFields(input: EvidenceCreateInput): ExtractedField[] {
    return [
      { key: "supplierName", label: "Supplier", value: this.guessSupplier(input), confidence: 0.71, required: true },
      {
        key: "receiptDate",
        label: "Receipt date",
        value: new Date().toISOString().slice(0, 10),
        confidence: 0.98,
        required: true,
      },
      {
        key: "transactionDate",
        label: "Transaction date",
        value: new Date().toISOString().slice(0, 10),
        confidence: 0.85,
        required: false,
      },
      { key: "grossAmount", label: "Gross amount", value: "0", confidence: 0.5, required: true },
      {
        key: "invoiceNumber",
        label: "Invoice number",
        value: input.originalFilename.replace(/\W+/g, "-"),
        confidence: 0.61,
        required: false,
      },
      { key: "supplierVatNumber", label: "VAT number", value: "", confidence: 0.1, required: false },
    ];
  }

  private guessSupplier(input: EvidenceCreateInput): string {
    const value = `${input.title} ${input.originalFilename} ${input.extractedText ?? ""}`.toLowerCase();
    if (value.includes("microsoft")) return "Microsoft Ireland";
    if (value.includes("openai")) return "OpenAI Ireland";
    if (value.includes("ica")) return "ICA Maxi";
    if (value.includes("sl")) return "Storstockholms Lokaltrafik";
    return "Unclassified supplier";
  }

  composeEvidence(input: EvidenceComposeInput): EvidencePacket {
    const packet: EvidencePacket = {
      id: createId("packet"),
      evidenceIds: input.evidenceIds,
      note: input.note,
      voiceTranscript: input.voiceTranscript,
    };

    this.supabase
      .from("ledger.evidence_packets")
      .insert({
        id: packet.id,
        organization_id: this.ctx.organizationId,
        workspace_id: this.ctx.workspaceId,
        note: packet.note ?? null,
        voice_transcript: packet.voiceTranscript ?? null,
      })
      .then(() =>
        Promise.all(
          input.evidenceIds.map((eid) =>
            this.supabase.from("ledger.evidence_packet_items").insert({
              evidence_packet_id: packet.id,
              evidence_object_id: eid,
            }),
          ),
        ),
      )
      .catch((err) => console.error("Failed to persist composed packet:", err));

    return packet;
  }

  getEvidenceContext(evidenceId: string) {
    // Note: This method is synchronous in the interface but needs async DB access.
    // For the initial implementation, we return undefined and log.
    // TODO: The LedgerStore interface should be made async in a follow-up.
    console.warn("SupabaseLedgerStore.getEvidenceContext: sync interface limitation — returning undefined");
    return undefined;
  }

  findReviewByVoucher(voucherId: string) {
    console.warn("SupabaseLedgerStore.findReviewByVoucher: sync interface limitation — returning undefined");
    return undefined;
  }

  getReviewFeed(): ReviewTask[] {
    console.warn("SupabaseLedgerStore.getReviewFeed: sync interface limitation — returning []");
    return [];
  }

  getReports(): ReportBundle {
    return { journal: [], balances: [], vat: [] };
  }

  getSnapshot(): WorkspaceSnapshot {
    return {
      evidence: [],
      vouchers: [],
      reviews: [],
      reports: this.getReports(),
      assistantExamples: [],
      closeRun: this.getCloseRun(),
      alerts: [],
    };
  }

  getEvents(): LedgerEvent[] {
    return [];
  }

  suggestVoucher(voucherId: string) {
    return undefined;
  }

  applyReviewDecision(reviewId: string, action: ReviewAction, input: ReviewDecisionInput) {
    return undefined;
  }

  answerAssistantQuestion(question: string): AssistantSession {
    return {
      id: createId("assistant"),
      question,
      answer: "Database-backed assistant sessions are not yet implemented.",
      status: "grounded",
      citations: [],
    };
  }

  runSimulation(input: SimulationRequest): SimulationRun {
    return {
      id: createId("sim"),
      title: input.title,
      scenario: input.scenario,
      outcomeSummary: "Database-backed simulations are not yet implemented.",
      affectedAccounts: [],
    };
  }

  getCloseRun(): CloseRun {
    return {
      id: "close_current",
      period: new Date().toISOString().slice(0, 7),
      generatedAt: nowIso(),
      checklist: [
        { id: "close_1", label: "Confirm all uploaded evidence has a linked voucher", status: "open" },
        { id: "close_2", label: "Review blocked VAT deductions", status: "open" },
        { id: "close_3", label: "Export SIE package for accountant review", status: "open" },
      ],
    };
  }
}
```

- [ ] **Step 5: Export SupabaseLedgerStore from domain index**

Add to `packages/domain/src/index.ts`:

```typescript
export { SupabaseLedgerStore } from "./supabase-store";
```

- [ ] **Step 6: Install dependencies and run test**

Run: `pnpm install && tsx --test tests/unit/supabase-store.test.ts`
Expected: PASS — mock client captures insert calls for the expected tables

- [ ] **Step 7: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/supabase-store.ts packages/domain/src/index.ts packages/domain/package.json tests/unit/supabase-store.test.ts pnpm-lock.yaml
git commit -m "feat(domain): add SupabaseLedgerStore with Postgres-backed createEvidence"
```

---

## Task 4: Make the `LedgerStore` interface async

**Files:**

- Modify: `packages/domain/src/store.ts`
- Modify: `packages/domain/src/supabase-store.ts`
- Modify: `services/api/src/app.ts`
- Modify: `packages/api-client/src/index.ts`

The current `LedgerStore` interface is synchronous (returns values directly). Database operations are inherently async. This task changes all read methods to return `Promise<T>` so `SupabaseLedgerStore` can query Postgres properly.

- [ ] **Step 1: Write a failing test for async getReviewFeed**

Add to `tests/unit/supabase-store.test.ts`:

```typescript
test("SupabaseLedgerStore.getReviewFeed returns reviews from database", async () => {
  const mockReview = {
    id: "review_1",
    voucher_id: "voucher_1",
    title: "Review V-1001",
    status: "needs-review",
    blocked_reason: null,
    suggested_action: "Approve the proposed posting.",
    suggestion: null,
    provenance_timeline: [],
  };

  const responses = new Map<string, unknown>([["ledger.review_tasks.select", [mockReview]]]);
  const { client } = createMockSupabaseClient(responses);

  const store = new SupabaseLedgerStore(client, {
    organizationId: "org_test",
    workspaceId: "ws_test",
  });

  const feed = await store.getReviewFeed();
  assert.equal(feed.length, 1);
  assert.equal(feed[0]!.id, "review_1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tsx --test tests/unit/supabase-store.test.ts`
Expected: FAIL — `getReviewFeed()` returns `[]` synchronously, not a Promise

- [ ] **Step 3: Update LedgerStore interface to be async**

In `packages/domain/src/store.ts`, change the interface:

```typescript
export interface LedgerStore {
  createEvidence(input: EvidenceCreateInput): EvidenceCreateResult | Promise<EvidenceCreateResult>;
  composeEvidence(input: EvidenceComposeInput): EvidencePacket | Promise<EvidencePacket>;
  getEvidenceContext(
    evidenceId: string,
  ):
    | { evidence: EvidenceObject; packet?: EvidencePacket; voucher?: Voucher }
    | undefined
    | Promise<{ evidence: EvidenceObject; packet?: EvidencePacket; voucher?: Voucher } | undefined>;
  findReviewByVoucher(voucherId: string): ReviewTask | undefined | Promise<ReviewTask | undefined>;
  getReviewFeed(): ReviewTask[] | Promise<ReviewTask[]>;
  getReports(): ReportBundle | Promise<ReportBundle>;
  getSnapshot(): WorkspaceSnapshot | Promise<WorkspaceSnapshot>;
  getEvents(): LedgerEvent[] | Promise<LedgerEvent[]>;
  suggestVoucher(voucherId: string): AccountingSuggestion | undefined | Promise<AccountingSuggestion | undefined>;
  applyReviewDecision(
    reviewId: string,
    action: ReviewAction,
    input: ReviewDecisionInput,
  ): ReviewTask | undefined | Promise<ReviewTask | undefined>;
  answerAssistantQuestion(question: string): AssistantSession | Promise<AssistantSession>;
  runSimulation(input: SimulationRequest): SimulationRun | Promise<SimulationRun>;
  getCloseRun(): CloseRun | Promise<CloseRun>;
}
```

- [ ] **Step 4: Update all route handlers in app.ts to await store calls**

In `services/api/src/app.ts`, add `await` to every `currentStore.*` call. For example:

```typescript
// Before:
app.get("/api/workspace", (context) => {
  return context.json(currentStore.getSnapshot());
});

// After:
app.get("/api/workspace", async (context) => {
  return context.json(await currentStore.getSnapshot());
});
```

Apply this pattern to every route that calls `currentStore`.

- [ ] **Step 5: Update SupabaseLedgerStore read methods to be async**

In `packages/domain/src/supabase-store.ts`, implement async reads. Example for `getReviewFeed`:

```typescript
async getReviewFeed(): Promise<ReviewTask[]> {
  const { data, error } = await this.supabase
    .from("ledger.review_tasks")
    .select("*")
    .eq("organization_id", this.ctx.organizationId)
    .eq("workspace_id", this.ctx.workspaceId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch review feed: ${error.message}`);
  return (data ?? []).map((row: Record<string, unknown>) => this.mapReviewRow(row));
}
```

Implement the same pattern for: `getEvidenceContext`, `findReviewByVoucher`, `getReports`, `getSnapshot`, `getEvents`, `suggestVoucher`, `applyReviewDecision`.

- [ ] **Step 6: Update api-client to handle async consistently**

In `packages/api-client/src/index.ts`, ensure the fallback store calls use `await`:

```typescript
async getSnapshot(): Promise<WorkspaceSnapshot> {
  if (this.fallbackStore) return await this.fallbackStore.getSnapshot();
  return request<WorkspaceSnapshot>(this.requireBaseUrl(), "/api/workspace");
}
```

- [ ] **Step 7: Run all tests**

Run: `pnpm typecheck && pnpm test:unit`
Expected: PASS — `MemoryLedgerStore` still works (sync values are valid Promises via union type), Supabase store now returns real Promises.

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/store.ts packages/domain/src/supabase-store.ts services/api/src/app.ts packages/api-client/src/index.ts tests/unit/supabase-store.test.ts
git commit -m "feat(domain): make LedgerStore interface async-compatible for database operations"
```

---

## Task 5: Wire Supabase config into the API runtime

**Files:**

- Modify: `services/api/src/config.ts`
- Modify: `services/api/src/runtime.ts`
- Modify: `services/api/package.json`

- [ ] **Step 1: Add Supabase config fields**

In `services/api/src/config.ts`, add to the `ApiRuntimeConfig` type:

```typescript
supabase: {
  url?: string | undefined;
  serviceRoleKey?: string | undefined;
};
```

And in `readApiRuntimeConfig`, add:

```typescript
supabase: {
  url: normalize(env.SUPABASE_URL),
  serviceRoleKey: normalize(env.SUPABASE_SERVICE_ROLE_KEY),
},
```

(Where `normalize` is the existing helper that trims and converts empty to undefined.)

- [ ] **Step 2: Add supabase-client dependency to API**

In `services/api/package.json`, add to `dependencies`:

```json
"@jpx-accounting/supabase-client": "workspace:*"
```

- [ ] **Step 3: Wire SupabaseLedgerStore in normal mode**

In `services/api/src/runtime.ts`, replace the normal-mode branch:

```typescript
import { MemoryLedgerStore, SupabaseLedgerStore } from "@jpx-accounting/domain";
import { createServiceClient } from "@jpx-accounting/supabase-client";

// ... in createApiRuntimeDependencies, normal mode branch:

if (config.supabase.url && config.supabase.serviceRoleKey) {
  const serviceClient = createServiceClient({
    url: config.supabase.url,
    serviceRoleKey: config.supabase.serviceRoleKey,
  });

  return {
    runtimeMode: config.runtimeMode,
    store: new SupabaseLedgerStore(serviceClient, {
      organizationId: "org_default", // Overridden per-request by auth middleware
      workspaceId: "workspace_main",
    }),
    aiRuntime: createAiRuntime({
      runtimeMode: config.runtimeMode,
      endpoint: config.azureOpenAi.endpoint,
      apiKey: config.azureOpenAi.apiKey,
      model: config.azureOpenAi.model,
    }),
  };
}

// Fall through to UnavailableLedgerStore if Supabase not configured
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm install && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Run existing unit tests**

Run: `pnpm test:unit`
Expected: PASS — demo mode path unchanged

- [ ] **Step 6: Commit**

```bash
git add services/api/src/config.ts services/api/src/runtime.ts services/api/package.json pnpm-lock.yaml
git commit -m "feat(api): wire SupabaseLedgerStore in normal mode runtime"
```

---

## Task 6: Add Hono auth middleware for JWT verification

**Files:**

- Create: `services/api/src/middleware/auth.ts`
- Create: `tests/unit/auth-middleware.test.ts`
- Modify: `services/api/src/app.ts`

The auth middleware verifies the Supabase JWT from the `Authorization: Bearer <token>` header, extracts user claims, and makes them available to route handlers. In demo mode, auth is skipped entirely.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/auth-middleware.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { authMiddleware } from "../../services/api/src/middleware/auth";

test("authMiddleware skips verification in demo mode", async () => {
  const app = new Hono();
  app.use("/*", authMiddleware({ runtimeMode: "demo" }));
  app.get("/test", (c) => c.json({ ok: true }));

  const res = await app.request("/test");
  assert.equal(res.status, 200);
});

test("authMiddleware returns 401 when no Authorization header in normal mode", async () => {
  const app = new Hono();
  app.use(
    "/*",
    authMiddleware({
      runtimeMode: "normal",
      supabaseUrl: "https://example.supabase.co",
      supabaseServiceRoleKey: "fake-key",
    }),
  );
  app.get("/test", (c) => c.json({ ok: true }));

  const res = await app.request("/test");
  assert.equal(res.status, 401);
});

test("authMiddleware passes with valid-shaped token in normal mode", async () => {
  const app = new Hono();
  app.use(
    "/*",
    authMiddleware({
      runtimeMode: "normal",
      supabaseUrl: "https://example.supabase.co",
      supabaseServiceRoleKey: "fake-key",
      // In test, we skip actual JWT verification
      skipVerification: true,
    }),
  );
  app.get("/test", (c) => {
    const userId = c.get("userId");
    return c.json({ userId });
  });

  const res = await app.request("/test", {
    headers: { Authorization: "Bearer test-token" },
  });
  assert.equal(res.status, 200);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `tsx --test tests/unit/auth-middleware.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement auth middleware**

Create `services/api/src/middleware/auth.ts`:

```typescript
import type { Context, MiddlewareHandler } from "hono";
import type { RuntimeMode } from "@jpx-accounting/contracts";
import { createClient } from "@supabase/supabase-js";

type AuthMiddlewareOptions = {
  runtimeMode: RuntimeMode;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  skipVerification?: boolean; // For testing only
};

declare module "hono" {
  interface ContextVariableMap {
    userId: string;
    userEmail: string;
    organizationId: string;
    workspaceId: string;
  }
}

export function authMiddleware(options: AuthMiddlewareOptions): MiddlewareHandler {
  return async (context: Context, next) => {
    // Demo mode: skip auth entirely, use default identity
    if (options.runtimeMode === "demo") {
      context.set("userId", "user_demo");
      context.set("userEmail", "demo@jpx.se");
      context.set("organizationId", "org_jpx");
      context.set("workspaceId", "workspace_main");
      return next();
    }

    const authHeader = context.req.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return context.json({ error: "Missing or invalid Authorization header" }, 401);
    }

    const token = authHeader.slice(7);

    if (options.skipVerification) {
      // Test mode: accept any token shape
      context.set("userId", "user_test");
      context.set("userEmail", "test@jpx.se");
      context.set("organizationId", "org_test");
      context.set("workspaceId", "workspace_main");
      return next();
    }

    if (!options.supabaseUrl || !options.supabaseServiceRoleKey) {
      return context.json({ error: "Auth not configured" }, 503);
    }

    // Verify JWT via Supabase
    const supabase = createClient(options.supabaseUrl, options.supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      return context.json({ error: "Invalid or expired token" }, 401);
    }

    // Extract organization from user metadata (set during signup/invite)
    const organizationId = (user.user_metadata?.organization_id as string) ?? "org_default";
    const workspaceId = (user.user_metadata?.workspace_id as string) ?? "workspace_main";

    context.set("userId", user.id);
    context.set("userEmail", user.email ?? "");
    context.set("organizationId", organizationId);
    context.set("workspaceId", workspaceId);

    return next();
  };
}
```

- [ ] **Step 4: Run tests**

Run: `tsx --test tests/unit/auth-middleware.test.ts`
Expected: PASS

- [ ] **Step 5: Apply middleware to API routes**

In `services/api/src/app.ts`, add the auth middleware after CORS:

```typescript
import { authMiddleware } from "./middleware/auth";

// Inside createApp, after the CORS middleware:
app.use(
  "/api/*",
  authMiddleware({
    runtimeMode,
    supabaseUrl: options.supabaseUrl,
    supabaseServiceRoleKey: options.supabaseServiceRoleKey,
  }),
);
```

Update `CreateAppOptions` type to include the new fields:

```typescript
type CreateAppOptions = {
  store: LedgerStore;
  aiRuntime: AiRuntime;
  runtimeMode: RuntimeMode;
  allowTestReset: boolean;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
};
```

Update the `createApp` call in `services/api/src/index.ts` to pass Supabase config:

```typescript
const app = createApp({
  store,
  aiRuntime,
  runtimeMode,
  allowTestReset: config.allowTestReset,
  supabaseUrl: config.supabase.url,
  supabaseServiceRoleKey: config.supabase.serviceRoleKey,
});
```

- [ ] **Step 6: Run full test suite**

Run: `pnpm typecheck && pnpm test:unit`
Expected: PASS — demo mode skips auth, existing tests unaffected

- [ ] **Step 7: Commit**

```bash
git add services/api/src/middleware/auth.ts tests/unit/auth-middleware.test.ts services/api/src/app.ts services/api/src/index.ts
git commit -m "feat(api): add JWT auth middleware with demo-mode bypass"
```

---

## Task 7: Next.js Supabase client helpers

**Files:**

- Create: `apps/web/src/lib/supabase/server.ts`
- Create: `apps/web/src/lib/supabase/client.ts`

These are the standard `@supabase/ssr` helpers for Next.js App Router.

- [ ] **Step 1: Install @supabase/ssr in the web app**

In `apps/web/package.json`, add to `dependencies`:

```json
"@supabase/ssr": "^0.6.0",
"@supabase/supabase-js": "^2.49.0"
```

Run: `pnpm install`

- [ ] **Step 2: Create server-side Supabase client**

Create `apps/web/src/lib/supabase/server.ts`:

```typescript
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      },
    },
  });
}
```

- [ ] **Step 3: Create browser-side Supabase client**

Create `apps/web/src/lib/supabase/client.ts`:

```typescript
import { createBrowserClient } from "@supabase/ssr";

let client: ReturnType<typeof createBrowserClient> | undefined;

export function createSupabaseBrowserClient() {
  if (client) return client;

  client = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

  return client;
}
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/supabase/ apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): add Supabase SSR client helpers for server and browser"
```

---

## Task 8: Next.js auth middleware

**Files:**

- Create: `apps/web/middleware.ts`

This middleware runs on every request. It refreshes the Supabase session (extending cookie expiry) and redirects unauthenticated users away from protected routes. In demo mode, it does nothing.

- [ ] **Step 1: Create the middleware**

Create `apps/web/middleware.ts`:

```typescript
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/auth/login", "/auth/callback", "/share"];

export async function middleware(request: NextRequest) {
  // Demo mode: skip auth entirely
  if (process.env.NEXT_PUBLIC_ACCOUNTING_RUNTIME_MODE === "demo") {
    return NextResponse.next();
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    // Auth not configured — allow through (will fail at API layer)
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        supabaseResponse = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
      },
    },
  });

  // Refresh session — this call extends cookie expiry
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicPath = PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));

  if (!user && !isPublicPath) {
    const loginUrl = new URL("/auth/login", request.url);
    loginUrl.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Match all paths except static files and Next.js internals
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/middleware.ts
git commit -m "feat(web): add Next.js auth middleware with session refresh and redirect"
```

---

## Task 9: Forward auth token through API proxy

**Files:**

- Modify: `apps/web/app/api-proxy/[...path]/route.ts`

The API proxy already forwards the `authorization` header. We need to also extract the Supabase session token from cookies and inject it as a Bearer token when no explicit Authorization header is present.

- [ ] **Step 1: Update the proxy to inject auth from cookies**

In `apps/web/app/api-proxy/[...path]/route.ts`, add Supabase session extraction:

```typescript
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Inside the proxy function, before building forwarded headers:
async function getAuthToken(request: Request): Promise<string | undefined> {
  // If the request already has an auth header, use it
  const existing = request.headers.get("authorization");
  if (existing) return existing;

  // Otherwise, try to get the Supabase session token from cookies
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) {
      return `Bearer ${session.access_token}`;
    }
  } catch {
    // Auth not configured — skip
  }

  return undefined;
}
```

Then update the headers construction to use this token:

```typescript
const authToken = await getAuthToken(request);
if (authToken) {
  headers.set("authorization", authToken);
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api-proxy/[...path]/route.ts
git commit -m "feat(web): inject Supabase session token into API proxy requests"
```

---

## Task 10: Login and callback pages

**Files:**

- Create: `apps/web/app/auth/login/page.tsx`
- Create: `apps/web/app/auth/callback/route.ts`

Minimal login page with email/password form. The callback route handles OAuth redirects and magic links.

- [ ] **Step 1: Create the login page**

Create `apps/web/app/auth/login/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") ?? "/";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(undefined);

    const supabase = createSupabaseBrowserClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    router.push(redirect);
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-center text-2xl font-semibold">Logga in</h1>

        {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <input
          type="email"
          placeholder="E-post"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full rounded border px-3 py-2"
        />

        <input
          type="password"
          placeholder="Losenord"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full rounded border px-3 py-2"
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-teal-600 py-2 text-white hover:bg-teal-700 disabled:opacity-50"
        >
          {loading ? "Loggar in..." : "Logga in"}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Create the callback route**

Create `apps/web/app/auth/callback/route.ts`:

```typescript
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const redirect = searchParams.get("redirect") ?? "/";

  if (code) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(new URL(redirect, request.url));
}
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/auth/
git commit -m "feat(web): add login page and OAuth callback route"
```

---

## Task 11: Update .env.example with all auth-related variables

**Files:**

- Modify: `.env.example`

- [ ] **Step 1: Add new env vars**

Add to `.env.example`:

```bash
# Supabase Auth (required for normal mode)
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add Supabase auth env vars to .env.example"
```

---

## Task 12: End-to-end verification

**Files:** None (verification only)

- [ ] **Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS across all packages

- [ ] **Step 2: Run unit tests**

Run: `pnpm test:unit`
Expected: PASS — all existing tests + new auth/store tests

- [ ] **Step 3: Build the project**

Run: `pnpm build`
Expected: PASS — both web and API build successfully

- [ ] **Step 4: Run E2E tests (demo mode)**

Run: `pnpm test:e2e`
Expected: PASS — demo mode is unchanged, auth middleware is skipped

- [ ] **Step 5: Manual smoke test with local Supabase**

```bash
# Terminal 1: Start Supabase
npx supabase start

# Terminal 2: Start API in normal mode
ACCOUNTING_RUNTIME_MODE=normal \
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_ROLE_KEY=<key-from-supabase-start-output> \
pnpm dev:api

# Terminal 3: Test health endpoint
curl http://localhost:3001/health
# Expected: {"status":"ok","runtimeMode":"normal"}

# Test unauthenticated request
curl http://localhost:3001/api/workspace
# Expected: 401 {"error":"Missing or invalid Authorization header"}
```

- [ ] **Step 6: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address issues found during end-to-end verification"
```
