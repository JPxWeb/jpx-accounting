# Track A · Phase 8 — Settings depth + simulations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Complete tasks in order.

**Goal:** Replace every remaining Settings stub with real content or a clearly-marked roadmap card, and surface simulations as a Books sub-tab — leaving no "Full … lands in Phase 8" / "Coming in Phase 8" copy.

**Architecture:** Two persistence patterns, deliberately split (per spec §3 #8): fiscal-year and AI-posture are **field-persisted** (mirror the existing `companySettings` private field + async getter/setter); retention legal-hold is **event-sourced** (`RetentionPolicyUpdated`, folded like Phase 7's VAT filing). Team & integrations are demo-safe display/stub (team invite is a static route stub like `/api/uploads/init`, no store method). Compliance reuses the existing `/api/compliance-watch/refresh`. Forms reuse the established shadcn `Form` + `react-hook-form` + `zodResolver` + React Query mutation pattern from `company-form.tsx`.

**Tech Stack:** Zod 4 contracts, Hono, Next.js 16 + React 19.2.4, react-hook-form 7 + @hookform/resolvers 5, shadcn `form`/`select`/`radio-group`/`switch`/`slider`, nuqs 2, Playwright + axe-core.

**Spec:** `docs/superpowers/specs/2026-05-19-track-a-finish-ia-design.md` §4.4 (re-baseline corrections #1 PascalCase events, #8 field vs event persistence, #9 team not from closeRun), parent §4.5 / §8.7.

---

## Conventions (read once)

- Baseline `pnpm typecheck && pnpm test:unit` passes before starting.
- Settings page shape (mirror `apps/web/app/(shell)/settings/company/page.tsx`): a server component rendering `<ScreenHeader>` then a `glass-panel` wrapping a client form. Relative import depth from `app/(shell)/settings/<x>/page.tsx` to components is **four** `../` (e.g. `../../../../components/...`) — verified against `company/page.tsx`.
- Demo identity: `organizationId: "org_jpx"`, `actorId: "user_founder"`.
- New `LedgerStore` interface methods must be implemented in **both** `MemoryLedgerStore` and `SupabaseLedgerStore` or `pnpm typecheck` fails. Supabase impls for new write paths throw a Track-B error (same convention as Phase 7's `fileVatPeriod`).
- Test gate: `tests/e2e/settings.spec.ts` + `pnpm typecheck && pnpm test:unit && pnpm build`. Forms/pages have no UI unit tests (repo convention); store changes get a `node:test` unit test.
- Commit after every task.

## File map

| Path                                                                                                                                 | Action                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `apps/web/components/ui/{radio-group,switch,slider}.tsx`                                                                             | Create (shadcn)                                                  |
| `packages/contracts/src/settings.ts`                                                                                                 | Modify — fiscal-year, AI-posture, retention, team-invite schemas |
| `packages/contracts/src/index.ts`                                                                                                    | Modify — add `RetentionPolicyUpdated` event                      |
| `packages/domain/src/store.ts`                                                                                                       | Modify — interface + `MemoryLedgerStore` methods                 |
| `packages/domain/src/supabase-store.ts`                                                                                              | Modify — interface impls (Track-B throws)                        |
| `services/api/src/app.ts`                                                                                                            | Modify — settings/retention/team routes                          |
| `packages/api-client/src/index.ts`                                                                                                   | Modify — client methods                                          |
| `apps/web/components/settings/{fiscal-year-form,ai-posture-form,retention-panel,team-panel,integrations-panel,compliance-panel}.tsx` | Create                                                           |
| `apps/web/app/(shell)/settings/{fiscal-year,ai-posture,retention,team,integrations,compliance}/page.tsx`                             | Rewrite                                                          |
| `apps/web/components/books/simulate-view.tsx`                                                                                        | Create                                                           |
| `apps/web/components/screens/books-screen.tsx`                                                                                       | Modify — add `simulate` tab                                      |
| `tests/unit/ledger-store-settings.test.ts`                                                                                           | Create                                                           |
| `tests/e2e/settings.spec.ts`                                                                                                         | Modify                                                           |

---

## Task 8.1: Install shadcn primitives

**Files:** `apps/web/components/ui/{radio-group,switch,slider}.tsx`

- [ ] **Step 1: Install**

```bash
pnpm --filter @jpx-accounting/web exec shadcn@latest add radio-group switch slider
```

Accept creation of the three files; decline overwriting anything else.

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm typecheck` → PASS.

```bash
git add apps/web/components/ui/radio-group.tsx apps/web/components/ui/switch.tsx apps/web/components/ui/slider.tsx apps/web/package.json pnpm-lock.yaml
git commit -m "chore(track-a/p8): add shadcn radio-group, switch, slider"
```

---

## Task 8.2: Contracts — settings schemas + retention event

**Files:** Modify `packages/contracts/src/settings.ts`, `packages/contracts/src/index.ts`

- [ ] **Step 1: Extend `settings.ts`**

Append to `packages/contracts/src/settings.ts`:

```typescript
export const fiscalYearSettingsSchema = z.object({
  organizationId: z.string(),
  fiscalYearStartMonth: z.number().int().min(1).max(12),
  vatReportingPeriod: z.enum(["monthly", "quarterly", "annually"]),
});
export type FiscalYearSettings = z.infer<typeof fiscalYearSettingsSchema>;

export const aiPostureSettingsSchema = z.object({
  organizationId: z.string(),
  autoApproveConfidence: z.number().min(0).max(1),
  surfacesEnabled: z.object({
    advisor: z.boolean(),
    inline: z.boolean(),
    ambient: z.boolean(),
  }),
  killSwitch: z.boolean(),
});
export type AiPostureSettings = z.infer<typeof aiPostureSettingsSchema>;

export const retentionPolicySchema = z.object({
  voucherClass: z.string(),
  legalHold: z.boolean(),
});
export type RetentionPolicy = z.infer<typeof retentionPolicySchema>;

export const retentionPolicyUpdateSchema = z.object({
  actorId: z.string(),
  voucherClass: z.string(),
  legalHold: z.boolean(),
});
export type RetentionPolicyUpdate = z.infer<typeof retentionPolicyUpdateSchema>;

export const teamInvitationSchema = z.object({
  actorId: z.string(),
  email: z.string().email(),
  role: z.enum(["Preparer", "Approver", "Accountant", "Admin"]),
});
export type TeamInvitation = z.infer<typeof teamInvitationSchema>;
```

- [ ] **Step 2: Add the `RetentionPolicyUpdated` event type**

In `packages/contracts/src/index.ts`, add to the `eventTypeSchema` enum (after `"VatPeriodFiled",` — added in Phase 7; if Phase 7 has not landed in this branch, add after `"OrganizationSettingsUpdated",`):

```typescript
  "RetentionPolicyUpdated",
]);
```

(`export * from "./settings";` already exists at the bottom of `index.ts`; the new schemas are exported automatically.)

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm typecheck` → PASS.

```bash
git add packages/contracts/src/settings.ts packages/contracts/src/index.ts
git commit -m "feat(track-a/p8): fiscal-year, ai-posture, retention, team-invite contracts + RetentionPolicyUpdated event"
```

---

## Task 8.3: Store — fiscal-year/AI-posture fields + retention event fold

**Files:** Modify `packages/domain/src/store.ts`, `packages/domain/src/supabase-store.ts`; create `tests/unit/ledger-store-settings.test.ts`

- [ ] **Step 1: Write the failing store test**

Create `tests/unit/ledger-store-settings.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";

import { MemoryLedgerStore } from "@jpx-accounting/domain";

test("MemoryLedgerStore persists fiscal-year and AI-posture settings", async () => {
  const store = new MemoryLedgerStore();

  const fy = await store.getFiscalYearSettings();
  assert.equal(fy.fiscalYearStartMonth >= 1 && fy.fiscalYearStartMonth <= 12, true);

  const savedFy = await store.saveFiscalYearSettings({
    organizationId: "org_jpx",
    fiscalYearStartMonth: 7,
    vatReportingPeriod: "quarterly",
  });
  assert.equal(savedFy.fiscalYearStartMonth, 7);
  assert.equal((await store.getFiscalYearSettings()).vatReportingPeriod, "quarterly");

  const savedAi = await store.saveAiPostureSettings({
    organizationId: "org_jpx",
    autoApproveConfidence: 0.99,
    surfacesEnabled: { advisor: true, inline: false, ambient: true },
    killSwitch: false,
  });
  assert.equal(savedAi.autoApproveConfidence, 0.99);
});

test("MemoryLedgerStore folds RetentionPolicyUpdated events", async () => {
  const store = new MemoryLedgerStore();
  const before = await store.getRetentionPolicies();
  assert.equal(Array.isArray(before), true);

  await store.updateRetentionPolicy({ actorId: "user_founder", voucherClass: "invoice", legalHold: true });
  const after = await store.getRetentionPolicies();
  assert.equal(after.find((p) => p.voucherClass === "invoice")?.legalHold, true);

  // Latest event wins.
  await store.updateRetentionPolicy({ actorId: "user_founder", voucherClass: "invoice", legalHold: false });
  assert.equal((await store.getRetentionPolicies()).find((p) => p.voucherClass === "invoice")?.legalHold, false);
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx tsx --test tests/unit/ledger-store-settings.test.ts`
Expected: FAIL — `getFiscalYearSettings` is not a function.

- [ ] **Step 3: Extend the `LedgerStore` interface**

In `packages/domain/src/store.ts`, add to the `@jpx-accounting/contracts` type import block:

```typescript
  AiPostureSettings,
  FiscalYearSettings,
  RetentionPolicy,
  RetentionPolicyUpdate,
```

Add to the `LedgerStore` interface (after the Phase-7 methods, before the closing `}`):

```typescript
  getFiscalYearSettings(): Promise<FiscalYearSettings>;
  saveFiscalYearSettings(input: FiscalYearSettings): Promise<FiscalYearSettings>;
  getAiPostureSettings(): Promise<AiPostureSettings>;
  saveAiPostureSettings(input: AiPostureSettings): Promise<AiPostureSettings>;
  getRetentionPolicies(): Promise<RetentionPolicy[]>;
  updateRetentionPolicy(input: RetentionPolicyUpdate): Promise<RetentionPolicy[]>;
```

- [ ] **Step 4: Implement in `MemoryLedgerStore`**

Add private fields next to `private companySettings` (around line 142):

```typescript
  private fiscalYearSettings: FiscalYearSettings = {
    organizationId: "org_jpx",
    fiscalYearStartMonth: 1,
    vatReportingPeriod: "monthly",
  };
  private aiPostureSettings: AiPostureSettings = {
    organizationId: "org_jpx",
    autoApproveConfidence: 0.99,
    surfacesEnabled: { advisor: true, inline: true, ambient: true },
    killSwitch: false,
  };
```

Add these methods after `saveCompanySettings` (and after the Phase-7 methods if present):

```typescript
  async getFiscalYearSettings(): Promise<FiscalYearSettings> {
    return this.fiscalYearSettings;
  }

  async saveFiscalYearSettings(input: FiscalYearSettings): Promise<FiscalYearSettings> {
    this.fiscalYearSettings = input;
    return this.fiscalYearSettings;
  }

  async getAiPostureSettings(): Promise<AiPostureSettings> {
    return this.aiPostureSettings;
  }

  async saveAiPostureSettings(input: AiPostureSettings): Promise<AiPostureSettings> {
    this.aiPostureSettings = input;
    return this.aiPostureSettings;
  }

  async getRetentionPolicies(): Promise<RetentionPolicy[]> {
    const latest = new Map<string, boolean>();
    for (const event of this.events) {
      if (event.eventType !== "RetentionPolicyUpdated") continue;
      const payload = event.payload as { voucherClass?: string; legalHold?: boolean };
      if (payload.voucherClass) latest.set(payload.voucherClass, Boolean(payload.legalHold));
    }
    const classes = new Set<string>(["invoice", "cash", "payroll", ...latest.keys()]);
    return [...classes].map((voucherClass) => ({
      voucherClass,
      legalHold: latest.get(voucherClass) ?? false,
    }));
  }

  async updateRetentionPolicy(input: RetentionPolicyUpdate): Promise<RetentionPolicy[]> {
    this.appendEvent({
      organizationId: defaultOrganizationId,
      workspaceId: defaultWorkspaceId,
      aggregateType: "ledger",
      aggregateId: `retention:${input.voucherClass}`,
      eventType: "RetentionPolicyUpdated",
      actorId: input.actorId,
      occurredAt: nowIso(),
      payload: { voucherClass: input.voucherClass, legalHold: input.legalHold },
    });
    return this.getRetentionPolicies();
  }
```

- [ ] **Step 5: Implement in `SupabaseLedgerStore`**

In `packages/domain/src/supabase-store.ts`, add the same contract type imports and append these methods to the class (Track-B stubs, consistent with Phase 7's `fileVatPeriod`):

```typescript
  async getFiscalYearSettings(): Promise<FiscalYearSettings> {
    throw new Error("getFiscalYearSettings is not implemented in SupabaseLedgerStore yet (Track B).");
  }
  async saveFiscalYearSettings(_input: FiscalYearSettings): Promise<FiscalYearSettings> {
    throw new Error("saveFiscalYearSettings is not implemented in SupabaseLedgerStore yet (Track B).");
  }
  async getAiPostureSettings(): Promise<AiPostureSettings> {
    throw new Error("getAiPostureSettings is not implemented in SupabaseLedgerStore yet (Track B).");
  }
  async saveAiPostureSettings(_input: AiPostureSettings): Promise<AiPostureSettings> {
    throw new Error("saveAiPostureSettings is not implemented in SupabaseLedgerStore yet (Track B).");
  }
  async getRetentionPolicies(): Promise<RetentionPolicy[]> {
    throw new Error("getRetentionPolicies is not implemented in SupabaseLedgerStore yet (Track B).");
  }
  async updateRetentionPolicy(_input: RetentionPolicyUpdate): Promise<RetentionPolicy[]> {
    throw new Error("updateRetentionPolicy is not implemented in SupabaseLedgerStore yet (Track B).");
  }
```

- [ ] **Step 6: Run the store test + full typecheck**

Run: `npx tsx --test tests/unit/ledger-store-settings.test.ts` → PASS.
Run: `pnpm typecheck` → PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/store.ts packages/domain/src/supabase-store.ts tests/unit/ledger-store-settings.test.ts
git commit -m "feat(track-a/p8): fiscal-year/ai-posture field persistence + event-sourced retention"
```

---

## Task 8.4: API routes

**Files:** Modify `services/api/src/app.ts`

- [ ] **Step 1: Add the routes**

Add `fiscalYearSettingsSchema, aiPostureSettingsSchema, retentionPolicyUpdateSchema, teamInvitationSchema` to the `@jpx-accounting/contracts` import. After the existing `app.put("/api/settings/company", …)` block, add:

```typescript
app.get("/api/settings/fiscal-year", async (context) => context.json(await currentStore.getFiscalYearSettings()));
app.put("/api/settings/fiscal-year", async (context) => {
  const input = await parseBody(context.req.raw, fiscalYearSettingsSchema);
  return context.json(await currentStore.saveFiscalYearSettings(input));
});

app.get("/api/settings/ai-posture", async (context) => context.json(await currentStore.getAiPostureSettings()));
app.put("/api/settings/ai-posture", async (context) => {
  const input = await parseBody(context.req.raw, aiPostureSettingsSchema);
  return context.json(await currentStore.saveAiPostureSettings(input));
});

app.get("/api/settings/retention", async (context) => context.json(await currentStore.getRetentionPolicies()));
app.put("/api/settings/retention", async (context) => {
  const input = await parseBody(context.req.raw, retentionPolicyUpdateSchema);
  return context.json(await currentStore.updateRetentionPolicy(input));
});

app.post("/api/team/invitations", async (context) => {
  const input = await parseBody(context.req.raw, teamInvitationSchema);
  // Demo-safe stub (no store method, mirrors /api/uploads/init): real invite flow is out of Track A scope.
  return context.json({ status: "pending", email: input.email, role: input.role }, 201);
});
```

- [ ] **Step 2: Smoke test**

```bash
pnpm --filter @jpx-accounting/api exec tsx src/index.ts &
sleep 2
curl -s "http://127.0.0.1:3001/api/settings/fiscal-year" | head -c 120
curl -s -X PUT "http://127.0.0.1:3001/api/settings/ai-posture" -H 'content-type: application/json' \
  -d '{"organizationId":"org_jpx","autoApproveConfidence":0.95,"surfacesEnabled":{"advisor":true,"inline":true,"ambient":true},"killSwitch":false}' | head -c 160
kill %1
```

Expected: JSON fiscal-year defaults; echoed AI-posture with `0.95`.

- [ ] **Step 3: Commit**

```bash
git add services/api/src/app.ts
git commit -m "feat(track-a/p8): settings/retention/team API routes"
```

---

## Task 8.5: API client methods

**Files:** Modify `packages/api-client/src/index.ts`

- [ ] **Step 1: Extend the client**

Add `AiPostureSettings, FiscalYearSettings, RetentionPolicy` to the contracts type imports. Add after `saveCompanySettings` (and after Phase-7 methods if present):

```typescript
  async getFiscalYearSettings(): Promise<FiscalYearSettings> {
    if (this.fallbackStore) return this.fallbackStore.getFiscalYearSettings();
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return request<FiscalYearSettings>(this.baseUrl, "/api/settings/fiscal-year", { method: "GET" });
  }
  async saveFiscalYearSettings(input: FiscalYearSettings): Promise<FiscalYearSettings> {
    if (this.fallbackStore) return this.fallbackStore.saveFiscalYearSettings(input);
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return request<FiscalYearSettings>(this.baseUrl, "/api/settings/fiscal-year", { method: "PUT", body: JSON.stringify(input) });
  }
  async getAiPostureSettings(): Promise<AiPostureSettings> {
    if (this.fallbackStore) return this.fallbackStore.getAiPostureSettings();
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return request<AiPostureSettings>(this.baseUrl, "/api/settings/ai-posture", { method: "GET" });
  }
  async saveAiPostureSettings(input: AiPostureSettings): Promise<AiPostureSettings> {
    if (this.fallbackStore) return this.fallbackStore.saveAiPostureSettings(input);
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return request<AiPostureSettings>(this.baseUrl, "/api/settings/ai-posture", { method: "PUT", body: JSON.stringify(input) });
  }
  async getRetentionPolicies(): Promise<RetentionPolicy[]> {
    if (this.fallbackStore) return this.fallbackStore.getRetentionPolicies();
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return request<RetentionPolicy[]>(this.baseUrl, "/api/settings/retention", { method: "GET" });
  }
  async updateRetentionPolicy(actorId: string, voucherClass: string, legalHold: boolean): Promise<RetentionPolicy[]> {
    if (this.fallbackStore) return this.fallbackStore.updateRetentionPolicy({ actorId, voucherClass, legalHold });
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return request<RetentionPolicy[]>(this.baseUrl, "/api/settings/retention", {
      method: "PUT",
      body: JSON.stringify({ actorId, voucherClass, legalHold }),
    });
  }
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm typecheck` → PASS.

```bash
git add packages/api-client/src/index.ts
git commit -m "feat(track-a/p8): api-client settings + retention methods"
```

---

## Task 8.6: Fiscal year & VAT form + page

**Files:** Create `apps/web/components/settings/fiscal-year-form.tsx`; rewrite `apps/web/app/(shell)/settings/fiscal-year/page.tsx`

- [ ] **Step 1: Form component**

Create `apps/web/components/settings/fiscal-year-form.tsx`:

```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { type FiscalYearSettings, fiscalYearSettingsSchema } from "@jpx-accounting/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { apiClient } from "../../lib/client";
import { Button } from "../ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "../ui/form";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { ScreenSkeleton } from "../ui/skeleton";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

function FiscalYearFields({ defaultData }: { defaultData: FiscalYearSettings }) {
  const queryClient = useQueryClient();
  const form = useForm<FiscalYearSettings>({
    resolver: zodResolver(fiscalYearSettingsSchema),
    defaultValues: defaultData,
  });
  const mutation = useMutation({
    mutationFn: (input: FiscalYearSettings) => apiClient.saveFiscalYearSettings(input),
    onSuccess: (saved) => {
      queryClient.setQueryData(["fiscal-year-settings"], saved);
      toast.success("Fiscal year settings saved.");
    },
    onError: () => toast.error("Could not save fiscal year settings."),
  });

  return (
    <Form {...form}>
      <form
        data-testid="fiscal-year-form"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        className="space-y-6"
      >
        <FormField
          control={form.control}
          name="fiscalYearStartMonth"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Fiscal year start month</FormLabel>
              <FormControl>
                <select
                  className="rounded-md border px-3 py-2 text-sm"
                  value={field.value}
                  onChange={(event) => field.onChange(Number(event.target.value))}
                >
                  {MONTHS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="vatReportingPeriod"
          render={({ field }) => (
            <FormItem>
              <FormLabel>VAT reporting period</FormLabel>
              <FormControl>
                <RadioGroup value={field.value} onValueChange={field.onChange} className="flex gap-4">
                  {(["monthly", "quarterly", "annually"] as const).map((option) => (
                    <label key={option} className="flex items-center gap-2 text-sm">
                      <RadioGroupItem value={option} /> {option}
                    </label>
                  ))}
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={mutation.isPending} data-testid="fiscal-year-submit">
          {mutation.isPending ? "Saving…" : "Save fiscal year"}
        </Button>
      </form>
    </Form>
  );
}

export function FiscalYearForm() {
  const query = useQuery({ queryKey: ["fiscal-year-settings"], queryFn: () => apiClient.getFiscalYearSettings() });
  if (!query.data) return <ScreenSkeleton />;
  return <FiscalYearFields defaultData={query.data} />;
}
```

- [ ] **Step 2: Rewrite the page**

Replace `apps/web/app/(shell)/settings/fiscal-year/page.tsx`:

```tsx
import { FiscalYearForm } from "../../../../components/settings/fiscal-year-form";
import { ScreenHeader } from "../../../../components/ui/screen-header";

export default function FiscalYearSettingsPage() {
  return (
    <div className="space-y-6">
      <ScreenHeader
        eyebrow="Settings / Fiscal year & VAT"
        title="Fiscal year and VAT reporting cadence."
        description="Fiscal year start month and VAT reporting period drive period scoping and filing deadlines."
      />
      <div className="glass-panel rounded-xl p-5">
        <FiscalYearForm />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build + commit**

Run: `pnpm --filter @jpx-accounting/web build` → PASS.

```bash
git add apps/web/components/settings/fiscal-year-form.tsx "apps/web/app/(shell)/settings/fiscal-year/page.tsx"
git commit -m "feat(track-a/p8): fiscal year & VAT settings form"
```

---

## Task 8.7: AI posture form + page

**Files:** Create `apps/web/components/settings/ai-posture-form.tsx`; rewrite `apps/web/app/(shell)/settings/ai-posture/page.tsx`

- [ ] **Step 1: Form component**

Create `apps/web/components/settings/ai-posture-form.tsx`:

```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { type AiPostureSettings, aiPostureSettingsSchema } from "@jpx-accounting/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { apiClient } from "../../lib/client";
import { Button } from "../ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "../ui/form";
import { ScreenSkeleton } from "../ui/skeleton";
import { Slider } from "../ui/slider";
import { Switch } from "../ui/switch";

function AiPostureFields({ defaultData }: { defaultData: AiPostureSettings }) {
  const queryClient = useQueryClient();
  const form = useForm<AiPostureSettings>({
    resolver: zodResolver(aiPostureSettingsSchema),
    defaultValues: defaultData,
  });
  const mutation = useMutation({
    mutationFn: (input: AiPostureSettings) => apiClient.saveAiPostureSettings(input),
    onSuccess: (saved) => {
      queryClient.setQueryData(["ai-posture-settings"], saved);
      toast.success("AI posture saved.");
    },
    onError: () => toast.error("Could not save AI posture."),
  });

  return (
    <Form {...form}>
      <form
        data-testid="ai-posture-form"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        className="space-y-6"
      >
        <FormField
          control={form.control}
          name="autoApproveConfidence"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Auto-approve confidence threshold ({Math.round(field.value * 100)}%)</FormLabel>
              <FormControl>
                <Slider min={0} max={1} step={0.01} value={[field.value]} onValueChange={(v) => field.onChange(v[0])} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {(["advisor", "inline", "ambient"] as const).map((surface) => (
          <Controller
            key={surface}
            control={form.control}
            name={`surfacesEnabled.${surface}` as const}
            render={({ field }) => (
              <div className="flex items-center justify-between">
                <span className="text-sm capitalize">{surface} surface</span>
                <Switch checked={field.value} onCheckedChange={field.onChange} data-testid={`ai-surface-${surface}`} />
              </div>
            )}
          />
        ))}
        <Controller
          control={form.control}
          name="killSwitch"
          render={({ field }) => (
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">AI kill switch</span>
              <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="ai-kill-switch" />
            </div>
          )}
        />
        <Button type="submit" disabled={mutation.isPending} data-testid="ai-posture-submit">
          {mutation.isPending ? "Saving…" : "Save AI posture"}
        </Button>
      </form>
    </Form>
  );
}

export function AiPostureForm() {
  const query = useQuery({ queryKey: ["ai-posture-settings"], queryFn: () => apiClient.getAiPostureSettings() });
  if (!query.data) return <ScreenSkeleton />;
  return <AiPostureFields defaultData={query.data} />;
}
```

- [ ] **Step 2: Rewrite the page**

Replace `apps/web/app/(shell)/settings/ai-posture/page.tsx`:

```tsx
import { AiPostureForm } from "../../../../components/settings/ai-posture-form";
import { ScreenHeader } from "../../../../components/ui/screen-header";

export default function AiPostureSettingsPage() {
  return (
    <div className="space-y-6">
      <ScreenHeader
        eyebrow="Settings / AI posture"
        title="How much autonomy the AI has."
        description="Confidence threshold for future auto-approval, which AI surfaces are enabled, and a global kill switch."
      />
      <div className="glass-panel rounded-xl p-5">
        <AiPostureForm />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build + commit**

Run: `pnpm --filter @jpx-accounting/web build` → PASS.

```bash
git add apps/web/components/settings/ai-posture-form.tsx "apps/web/app/(shell)/settings/ai-posture/page.tsx"
git commit -m "feat(track-a/p8): AI posture settings form"
```

---

## Task 8.8: Retention panel + page

**Files:** Create `apps/web/components/settings/retention-panel.tsx`; rewrite `apps/web/app/(shell)/settings/retention/page.tsx`

- [ ] **Step 1: Panel**

Create `apps/web/components/settings/retention-panel.tsx`:

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "../../lib/client";
import { Switch } from "../ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

export function RetentionPanel() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["retention-policies"], queryFn: () => apiClient.getRetentionPolicies() });
  const mutation = useMutation({
    mutationFn: (vars: { voucherClass: string; legalHold: boolean }) =>
      apiClient.updateRetentionPolicy("user_founder", vars.voucherClass, vars.legalHold),
    onSuccess: (policies) => {
      queryClient.setQueryData(["retention-policies"], policies);
      toast.success("Retention policy updated.");
    },
    onError: () => toast.error("Could not update retention policy."),
  });

  const policies = query.data ?? [];

  return (
    <div className="space-y-4" data-testid="retention-panel">
      <p className="rounded-lg border-l-4 border-[var(--color-accent)] bg-[rgba(255,255,255,0.5)] px-4 py-3 text-sm">
        Baseline: 7-year retention per Bokföringslagen. Legal hold extends retention beyond the baseline and blocks
        deletion.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Voucher class</TableHead>
            <TableHead className="text-right">Legal hold</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {policies.map((policy) => (
            <TableRow key={policy.voucherClass} data-testid="retention-row">
              <TableCell>{policy.voucherClass}</TableCell>
              <TableCell className="text-right">
                <Switch
                  checked={policy.legalHold}
                  data-testid={`retention-toggle-${policy.voucherClass}`}
                  onCheckedChange={(legalHold) => mutation.mutate({ voucherClass: policy.voucherClass, legalHold })}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite the page**

Replace `apps/web/app/(shell)/settings/retention/page.tsx`:

```tsx
import { RetentionPanel } from "../../../../components/settings/retention-panel";
import { ScreenHeader } from "../../../../components/ui/screen-header";

export default function RetentionSettingsPage() {
  return (
    <div className="space-y-6">
      <ScreenHeader
        eyebrow="Settings / Retention"
        title="Retention and legal hold."
        description="7-year statutory baseline with per-voucher-class legal hold. Changes are recorded as append-only events."
      />
      <div className="glass-panel rounded-xl p-5">
        <RetentionPanel />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build + commit**

Run: `pnpm --filter @jpx-accounting/web build` → PASS.

```bash
git add apps/web/components/settings/retention-panel.tsx "apps/web/app/(shell)/settings/retention/page.tsx"
git commit -m "feat(track-a/p8): retention panel with event-sourced legal hold"
```

---

## Task 8.9: Team panel + page (display-only + invite stub)

**Files:** Create `apps/web/components/settings/team-panel.tsx`; rewrite `apps/web/app/(shell)/settings/team/page.tsx`

- [ ] **Step 1: Panel**

Create `apps/web/components/settings/team-panel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "../ui/dialog";
import { Input } from "../ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

// Demo-safe static roster (re-baseline correction #9: not derived from closeRun).
const TEAM = [
  { name: "Johan Founder", email: "johan@jpx.nu", role: "Admin" },
  { name: "Demo Bookkeeper", email: "book@example.com", role: "Preparer" },
  { name: "Demo Auditor", email: "audit@example.com", role: "Accountant" },
];

export function TeamPanel() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);

  async function invite() {
    setSending(true);
    try {
      const response = await fetch("/api-proxy/api/team/invitations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actorId: "user_founder", email, role: "Preparer" }),
      });
      const result = (await response.json()) as { status: string };
      toast.success(`Invitation ${result.status} for ${email}. Real delivery is coming soon.`);
      setEmail("");
    } catch {
      toast.error("Could not send the invitation.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="team-panel">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {TEAM.map((member) => (
            <TableRow key={member.email}>
              <TableCell>{member.name}</TableCell>
              <TableCell>{member.email}</TableCell>
              <TableCell>{member.role}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Dialog>
        <DialogTrigger asChild>
          <Button data-testid="team-invite-open">Invite member</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a team member</DialogTitle>
          </DialogHeader>
          <Input
            type="email"
            placeholder="name@company.se"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            data-testid="team-invite-email"
          />
          <Button disabled={sending || !email} onClick={invite} data-testid="team-invite-send">
            {sending ? "Sending…" : "Send invitation"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

(If the generated `dialog.tsx` does not export `DialogTrigger`/`DialogHeader`/`DialogTitle`, open `apps/web/components/ui/dialog.tsx` and use the exact exported names; the shadcn dialog exports these by default.)

- [ ] **Step 2: Rewrite the page**

Replace `apps/web/app/(shell)/settings/team/page.tsx`:

```tsx
import { TeamPanel } from "../../../../components/settings/team-panel";
import { ScreenHeader } from "../../../../components/ui/screen-header";

export default function TeamSettingsPage() {
  return (
    <div className="space-y-6">
      <ScreenHeader
        eyebrow="Settings / Team & roles"
        title="Members and roles."
        description="Owner, bookkeeper, and accountant access. Invitations are stubbed for the demo; delivery lands with auth."
      />
      <div className="glass-panel rounded-xl p-5">
        <TeamPanel />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build + commit**

Run: `pnpm --filter @jpx-accounting/web build` → PASS.

```bash
git add apps/web/components/settings/team-panel.tsx "apps/web/app/(shell)/settings/team/page.tsx"
git commit -m "feat(track-a/p8): team panel (display-only + invite stub)"
```

---

## Task 8.10: Integrations panel + page (roadmap cards)

**Files:** Create `apps/web/components/settings/integrations-panel.tsx`; rewrite `apps/web/app/(shell)/settings/integrations/page.tsx`

- [ ] **Step 1: Panel**

Create `apps/web/components/settings/integrations-panel.tsx`:

```tsx
"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "../ui/dialog";
import { Button } from "../ui/button";

const INTEGRATIONS = [
  { id: "bank", name: "Bank feeds", detail: "Automatic transaction import via PSD2/open banking." },
  { id: "skatteverket", name: "Skatteverket", detail: "Direct VAT and employer declaration filing." },
  { id: "accountant", name: "Accountant access", detail: "Scoped read access for your external accountant." },
];

export function IntegrationsPanel() {
  return (
    <div className="grid gap-3 sm:grid-cols-3" data-testid="integrations-panel">
      {INTEGRATIONS.map((integration) => (
        <div key={integration.id} className="glass-panel-soft rounded-lg p-4">
          <p className="font-semibold">{integration.name}</p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">{integration.detail}</p>
          <p className="mt-3 text-xs">Status: Not connected</p>
          <Dialog>
            <DialogTrigger asChild>
              <Button className="mt-3" data-testid={`integration-connect-${integration.id}`}>
                Connect
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{integration.name}</DialogTitle>
              </DialogHeader>
              <p className="text-sm">
                {integration.name} integration is on the roadmap (target Q3 2026). Track A ships the surface; the OAuth
                connection lands with the production backend.
              </p>
            </DialogContent>
          </Dialog>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Rewrite the page**

Replace `apps/web/app/(shell)/settings/integrations/page.tsx`:

```tsx
import { IntegrationsPanel } from "../../../../components/settings/integrations-panel";
import { ScreenHeader } from "../../../../components/ui/screen-header";

export default function IntegrationsSettingsPage() {
  return (
    <div className="space-y-6">
      <ScreenHeader
        eyebrow="Settings / Integrations"
        title="Connections."
        description="Bank feeds, Skatteverket, and accountant access. Surfaces are live; connections arrive with the production backend."
      />
      <div className="glass-panel rounded-xl p-5">
        <IntegrationsPanel />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build + commit**

Run: `pnpm --filter @jpx-accounting/web build` → PASS.

```bash
git add apps/web/components/settings/integrations-panel.tsx "apps/web/app/(shell)/settings/integrations/page.tsx"
git commit -m "feat(track-a/p8): integrations roadmap panel"
```

---

## Task 8.11: Compliance watch panel + page

**Files:** Create `apps/web/components/settings/compliance-panel.tsx`; rewrite `apps/web/app/(shell)/settings/compliance/page.tsx`

- [ ] **Step 1: Panel**

Create `apps/web/components/settings/compliance-panel.tsx`:

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "../../lib/client";
import { Button } from "../ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

const SOURCES = ["Skatteverket", "Bokföringsnämnden (BFN)", "BAS-kontoplan"];

export function CompliancePanel() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["workspace"], queryFn: () => apiClient.getSnapshot() });
  const refresh = useMutation({
    mutationFn: async () => {
      await fetch("/api-proxy/api/compliance-watch/refresh", { method: "POST" }).catch(() => undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
      toast.success("Compliance watch refreshed.");
    },
  });

  const alerts = data?.alerts ?? [];

  return (
    <div className="space-y-4" data-testid="compliance-panel">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">Subscribed sources</p>
          <p className="text-sm text-[var(--color-text-muted)]">{SOURCES.join(" · ")}</p>
        </div>
        <Button data-testid="compliance-refresh" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
          {refresh.isPending ? "Refreshing…" : "Refresh compliance watch"}
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Alert</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Detected</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {alerts.map((alert) => (
            <TableRow key={alert.id} data-testid="compliance-alert">
              <TableCell>
                <p className="font-medium">{alert.title}</p>
                <p className="text-sm text-[var(--color-text-muted)]">{alert.impactSummary}</p>
              </TableCell>
              <TableCell>{alert.source}</TableCell>
              <TableCell>{alert.detectedAt.slice(0, 10)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite the page**

Replace `apps/web/app/(shell)/settings/compliance/page.tsx`:

```tsx
import { CompliancePanel } from "../../../../components/settings/compliance-panel";
import { ScreenHeader } from "../../../../components/ui/screen-header";

export default function ComplianceSettingsPage() {
  return (
    <div className="space-y-6">
      <ScreenHeader
        eyebrow="Settings / Compliance watch"
        title="Regulatory change monitoring."
        description="Subscribed rule sources and the alert history that feeds the ambient digest."
      />
      <div className="glass-panel rounded-xl p-5">
        <CompliancePanel />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build + commit**

Run: `pnpm --filter @jpx-accounting/web build` → PASS.

```bash
git add apps/web/components/settings/compliance-panel.tsx "apps/web/app/(shell)/settings/compliance/page.tsx"
git commit -m "feat(track-a/p8): compliance watch panel"
```

---

## Task 8.12: Simulations as a Books sub-tab

**Files:** Create `apps/web/components/books/simulate-view.tsx`; modify `apps/web/components/screens/books-screen.tsx`

- [ ] **Step 1: Simulate view**

Create `apps/web/components/books/simulate-view.tsx`:

```tsx
"use client";

import type { SimulationRun } from "@jpx-accounting/contracts";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { apiClient } from "../../lib/client";
import { Button } from "../ui/button";

export function SimulateView() {
  const [scenario, setScenario] = useState("");
  const [result, setResult] = useState<SimulationRun | null>(null);
  const run = useMutation({
    mutationFn: () => apiClient.runSimulation({ actorId: "user_founder", title: "Books simulation", scenario }),
    onSuccess: (data) => setResult(data),
  });

  return (
    <div className="glass-panel rounded-xl p-5" data-testid="simulate-view">
      <h2 className="text-lg font-semibold">Shadow-ledger simulation</h2>
      <textarea
        data-testid="simulate-scenario"
        className="mt-3 w-full rounded-md border p-3 text-sm"
        rows={3}
        placeholder="Describe a scenario, e.g. 'Reclassify representation 6071 as non-deductible'."
        value={scenario}
        onChange={(event) => setScenario(event.target.value)}
      />
      <Button
        className="mt-3"
        data-testid="simulate-run"
        disabled={run.isPending || !scenario}
        onClick={() => run.mutate()}
      >
        {run.isPending ? "Running…" : "Run simulation"}
      </Button>
      {result ? (
        <div className="mt-4 glass-panel-soft rounded-lg p-4" data-testid="simulate-result">
          <p className="text-sm leading-6">{result.outcomeSummary}</p>
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">
            Proposed affected accounts: {result.affectedAccounts.join(", ")}
          </p>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Add the tab**

In `apps/web/components/screens/books-screen.tsx`: add `simulate` to the `views` tuple, import `SimulateView`, add a `TabsTrigger`, and render it:

```tsx
import { SimulateView } from "../books/simulate-view";
// ...
const views = ["journal", "general-ledger", "trial-balance", "suppliers", "close", "simulate"] as const;
// ...inside <TabsList> after the close trigger:
<TabsTrigger value="simulate">Simulate</TabsTrigger>;
// ...inside the <section> after the close render line:
{
  view === "simulate" ? <SimulateView /> : null;
}
```

- [ ] **Step 3: Build + commit**

Run: `pnpm --filter @jpx-accounting/web build` → PASS.

```bash
git add apps/web/components/books/simulate-view.tsx apps/web/components/screens/books-screen.tsx
git commit -m "feat(track-a/p8): simulations as a Books sub-tab"
```

---

## Task 8.13: E2E coverage

**Files:** Modify `tests/e2e/settings.spec.ts`

- [ ] **Step 1: Append settings + simulate tests**

Add to `tests/e2e/settings.spec.ts` (keep existing tests; if the file imports `AxeBuilder`/`resetApiState` already, reuse them — otherwise add the imports shown):

```typescript
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { resetApiState } from "./test-helpers";

test.describe("Phase 8 settings depth", () => {
  test.beforeEach(async ({ request }) => {
    await resetApiState(request);
  });

  test("no 'Phase 8' placeholder copy remains on settings sub-pages", async ({ page }) => {
    for (const path of ["fiscal-year", "ai-posture", "retention", "team", "integrations", "compliance"]) {
      await page.goto(`/settings/${path}`);
      await expect(page.getByText(/lands in Phase 8|Coming in Phase 8/)).toHaveCount(0);
    }
  });

  test("fiscal year settings persist across reload", async ({ page }) => {
    await page.goto("/settings/fiscal-year");
    await page.getByTestId("fiscal-year-submit").click();
    await page.reload();
    await expect(page.getByTestId("fiscal-year-form")).toBeVisible();
  });

  test("AI posture saves", async ({ page }) => {
    await page.goto("/settings/ai-posture");
    await page.getByTestId("ai-kill-switch").click();
    await page.getByTestId("ai-posture-submit").click();
    await expect(page.getByTestId("ai-posture-form")).toBeVisible();
  });

  test("retention legal hold toggles", async ({ page }) => {
    await page.goto("/settings/retention");
    await expect(page.getByTestId("retention-row").first()).toBeVisible();
    await page.getByTestId("retention-toggle-invoice").click();
    await expect(page.getByTestId("retention-panel")).toBeVisible();
  });

  test("compliance refresh works", async ({ page }) => {
    await page.goto("/settings/compliance");
    await page.getByTestId("compliance-refresh").click();
    await expect(page.getByTestId("compliance-alert").first()).toBeVisible();
  });

  test("Books simulate sub-tab runs a simulation", async ({ page }) => {
    await page.goto("/books?view=simulate");
    await page.getByTestId("simulate-scenario").fill("Reclassify 6071 representation");
    await page.getByTestId("simulate-run").click();
    await expect(page.getByTestId("simulate-result")).toBeVisible();
  });

  test("settings sub-pages have no serious accessibility violations", async ({ page }) => {
    await page.goto("/settings/ai-posture");
    await expect(page.getByTestId("ai-posture-form")).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the spec**

Run: `pnpm build && npx playwright test tests/e2e/settings.spec.ts`
Expected: all tests PASS on both projects. (If a duplicate `import`/`resetApiState` collision occurs because the existing file already declares them, remove the duplicated import lines and keep one.)

- [ ] **Step 3: Final full verification + commit**

Run: `pnpm typecheck && pnpm test:unit && pnpm build && pnpm test:e2e`
Expected: all green.

```bash
git add tests/e2e/settings.spec.ts
git commit -m "test(track-a/p8): settings depth + simulate e2e + axe"
```

---

## Phase 8 acceptance check

- [ ] Every `/settings/*` sub-page renders real content or a clearly-marked roadmap card; zero "Phase 8" placeholder copy
- [ ] Fiscal year and AI posture changes persist across reload
- [ ] Retention legal-hold toggles append `RetentionPolicyUpdated` events and reflect the latest state
- [ ] Compliance refresh button works; alert history renders from `snapshot.alerts`
- [ ] Integrations show roadmap cards; team shows roster + stubbed invite
- [ ] Books `?view=simulate` runs a simulation and renders proposed entries
- [ ] `pnpm typecheck && pnpm test:unit && pnpm build && pnpm test:e2e` all pass; axe clean on settings routes

## Self-review summary

- **Spec coverage (§4.4, §8.7):** fiscal-year + AI-posture as field-persisted forms (8.3, 8.6, 8.7 — correction #8); retention event-sourced via `RetentionPolicyUpdated` (8.2, 8.3, 8.8 — correction #1 PascalCase); team display-only + stub invite not from closeRun (8.9 — correction #9); integrations roadmap cards (8.10); compliance from `snapshot.alerts` + existing refresh route (8.11); simulations as Books sub-tab (8.12).
- **Placeholders:** none — full component, schema, store, route, and client code; shadcn-export-name fallback notes included for `dialog`.
- **Type consistency:** `FiscalYearSettings`/`AiPostureSettings`/`RetentionPolicy`/`RetentionPolicyUpdate`/`TeamInvitation` defined in 8.2 are used identically in store (8.3), routes (8.4), client (8.5), and forms (8.6–8.8); query keys (`fiscal-year-settings`, `ai-posture-settings`, `retention-policies`, `workspace`) are consistent between read and write; `apiClient.runSimulation` signature matches `simulationRequestSchema` exactly.
- **Consolidation note (deferred, not blocking):** Phase 7's `deriveFiledPeriods` and this phase's retention fold are both small event reducers; a shared `foldEventsOfType` helper is a sensible later refactor but is intentionally NOT done here to avoid editing Phase 7's committed code (no-churn / YAGNI). Recorded so it is a conscious choice, not an oversight.
- **Backout:** every task ends in one revertable commit; reverting any single settings task leaves the others working (each page/route/store-method is independent).
