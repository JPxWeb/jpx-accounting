# Track A · Phase 7 — Reports (P&L, Balance Sheet, VAT return, charts, exports) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Complete tasks in order.

**Goal:** Turn `/reports` into a real statutory/management surface — Resultaträkning, Balansräkning, period-aware VAT return with event-sourced filing, charts, and SIE/CSV/PDF exports — sharing one URL period scope with Books.

**Architecture:** Pure period-scoped projection functions in `packages/reporting` (unit-tested), composed by the store (the existing `getReports()` composition pattern), exposed via new period-aware Hono endpoints, fetched by a single `useReport` React Query wrapper. VAT filing is a new append-only `VatPeriodFiled` ledger event folded into the VAT return read. Charts use Recharts v3 via shadcn's now-v3-native `chart` component. PDF export is a server-side Hono route.

**Tech Stack:** TypeScript, Zod 4 (`@jpx-accounting/contracts`), Hono, `node:test`/`tsx` unit tests, Next.js 16 + React 19.2.4 + TanStack Query 5 + nuqs 2, Recharts 3 (shadcn `chart`), `@react-pdf/renderer` 4 (server-side), Playwright + axe-core.

**Spec:** `docs/superpowers/specs/2026-05-19-track-a-finish-ia-design.md` §4.1, plus parent `docs/superpowers/specs/2026-05-13-ia-restructure-design.md` §4.4.

---

## Conventions (read once)

- **Verify baseline first:** `pnpm typecheck && pnpm test:unit` must pass before starting. If not, stop and report.
- **Unit tests** use `node:test` + `node:assert/strict`, run with `pnpm test:unit` (`tsx --test tests/unit/*.test.ts`). Single file: `npx tsx --test tests/unit/<file>.test.ts`.
- **E2E** uses Playwright; run a single spec with `pnpm build && npx playwright test tests/e2e/reports.spec.ts`.
- **Commit** after every task. Husky/lint-staged runs Biome on staged files automatically — do not fight it.
- **Pre-existing gotcha (do not "fix" — out of scope):** `MemoryLedgerStore.getSnapshot()` assigns `reports`/`closeRun` without `await` (`packages/domain/src/store.ts:490,492`). New period endpoints in this plan call store methods that ARE awaited in the route handler. Never reuse the unawaited pattern.
- **BAS mapping note:** The demo seed/posting accounts are a small fixed set (`1930, 2641, 6071, 6540, 6991`, …). This plan classifies by BAS _kontogrupp_ number ranges. Real årsredovisning ordering (BFN K2) is out of scope for the demo scaffold; the spec records this.

## File map

| Path                                                                      | Action                                                                         |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `packages/contracts/src/period.ts`                                        | Create — shared month-period resolver                                          |
| `packages/contracts/src/reports.ts`                                       | Create — P&L / BS / VAT-return Zod schemas + inputs                            |
| `packages/contracts/src/index.ts`                                         | Modify — add `VatPeriodFiled` event; `export * from "./period"`, `"./reports"` |
| `packages/reporting/src/bas-ranges.ts`                                    | Create — kontogrupp classifier                                                 |
| `packages/reporting/src/profit-loss.ts`                                   | Create — Resultaträkning projection                                            |
| `packages/reporting/src/balance-sheet.ts`                                 | Create — Balansräkning projection                                              |
| `packages/reporting/src/vat-return.ts`                                    | Create — Skatteverket box projection + filed-period fold                       |
| `packages/reporting/src/index.ts`                                         | Modify — re-export the new modules                                             |
| `packages/domain/src/store.ts`                                            | Modify — `LedgerStore` interface + `MemoryLedgerStore` methods                 |
| `packages/domain/src/supabase-store.ts`                                   | Modify — implement new interface methods                                       |
| `services/api/src/app.ts`                                                 | Modify — new report/VAT/export routes                                          |
| `packages/api-client/src/index.ts`                                        | Modify — new client methods                                                    |
| `apps/web/hooks/use-report.ts`                                            | Create — React Query wrapper                                                   |
| `apps/web/components/screens/reports-screen.tsx`                          | Rewrite — remove Phase-7 placeholders                                          |
| `apps/web/components/reports/profit-loss-view.tsx`                        | Create                                                                         |
| `apps/web/components/reports/balance-sheet-view.tsx`                      | Create                                                                         |
| `apps/web/components/reports/vat-return-view.tsx`                         | Create                                                                         |
| `apps/web/components/reports/exports-view.tsx`                            | Create                                                                         |
| `apps/web/components/reports/charts/{pl-stacked-bar,bs-area,vat-bar}.tsx` | Create                                                                         |
| `apps/web/components/ui/chart.tsx`                                        | Create (shadcn)                                                                |
| `apps/web/package.json`, root `package.json`                              | Modify — deps + `react-is` override                                            |
| `tests/unit/reporting-projections.test.ts`                                | Create                                                                         |
| `tests/unit/ledger-store-reports.test.ts`                                 | Create                                                                         |
| `tests/e2e/reports.spec.ts`                                               | Modify                                                                         |

---

## Task 7.0: Install charting + PDF dependencies

**Files:** `apps/web/package.json`, root `package.json`, `apps/web/components/ui/chart.tsx`, `services/api/package.json`

- [ ] **Step 1: Add Recharts to web**

```bash
pnpm --filter @jpx-accounting/web add recharts@^3
```

- [ ] **Step 2: Pin `react-is` to the React line via root override**

Open the root `package.json`. Add (or extend) a top-level `pnpm.overrides` block so Recharts' `react-is` peer matches React 19.2.x:

```json
"pnpm": {
  "overrides": {
    "react-is": "19.2.4"
  }
}
```

Then run `pnpm install` from the repo root.

- [ ] **Step 3: Generate the shadcn chart component**

```bash
pnpm --filter @jpx-accounting/web exec shadcn@latest add chart
```

Accept creation of `apps/web/components/ui/chart.tsx`. The current generator targets Recharts v3 — **no hand-patch**. If it prompts to overwrite any existing file other than `chart.tsx`, decline.

- [ ] **Step 4: Add the PDF renderer to the API service**

```bash
pnpm --filter @jpx-accounting/api add @react-pdf/renderer@^4
```

- [ ] **Step 5: Verify**

Run: `pnpm --filter @jpx-accounting/web list recharts && pnpm --filter @jpx-accounting/api list @react-pdf/renderer`
Expected: both resolve to the installed major versions; `pnpm typecheck` still passes.

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json services/api/package.json package.json pnpm-lock.yaml apps/web/components/ui/chart.tsx
git commit -m "chore(track-a/p7): add recharts v3, react-is override, @react-pdf/renderer, shadcn chart"
```

---

## Task 7.1: Shared period resolver + report contracts + VAT-filed event

**Files:**

- Create: `packages/contracts/src/period.ts`
- Create: `packages/contracts/src/reports.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `tests/unit/reporting-projections.test.ts` (create; first test covers the resolver)

- [ ] **Step 1: Write the failing test for the period resolver**

Create `tests/unit/reporting-projections.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";

import { resolveMonthPeriod } from "@jpx-accounting/contracts";

test("resolveMonthPeriod returns inclusive ISO date bounds for a YYYY-MM string", () => {
  const p = resolveMonthPeriod("2026-05");
  assert.equal(p.start, "2026-05-01");
  assert.equal(p.end, "2026-05-31");
  assert.equal(p.label, "2026-05");
});

test("resolveMonthPeriod handles February and falls back on a bad string", () => {
  assert.equal(resolveMonthPeriod("2024-02").end, "2024-02-29");
  const bad = resolveMonthPeriod("garbage");
  assert.equal(bad.start, "");
  assert.equal(bad.end, "");
  assert.equal(bad.label, "garbage");
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `npx tsx --test tests/unit/reporting-projections.test.ts`
Expected: FAIL — `resolveMonthPeriod` is not exported from `@jpx-accounting/contracts`.

- [ ] **Step 3: Create the period resolver**

Create `packages/contracts/src/period.ts`:

```typescript
export type ResolvedPeriod = { start: string; end: string; label: string };

/** Resolve a `YYYY-MM` string to inclusive ISO date bounds. Pure; shared by web, api-client, API, and reporting so all layers agree. */
export function resolveMonthPeriod(raw: string): ResolvedPeriod {
  const [year, month] = raw.split("-").map(Number);
  if (!year || !month || month < 1 || month > 12) {
    return { start: "", end: "", label: raw };
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  return {
    start: `${year}-${pad(month)}-01`,
    end: `${year}-${pad(month)}-${pad(lastDay)}`,
    label: raw,
  };
}

/** True when an ISO datetime/date string falls within an inclusive `ResolvedPeriod`. An empty period matches everything. */
export function isWithinPeriod(bookedAt: string, period: ResolvedPeriod): boolean {
  if (!period.start || !period.end) return true;
  const date = bookedAt.slice(0, 10);
  return date >= period.start && date <= period.end;
}
```

- [ ] **Step 4: Add report contracts**

Create `packages/contracts/src/reports.ts`:

```typescript
import { z } from "zod";

export const reportPeriodInputSchema = z.object({
  start: z.string(),
  end: z.string(),
  label: z.string(),
});
export type ReportPeriodInput = z.infer<typeof reportPeriodInputSchema>;

export const reportLineSchema = z.object({
  label: z.string(),
  accountRange: z.string(),
  amount: z.number(),
});
export type ReportLine = z.infer<typeof reportLineSchema>;

export const profitLossSchema = z.object({
  period: reportPeriodInputSchema,
  revenue: z.array(reportLineSchema),
  costs: z.array(reportLineSchema),
  financial: z.array(reportLineSchema),
  operatingResult: z.number(),
  resultAfterFinancial: z.number(),
  netResult: z.number(),
});
export type ProfitLoss = z.infer<typeof profitLossSchema>;

export const balanceSheetSchema = z.object({
  period: reportPeriodInputSchema,
  assets: z.array(reportLineSchema),
  equityAndLiabilities: z.array(reportLineSchema),
  totalAssets: z.number(),
  totalEquityAndLiabilities: z.number(),
  balanced: z.boolean(),
});
export type BalanceSheet = z.infer<typeof balanceSheetSchema>;

export const vatReturnBoxSchema = z.object({
  box: z.string(),
  label: z.string(),
  amount: z.number(),
  sourceAccounts: z.array(z.string()),
});
export type VatReturnBox = z.infer<typeof vatReturnBoxSchema>;

export const vatReturnSchema = z.object({
  period: reportPeriodInputSchema,
  boxes: z.array(vatReturnBoxSchema),
  netToPay: z.number(),
  filed: z.boolean(),
  filedBy: z.string().optional(),
  filedAt: z.string().optional(),
});
export type VatReturn = z.infer<typeof vatReturnSchema>;

export const vatFilingInputSchema = z.object({
  actorId: z.string(),
  period: z.string(),
});
export type VatFilingInput = z.infer<typeof vatFilingInputSchema>;
```

- [ ] **Step 5: Wire exports and the `VatPeriodFiled` event type**

In `packages/contracts/src/index.ts`, add `"VatPeriodFiled"` to the `eventTypeSchema` enum array (after `"OrganizationSettingsUpdated"`, before the closing `]`):

```typescript
  "OrganizationSettingsUpdated",
  "VatPeriodFiled",
]);
```

At the end of `packages/contracts/src/index.ts`, below the existing `export * from "./settings";`, add:

```typescript
export * from "./period";
export * from "./reports";
```

- [ ] **Step 6: Run the test, confirm it passes**

Run: `npx tsx --test tests/unit/reporting-projections.test.ts`
Expected: PASS (2 resolver tests).

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/period.ts packages/contracts/src/reports.ts packages/contracts/src/index.ts tests/unit/reporting-projections.test.ts
git commit -m "feat(track-a/p7): period resolver, report contracts, VatPeriodFiled event type"
```

---

## Task 7.2: BAS kontogrupp classifier

**Files:**

- Create: `packages/reporting/src/bas-ranges.ts`
- Test: `tests/unit/reporting-projections.test.ts` (extend)

- [ ] **Step 1: Append failing tests**

Add to `tests/unit/reporting-projections.test.ts`:

```typescript
import { classifyAccount } from "@jpx-accounting/reporting";

test("classifyAccount maps BAS numbers to statement sections", () => {
  assert.equal(classifyAccount("3001").section, "revenue");
  assert.equal(classifyAccount("6540").section, "cost");
  assert.equal(classifyAccount("7010").group, "Personalkostnader");
  assert.equal(classifyAccount("8410").section, "financial");
  assert.equal(classifyAccount("1930").section, "asset");
  assert.equal(classifyAccount("2440").section, "equity-liability");
  assert.equal(classifyAccount("2641").section, "equity-liability");
  assert.equal(classifyAccount("0000").section, "unclassified");
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx tsx --test tests/unit/reporting-projections.test.ts`
Expected: FAIL — `classifyAccount` not exported.

- [ ] **Step 3: Implement the classifier**

Create `packages/reporting/src/bas-ranges.ts`:

```typescript
export type StatementSection = "revenue" | "cost" | "financial" | "asset" | "equity-liability" | "unclassified";

export type AccountClassification = {
  section: StatementSection;
  group: string;
};

/** Classify a BAS account number by kontogrupp (first 2 digits) and class (first digit). */
export function classifyAccount(accountNumber: string): AccountClassification {
  const n = Number(accountNumber);
  if (!Number.isFinite(n)) return { section: "unclassified", group: "Övrigt" };

  // Class 1 — assets
  if (n >= 1000 && n <= 1399) return { section: "asset", group: "Anläggningstillgångar" };
  if (n >= 1400 && n <= 1999) return { section: "asset", group: "Omsättningstillgångar" };
  // Class 2 — equity & liabilities
  if (n >= 2000 && n <= 2099) return { section: "equity-liability", group: "Eget kapital" };
  if (n >= 2100 && n <= 2199) return { section: "equity-liability", group: "Obeskattade reserver" };
  if (n >= 2200 && n <= 2299) return { section: "equity-liability", group: "Avsättningar" };
  if (n >= 2300 && n <= 2399) return { section: "equity-liability", group: "Långfristiga skulder" };
  if (n >= 2400 && n <= 2999) return { section: "equity-liability", group: "Kortfristiga skulder" };
  // Class 3 — revenue
  if (n >= 3000 && n <= 3799) return { section: "revenue", group: "Nettoomsättning" };
  if (n >= 3800 && n <= 3899) return { section: "revenue", group: "Aktiverat arbete" };
  if (n >= 3900 && n <= 3999) return { section: "revenue", group: "Övriga rörelseintäkter" };
  // Classes 4–7 — operating costs
  if (n >= 4000 && n <= 4799) return { section: "cost", group: "Råvaror och förnödenheter" };
  if (n >= 5000 && n <= 6999) return { section: "cost", group: "Övriga externa kostnader" };
  if (n >= 7000 && n <= 7699) return { section: "cost", group: "Personalkostnader" };
  if (n >= 7700 && n <= 7899) return { section: "cost", group: "Av- och nedskrivningar" };
  if (n >= 7900 && n <= 7999) return { section: "cost", group: "Övriga rörelsekostnader" };
  // Class 8 — financial, appropriations, tax, result
  if (n >= 8000 && n <= 8799) return { section: "financial", group: "Finansiella poster" };
  if (n >= 8800 && n <= 8999) return { section: "financial", group: "Bokslutsdispositioner och skatt" };

  return { section: "unclassified", group: "Övrigt" };
}
```

- [ ] **Step 4: Re-export from reporting**

In `packages/reporting/src/index.ts`, add at the top of the file:

```typescript
export * from "./bas-ranges";
```

- [ ] **Step 5: Run, confirm pass**

Run: `npx tsx --test tests/unit/reporting-projections.test.ts`
Expected: PASS (resolver + classifier tests).

- [ ] **Step 6: Commit**

```bash
git add packages/reporting/src/bas-ranges.ts packages/reporting/src/index.ts tests/unit/reporting-projections.test.ts
git commit -m "feat(track-a/p7): BAS kontogrupp classifier"
```

---

## Task 7.3: Profit & Loss projection

**Files:**

- Create: `packages/reporting/src/profit-loss.ts`
- Test: `tests/unit/reporting-projections.test.ts` (extend)

- [ ] **Step 1: Append failing test**

Add to `tests/unit/reporting-projections.test.ts`:

```typescript
import { buildProfitLoss } from "@jpx-accounting/reporting";
import { resolveMonthPeriod as rp } from "@jpx-accounting/contracts";

const plLines = [
  {
    voucherId: "v1",
    accountNumber: "3001",
    accountName: "Försäljning",
    description: "Sale",
    debit: 0,
    credit: 10000,
    vatCode: "VAT25",
    bookedAt: "2026-05-10T09:00:00.000Z",
    deductible: false,
  },
  {
    voucherId: "v1",
    accountNumber: "6540",
    accountName: "IT-tjänster",
    description: "SaaS",
    debit: 2000,
    credit: 0,
    vatCode: "VAT25",
    bookedAt: "2026-05-12T09:00:00.000Z",
    deductible: true,
  },
  {
    voucherId: "v1",
    accountNumber: "7010",
    accountName: "Löner",
    description: "Salary",
    debit: 3000,
    credit: 0,
    vatCode: "NA",
    bookedAt: "2026-05-20T09:00:00.000Z",
    deductible: false,
  },
  {
    voucherId: "v2",
    accountNumber: "3001",
    accountName: "Försäljning",
    description: "Out of period",
    debit: 0,
    credit: 999,
    vatCode: "VAT25",
    bookedAt: "2026-04-30T09:00:00.000Z",
    deductible: false,
  },
];

test("buildProfitLoss sums revenue and costs within the period and computes results", () => {
  const pl = buildProfitLoss(plLines, rp("2026-05"));
  const revenue = pl.revenue.reduce((s, l) => s + l.amount, 0);
  const costs = pl.costs.reduce((s, l) => s + l.amount, 0);
  assert.equal(revenue, 10000); // April line excluded
  assert.equal(costs, 5000);
  assert.equal(pl.operatingResult, 5000);
  assert.equal(pl.netResult, 5000);
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx tsx --test tests/unit/reporting-projections.test.ts`
Expected: FAIL — `buildProfitLoss` not exported.

- [ ] **Step 3: Implement**

Create `packages/reporting/src/profit-loss.ts`:

```typescript
import { type ProfitLoss, type ReportPeriodInput, isWithinPeriod } from "@jpx-accounting/contracts";
import type { LedgerLine } from "@jpx-accounting/domain";
import { classifyAccount } from "./bas-ranges";

/** Net movement of a line for P&L: credit-positive for revenue, debit-positive for costs. */
function groupLines(lines: LedgerLine[], section: "revenue" | "cost" | "financial") {
  const byGroup = new Map<string, { label: string; accountRange: string; amount: number }>();
  for (const line of lines) {
    const c = classifyAccount(line.accountNumber);
    if (c.section !== section) continue;
    const signed = section === "revenue" ? line.credit - line.debit : line.debit - line.credit;
    const existing = byGroup.get(c.group) ?? { label: c.group, accountRange: c.group, amount: 0 };
    existing.amount += signed;
    byGroup.set(c.group, existing);
  }
  return [...byGroup.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function buildProfitLoss(lines: LedgerLine[], period: ReportPeriodInput): ProfitLoss {
  const scoped = lines.filter((l) => isWithinPeriod(l.bookedAt, period));
  const revenue = groupLines(scoped, "revenue");
  const costs = groupLines(scoped, "cost");
  const financial = groupLines(scoped, "financial");

  const revenueTotal = revenue.reduce((s, l) => s + l.amount, 0);
  const costsTotal = costs.reduce((s, l) => s + l.amount, 0);
  const financialTotal = financial.reduce((s, l) => s + l.amount, 0);
  const operatingResult = revenueTotal - costsTotal;
  const resultAfterFinancial = operatingResult + financialTotal;

  return {
    period,
    revenue,
    costs,
    financial,
    operatingResult,
    resultAfterFinancial,
    netResult: resultAfterFinancial,
  };
}
```

- [ ] **Step 4: Re-export**

In `packages/reporting/src/index.ts`, add:

```typescript
export * from "./profit-loss";
```

- [ ] **Step 5: Run, confirm pass**

Run: `npx tsx --test tests/unit/reporting-projections.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/reporting/src/profit-loss.ts packages/reporting/src/index.ts tests/unit/reporting-projections.test.ts
git commit -m "feat(track-a/p7): profit-loss (Resultaträkning) projection"
```

---

## Task 7.4: Balance Sheet projection

**Files:**

- Create: `packages/reporting/src/balance-sheet.ts`
- Test: `tests/unit/reporting-projections.test.ts` (extend)

- [ ] **Step 1: Append failing test**

Add to `tests/unit/reporting-projections.test.ts`:

```typescript
import { buildBalanceSheet } from "@jpx-accounting/reporting";

const bsLines = [
  {
    voucherId: "v1",
    accountNumber: "1930",
    accountName: "Företagskonto",
    description: "Bank",
    debit: 8000,
    credit: 0,
    vatCode: "NA",
    bookedAt: "2026-05-10T09:00:00.000Z",
    deductible: false,
  },
  {
    voucherId: "v1",
    accountNumber: "2440",
    accountName: "Leverantörsskulder",
    description: "AP",
    debit: 0,
    credit: 3000,
    vatCode: "NA",
    bookedAt: "2026-05-12T09:00:00.000Z",
    deductible: false,
  },
  {
    voucherId: "v1",
    accountNumber: "2010",
    accountName: "Eget kapital",
    description: "Equity",
    debit: 0,
    credit: 5000,
    vatCode: "NA",
    bookedAt: "2026-05-12T09:00:00.000Z",
    deductible: false,
  },
];

test("buildBalanceSheet groups class 1 vs class 2 and reports balanced", () => {
  const bs = buildBalanceSheet(bsLines, rp("2026-05"));
  assert.equal(bs.totalAssets, 8000);
  assert.equal(bs.totalEquityAndLiabilities, 8000);
  assert.equal(bs.balanced, true);
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx tsx --test tests/unit/reporting-projections.test.ts`
Expected: FAIL — `buildBalanceSheet` not exported.

- [ ] **Step 3: Implement**

Create `packages/reporting/src/balance-sheet.ts`:

```typescript
import { type BalanceSheet, type ReportPeriodInput, isWithinPeriod } from "@jpx-accounting/contracts";
import type { LedgerLine } from "@jpx-accounting/domain";
import { classifyAccount } from "./bas-ranges";

function groupBalances(lines: LedgerLine[], section: "asset" | "equity-liability") {
  const byGroup = new Map<string, { label: string; accountRange: string; amount: number }>();
  for (const line of lines) {
    const c = classifyAccount(line.accountNumber);
    if (c.section !== section) continue;
    // Assets are debit-normal; equity & liabilities are credit-normal.
    const signed = section === "asset" ? line.debit - line.credit : line.credit - line.debit;
    const existing = byGroup.get(c.group) ?? { label: c.group, accountRange: c.group, amount: 0 };
    existing.amount += signed;
    byGroup.set(c.group, existing);
  }
  return [...byGroup.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function buildBalanceSheet(lines: LedgerLine[], period: ReportPeriodInput): BalanceSheet {
  const scoped = lines.filter((l) => isWithinPeriod(l.bookedAt, period));
  const assets = groupBalances(scoped, "asset");
  const equityAndLiabilities = groupBalances(scoped, "equity-liability");
  const totalAssets = assets.reduce((s, l) => s + l.amount, 0);
  const totalEquityAndLiabilities = equityAndLiabilities.reduce((s, l) => s + l.amount, 0);
  return {
    period,
    assets,
    equityAndLiabilities,
    totalAssets,
    totalEquityAndLiabilities,
    balanced: Math.abs(totalAssets - totalEquityAndLiabilities) < 0.005,
  };
}
```

- [ ] **Step 4: Re-export**

In `packages/reporting/src/index.ts`, add:

```typescript
export * from "./balance-sheet";
```

- [ ] **Step 5: Run, confirm pass**

Run: `npx tsx --test tests/unit/reporting-projections.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/reporting/src/balance-sheet.ts packages/reporting/src/index.ts tests/unit/reporting-projections.test.ts
git commit -m "feat(track-a/p7): balance-sheet (Balansräkning) projection"
```

---

## Task 7.5: VAT return projection + filed-period fold

**Files:**

- Create: `packages/reporting/src/vat-return.ts`
- Test: `tests/unit/reporting-projections.test.ts` (extend)

- [ ] **Step 1: Append failing test**

Add to `tests/unit/reporting-projections.test.ts`:

```typescript
import { buildVatReturn, deriveFiledPeriods } from "@jpx-accounting/reporting";

const vatLines = [
  {
    voucherId: "v1",
    accountNumber: "3001",
    accountName: "Försäljning",
    description: "Sale 25%",
    debit: 0,
    credit: 10000,
    vatCode: "VAT25",
    bookedAt: "2026-05-10T00:00:00.000Z",
    deductible: false,
  },
  {
    voucherId: "v1",
    accountNumber: "2610",
    accountName: "Utgående moms 25%",
    description: "Output VAT",
    debit: 0,
    credit: 2500,
    vatCode: "VAT25",
    bookedAt: "2026-05-10T00:00:00.000Z",
    deductible: false,
  },
  {
    voucherId: "v1",
    accountNumber: "2641",
    accountName: "Debiterad ingående moms",
    description: "Input VAT",
    debit: 500,
    credit: 0,
    vatCode: "VAT25",
    bookedAt: "2026-05-12T00:00:00.000Z",
    deductible: true,
  },
];

test("buildVatReturn computes box 10 (output) and 48 (input) and net to pay", () => {
  const r = buildVatReturn(vatLines, rp("2026-05"), []);
  const box10 = r.boxes.find((b) => b.box === "10");
  const box48 = r.boxes.find((b) => b.box === "48");
  assert.equal(box10?.amount, 2500);
  assert.equal(box48?.amount, 500);
  assert.equal(r.netToPay, 2000);
  assert.equal(r.filed, false);
});

test("deriveFiledPeriods folds VatPeriodFiled events; buildVatReturn reflects filed state", () => {
  const events = [
    {
      eventType: "VatPeriodFiled",
      actorId: "user_a",
      occurredAt: "2026-06-01T08:00:00.000Z",
      payload: { period: "2026-05" },
    },
  ];
  const filed = deriveFiledPeriods(events as never);
  assert.equal(filed["2026-05"]?.filedBy, "user_a");
  const r = buildVatReturn(vatLines, rp("2026-05"), events as never);
  assert.equal(r.filed, true);
  assert.equal(r.filedBy, "user_a");
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx tsx --test tests/unit/reporting-projections.test.ts`
Expected: FAIL — `buildVatReturn`/`deriveFiledPeriods` not exported.

- [ ] **Step 3: Implement**

Create `packages/reporting/src/vat-return.ts`:

```typescript
import {
  type LedgerEvent,
  type ReportPeriodInput,
  type VatReturn,
  type VatReturnBox,
  isWithinPeriod,
} from "@jpx-accounting/contracts";
import type { LedgerLine } from "@jpx-accounting/domain";

export type FiledPeriod = { filedBy: string; filedAt: string };

/** Fold append-only events into a map of period → filing provenance. Unknown event kinds are ignored. */
export function deriveFiledPeriods(events: LedgerEvent[]): Record<string, FiledPeriod> {
  const filed: Record<string, FiledPeriod> = {};
  for (const event of events) {
    if (event.eventType !== "VatPeriodFiled") continue;
    const period = String((event.payload as { period?: unknown }).period ?? "");
    if (!period) continue;
    filed[period] = { filedBy: event.actorId, filedAt: event.occurredAt };
  }
  return filed;
}

const BOX_DEFS: { box: string; label: string; accounts: string[] }[] = [
  { box: "05", label: "Momspliktig försäljning (exkl. moms)", accounts: ["3000-3799"] },
  { box: "10", label: "Utgående moms 25 %", accounts: ["2610", "2611"] },
  { box: "11", label: "Utgående moms 12 %", accounts: ["2620", "2621"] },
  { box: "12", label: "Utgående moms 6 %", accounts: ["2630", "2631"] },
  { box: "48", label: "Ingående moms att dra av", accounts: ["2640", "2641", "2645", "2647"] },
];

function accountInBox(accountNumber: string, accounts: string[]): boolean {
  const n = Number(accountNumber);
  return accounts.some((a) => {
    if (a.includes("-")) {
      const [lo, hi] = a.split("-").map(Number);
      return n >= lo && n <= hi;
    }
    return a === accountNumber;
  });
}

export function buildVatReturn(lines: LedgerLine[], period: ReportPeriodInput, events: LedgerEvent[]): VatReturn {
  const scoped = lines.filter((l) => isWithinPeriod(l.bookedAt, period));
  const boxes: VatReturnBox[] = BOX_DEFS.map((def) => {
    const matched = scoped.filter((l) => accountInBox(l.accountNumber, def.accounts));
    // Box 05 is a tax base (net of debit/credit on revenue accounts); VAT boxes are the moms account movement.
    const amount = matched.reduce((s, l) => s + Math.abs(l.credit - l.debit), 0);
    return {
      box: def.box,
      label: def.label,
      amount,
      sourceAccounts: [...new Set(matched.map((l) => l.accountNumber))],
    };
  });

  const output = boxes.filter((b) => ["10", "11", "12"].includes(b.box)).reduce((s, b) => s + b.amount, 0);
  const input = boxes.find((b) => b.box === "48")?.amount ?? 0;

  const filed = deriveFiledPeriods(events)[period.label];

  return {
    period,
    boxes,
    netToPay: output - input,
    filed: Boolean(filed),
    ...(filed ? { filedBy: filed.filedBy, filedAt: filed.filedAt } : {}),
  };
}
```

- [ ] **Step 4: Re-export**

In `packages/reporting/src/index.ts`, add:

```typescript
export * from "./vat-return";
```

- [ ] **Step 5: Run, confirm pass**

Run: `npx tsx --test tests/unit/reporting-projections.test.ts`
Expected: PASS (all reporting-projection tests).

- [ ] **Step 6: Commit**

```bash
git add packages/reporting/src/vat-return.ts packages/reporting/src/index.ts tests/unit/reporting-projections.test.ts
git commit -m "feat(track-a/p7): VAT return (Skatteverket boxes) + filed-period fold"
```

---

## Task 7.6: Store interface + Memory & Supabase implementations

**Files:**

- Modify: `packages/domain/src/store.ts` (interface lines 32–54; `MemoryLedgerStore` add methods near line 628)
- Modify: `packages/domain/src/supabase-store.ts`
- Test: `tests/unit/ledger-store-reports.test.ts` (create)

- [ ] **Step 1: Write the failing store test**

Create `tests/unit/ledger-store-reports.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";

import { resolveMonthPeriod } from "@jpx-accounting/contracts";
import { MemoryLedgerStore } from "@jpx-accounting/domain";

const ALL = resolveMonthPeriod("");

test("MemoryLedgerStore exposes period-scoped reports and event-sourced VAT filing", async () => {
  const store = new MemoryLedgerStore();

  const pl = await store.getProfitLoss(ALL);
  assert.ok(Array.isArray(pl.costs));

  const bs = await store.getBalanceSheet(ALL);
  assert.equal(typeof bs.balanced, "boolean");

  const vat = await store.getVatReturn(ALL);
  assert.equal(vat.filed, false);

  const filed = await store.fileVatPeriod({ actorId: "user_founder", period: ALL.label || "all" });
  assert.equal(filed.filed, true);
  assert.equal(filed.filedBy, "user_founder");

  // Idempotent: filing again does not throw and stays filed.
  const again = await store.fileVatPeriod({ actorId: "user_founder", period: ALL.label || "all" });
  assert.equal(again.filed, true);
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx tsx --test tests/unit/ledger-store-reports.test.ts`
Expected: FAIL — `getProfitLoss` is not a function.

- [ ] **Step 3: Extend the `LedgerStore` interface**

In `packages/domain/src/store.ts`, add these imports to the existing `import type { … } from "@jpx-accounting/contracts";` block:

```typescript
  BalanceSheet,
  ProfitLoss,
  ReportPeriodInput,
  VatFilingInput,
  VatReturn,
```

Add to the `LedgerStore` interface (after `saveCompanySettings`, before the closing `}` at line 54):

```typescript
  getProfitLoss(period: ReportPeriodInput): Promise<ProfitLoss>;
  getBalanceSheet(period: ReportPeriodInput): Promise<BalanceSheet>;
  getVatReturn(period: ReportPeriodInput): Promise<VatReturn>;
  fileVatPeriod(input: VatFilingInput): Promise<VatReturn>;
```

- [ ] **Step 4: Implement in `MemoryLedgerStore`**

In `packages/domain/src/store.ts`, add this import near the top (with the other relative imports):

```typescript
import { buildBalanceSheet, buildProfitLoss, buildVatReturn } from "@jpx-accounting/reporting";
```

Add `@jpx-accounting/reporting` to `packages/domain/package.json` dependencies (`"@jpx-accounting/reporting": "workspace:*"`) and run `pnpm install`.

Add these methods to the `MemoryLedgerStore` class (immediately after `saveCompanySettings`, before the final closing `}`):

```typescript
  async getProfitLoss(period: ReportPeriodInput): Promise<ProfitLoss> {
    return buildProfitLoss(this.ledgerLines, period);
  }

  async getBalanceSheet(period: ReportPeriodInput): Promise<BalanceSheet> {
    return buildBalanceSheet(this.ledgerLines, period);
  }

  async getVatReturn(period: ReportPeriodInput): Promise<VatReturn> {
    return buildVatReturn(this.ledgerLines, period, this.events);
  }

  async fileVatPeriod(input: VatFilingInput): Promise<VatReturn> {
    const alreadyFiled = this.events.some(
      (e) => e.eventType === "VatPeriodFiled" && (e.payload as { period?: string }).period === input.period,
    );
    if (!alreadyFiled) {
      this.appendEvent({
        organizationId: defaultOrganizationId,
        workspaceId: defaultWorkspaceId,
        aggregateType: "ledger",
        aggregateId: `vat:${input.period}`,
        eventType: "VatPeriodFiled",
        actorId: input.actorId,
        occurredAt: nowIso(),
        payload: { period: input.period },
      });
    }
    return buildVatReturn(this.ledgerLines, { start: "", end: "", label: input.period }, this.events);
  }
```

- [ ] **Step 5: Implement in `SupabaseLedgerStore`**

In `packages/domain/src/supabase-store.ts`, add the same contract type imports, add `import { buildBalanceSheet, buildProfitLoss, buildVatReturn } from "@jpx-accounting/reporting";`, and add these methods to the class (after `saveCompanySettings`). They reuse the existing journal-row→`LedgerLine` mapping the class already uses in `getReports`:

```typescript
  private async loadLines() {
    const { data, error } = await this.projections()
      .from("journal_entries")
      .select("*")
      .eq("organization_id", this.ctx.organizationId)
      .eq("workspace_id", this.ctx.workspaceId)
      .order("booked_at", { ascending: true });
    if (error) throw new Error(`Failed to load journal entries: ${error.message}`);
    return (data ?? []).map((row) => mapJournalRowToLedgerLine(row));
  }

  async getProfitLoss(period: ReportPeriodInput): Promise<ProfitLoss> {
    return buildProfitLoss(await this.loadLines(), period);
  }

  async getBalanceSheet(period: ReportPeriodInput): Promise<BalanceSheet> {
    return buildBalanceSheet(await this.loadLines(), period);
  }

  async getVatReturn(period: ReportPeriodInput): Promise<VatReturn> {
    return buildVatReturn(await this.loadLines(), period, await this.getEvents());
  }

  async fileVatPeriod(_input: VatFilingInput): Promise<VatReturn> {
    throw new Error("fileVatPeriod is not implemented in SupabaseLedgerStore yet (tracked in the auth-and-database plan).");
  }
```

(`mapJournalRowToLedgerLine` is already imported in this file — it backs `getReports`. If the import is missing, add it from `./supabase-mappers`.)

- [ ] **Step 6: Run the store test, confirm pass**

Run: `npx tsx --test tests/unit/ledger-store-reports.test.ts`
Expected: PASS.

- [ ] **Step 7: Full typecheck**

Run: `pnpm typecheck`
Expected: PASS (interface satisfied by both stores).

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/store.ts packages/domain/src/supabase-store.ts packages/domain/package.json pnpm-lock.yaml tests/unit/ledger-store-reports.test.ts
git commit -m "feat(track-a/p7): period-scoped report + VAT-filing store methods"
```

---

## Task 7.7: API routes for reports, VAT filing, period-scoped SIE

**Files:**

- Modify: `services/api/src/app.ts`
- Test: `tests/e2e/reports.spec.ts` (api-level assertions added in Task 7.12; here verify by curl)

- [ ] **Step 1: Add report read routes**

In `services/api/src/app.ts`, add `resolveMonthPeriod` and `vatFilingInputSchema` to the `@jpx-accounting/contracts` import. After the existing `app.get("/api/reports/vat-prep", …)` line, add:

```typescript
app.get("/api/reports/profit-loss", async (context) => {
  const period = resolveMonthPeriod(context.req.query("period") ?? "");
  return context.json(await currentStore.getProfitLoss(period));
});
app.get("/api/reports/balance-sheet", async (context) => {
  const period = resolveMonthPeriod(context.req.query("period") ?? "");
  return context.json(await currentStore.getBalanceSheet(period));
});
app.get("/api/reports/vat-return", async (context) => {
  const period = resolveMonthPeriod(context.req.query("period") ?? "");
  return context.json(await currentStore.getVatReturn(period));
});
```

- [ ] **Step 2: Add the VAT filing route**

After the VAT return route, add:

```typescript
app.post("/api/vat/periods/:period/file", async (context) => {
  const input = await parseBody(context.req.raw, vatFilingInputSchema);
  return context.json(
    await currentStore.fileVatPeriod({ actorId: input.actorId, period: context.req.param("period") }),
    201,
  );
});
```

- [ ] **Step 3: Make SIE export period-aware**

Replace `buildSIEExport` (lines 50–61) so it filters by an optional period, and update the route. New `buildSIEExport`:

```typescript
async function buildSIEExport(store: LedgerStore, periodRaw?: string) {
  const reports = await store.getReports();
  const period = resolveMonthPeriod(periodRaw ?? "");
  const lines = ["#FLAGGA 0", '#PROGRAM "JPX Accounting" "0.1.0"', "#FORMAT PC8"];
  for (const entry of reports.journal) {
    if (period.start && period.end) {
      const d = entry.bookedAt.slice(0, 10);
      if (d < period.start || d > period.end) continue;
    }
    lines.push(`#VER A "${entry.voucherId}" "${entry.bookedAt.slice(0, 10)}" "${entry.description}"`);
    lines.push(`#TRANS ${entry.accountNumber} {} ${entry.debit - entry.credit}`);
  }
  return lines.join("\n");
}
```

Update the route:

```typescript
app.get("/api/exports/sie", async (context) => {
  context.header("content-type", "text/plain; charset=utf-8");
  return context.body(await buildSIEExport(currentStore, context.req.query("period") ?? undefined));
});
```

- [ ] **Step 4: Build the API and smoke-test the routes**

Run:

```bash
pnpm --filter @jpx-accounting/api exec tsx src/index.ts &
sleep 2
curl -s "http://127.0.0.1:3001/api/reports/profit-loss?period=2026-05" | head -c 200
curl -s -X POST "http://127.0.0.1:3001/api/vat/periods/2026-05/file" -H 'content-type: application/json' -d '{"actorId":"user_founder","period":"2026-05"}' | head -c 200
kill %1
```

Expected: JSON P&L object; JSON VAT return with `"filed":true`.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/app.ts
git commit -m "feat(track-a/p7): period-aware report, VAT-filing, and SIE routes"
```

---

## Task 7.8: API client methods

**Files:** Modify `packages/api-client/src/index.ts`

- [ ] **Step 1: Extend the client**

Add `BalanceSheet, ProfitLoss, VatReturn, resolveMonthPeriod` to the `@jpx-accounting/contracts` imports (the value `resolveMonthPeriod` is a runtime import — move it out of the `import type` block into a normal `import { resolveMonthPeriod } from "@jpx-accounting/contracts";`). Add these methods to `AccountingApiClient` (after `saveCompanySettings`):

```typescript
  async getProfitLoss(periodRaw: string): Promise<ProfitLoss> {
    if (this.fallbackStore) return this.fallbackStore.getProfitLoss(resolveMonthPeriod(periodRaw));
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return request<ProfitLoss>(this.baseUrl, `/api/reports/profit-loss?period=${encodeURIComponent(periodRaw)}`, { method: "GET" });
  }

  async getBalanceSheet(periodRaw: string): Promise<BalanceSheet> {
    if (this.fallbackStore) return this.fallbackStore.getBalanceSheet(resolveMonthPeriod(periodRaw));
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return request<BalanceSheet>(this.baseUrl, `/api/reports/balance-sheet?period=${encodeURIComponent(periodRaw)}`, { method: "GET" });
  }

  async getVatReturn(periodRaw: string): Promise<VatReturn> {
    if (this.fallbackStore) return this.fallbackStore.getVatReturn(resolveMonthPeriod(periodRaw));
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return request<VatReturn>(this.baseUrl, `/api/reports/vat-return?period=${encodeURIComponent(periodRaw)}`, { method: "GET" });
  }

  async fileVatPeriod(periodRaw: string, actorId: string): Promise<VatReturn> {
    if (this.fallbackStore) return this.fallbackStore.fileVatPeriod({ actorId, period: periodRaw });
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return request<VatReturn>(this.baseUrl, `/api/vat/periods/${encodeURIComponent(periodRaw)}/file`, {
      method: "POST",
      json: { actorId, period: periodRaw },
    });
  }
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm typecheck` → PASS.

```bash
git add packages/api-client/src/index.ts
git commit -m "feat(track-a/p7): api-client report + VAT-filing methods"
```

---

## Task 7.9: `useReport` hook + Reports screen rewrite + view components

**Files:**

- Create: `apps/web/hooks/use-report.ts`
- Create: `apps/web/components/reports/{profit-loss-view,balance-sheet-view,vat-return-view,exports-view}.tsx`
- Rewrite: `apps/web/components/screens/reports-screen.tsx`

- [ ] **Step 1: Create the shared report hook**

Create `apps/web/hooks/use-report.ts`:

```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import { usePeriodScope } from "./use-period-scope";
import { apiClient } from "../lib/client";

export function useProfitLoss() {
  const { raw } = usePeriodScope();
  return useQuery({ queryKey: ["report", "pl", raw], queryFn: () => apiClient.getProfitLoss(raw) });
}
export function useBalanceSheet() {
  const { raw } = usePeriodScope();
  return useQuery({ queryKey: ["report", "bs", raw], queryFn: () => apiClient.getBalanceSheet(raw) });
}
export function useVatReturn() {
  const { raw } = usePeriodScope();
  return useQuery({ queryKey: ["report", "vat", raw], queryFn: () => apiClient.getVatReturn(raw) });
}
```

(`usePeriodScope()` already returns `{ period, setPeriod, raw }`; `raw` is the `YYYY-MM` string and the same `?period=` URL state Books uses, so the period selector is shared automatically.)

- [ ] **Step 2: Profit & Loss view**

Create `apps/web/components/reports/profit-loss-view.tsx`:

```tsx
"use client";

import { formatMoney } from "../../lib/presentation";
import { useProfitLoss } from "../../hooks/use-report";
import { ScreenSkeleton } from "../ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { PlStackedBar } from "./charts/pl-stacked-bar";

export function ProfitLossView() {
  const { data } = useProfitLoss();
  if (!data) return <ScreenSkeleton />;
  const rows = [
    ...data.revenue.map((l) => ({ ...l, kind: "Intäkter" })),
    ...data.costs.map((l) => ({ ...l, kind: "Kostnader" })),
    ...data.financial.map((l) => ({ ...l, kind: "Finansiellt" })),
  ];
  return (
    <div className="glass-panel rounded-xl p-5" data-testid="pl-view">
      <h2 className="text-lg font-semibold">Resultaträkning</h2>
      <PlStackedBar data={data} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Post</TableHead>
            <TableHead>Grupp</TableHead>
            <TableHead className="text-right">Belopp</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={`${r.kind}-${r.label}`}>
              <TableCell>{r.kind}</TableCell>
              <TableCell>{r.label}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(r.amount)}</TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell colSpan={2} className="font-semibold">
              Rörelseresultat
            </TableCell>
            <TableCell className="text-right font-semibold tabular-nums">{formatMoney(data.operatingResult)}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell colSpan={2} className="font-semibold">
              Årets resultat
            </TableCell>
            <TableCell className="text-right font-semibold tabular-nums" data-testid="pl-net">
              {formatMoney(data.netResult)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 3: Balance Sheet view**

Create `apps/web/components/reports/balance-sheet-view.tsx`:

```tsx
"use client";

import { formatMoney } from "../../lib/presentation";
import { useBalanceSheet } from "../../hooks/use-report";
import { ScreenSkeleton } from "../ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { BsArea } from "./charts/bs-area";

export function BalanceSheetView() {
  const { data } = useBalanceSheet();
  if (!data) return <ScreenSkeleton />;
  const rows = [
    ...data.assets.map((l) => ({ ...l, side: "Tillgångar" })),
    ...data.equityAndLiabilities.map((l) => ({ ...l, side: "Eget kapital och skulder" })),
  ];
  return (
    <div className="glass-panel rounded-xl p-5" data-testid="bs-view">
      <h2 className="text-lg font-semibold">Balansräkning</h2>
      <BsArea data={data} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Sida</TableHead>
            <TableHead>Grupp</TableHead>
            <TableHead className="text-right">Belopp</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={`${r.side}-${r.label}`}>
              <TableCell>{r.side}</TableCell>
              <TableCell>{r.label}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(r.amount)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="mt-3 text-sm" data-testid="bs-balanced">
        {data.balanced ? "Balanserad ✓" : "Ej balanserad — kontrollera periodens verifikationer."}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: VAT return view (with filing)**

Create `apps/web/components/reports/vat-return-view.tsx`:

```tsx
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useVatReturn } from "../../hooks/use-report";
import { usePeriodScope } from "../../hooks/use-period-scope";
import { apiClient } from "../../lib/client";
import { formatMoney } from "../../lib/presentation";
import { Button } from "../ui/button";
import { ScreenSkeleton } from "../ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { VatBar } from "./charts/vat-bar";

export function VatReturnView() {
  const { raw } = usePeriodScope();
  const { data } = useVatReturn();
  const queryClient = useQueryClient();
  const fileMutation = useMutation({
    mutationFn: () => apiClient.fileVatPeriod(raw, "user_founder"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["report", "vat", raw] });
      toast.success("VAT period marked as filed.");
    },
    onError: () => toast.error("Could not file the VAT period."),
  });

  if (!data) return <ScreenSkeleton />;

  return (
    <div className="glass-panel rounded-xl p-5" data-testid="vat-return-view">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">Momsdeklaration</h2>
        {data.filed ? (
          <span data-testid="vat-filed" className="text-sm text-[var(--color-text-muted)]">
            Filed by {data.filedBy} on {data.filedAt?.slice(0, 10)}
          </span>
        ) : (
          <Button data-testid="vat-file-button" disabled={fileMutation.isPending} onClick={() => fileMutation.mutate()}>
            {fileMutation.isPending ? "Filing…" : "Mark period as filed"}
          </Button>
        )}
      </div>
      <VatBar data={data} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Box</TableHead>
            <TableHead>Beskrivning</TableHead>
            <TableHead>Konton</TableHead>
            <TableHead className="text-right">Belopp</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.boxes.map((b) => (
            <TableRow key={b.box}>
              <TableCell className="text-mono">{b.box}</TableCell>
              <TableCell>{b.label}</TableCell>
              <TableCell className="text-mono text-xs">{b.sourceAccounts.join(", ") || "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(b.amount)}</TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell colSpan={3} className="font-semibold">
              Moms att betala / få tillbaka (49)
            </TableCell>
            <TableCell className="text-right font-semibold tabular-nums" data-testid="vat-net">
              {formatMoney(data.netToPay)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 5: Exports view**

Create `apps/web/components/reports/exports-view.tsx`:

```tsx
"use client";

import { usePeriodScope } from "../../hooks/use-period-scope";
import { useProfitLoss } from "../../hooks/use-report";

export function ExportsView() {
  const { raw } = usePeriodScope();
  const { data: pl } = useProfitLoss();

  function downloadCsv() {
    if (!pl) return;
    const rows = [
      ["Kind", "Group", "Amount"],
      ...pl.revenue.map((l) => ["Intäkter", l.label, String(l.amount)]),
      ...pl.costs.map((l) => ["Kostnader", l.label, String(l.amount)]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `resultatrakning-${raw}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="glass-panel rounded-xl p-5" data-testid="exports-view">
      <h2 className="text-lg font-semibold">Exports</h2>
      <div className="mt-4 space-y-3">
        <a
          href={`/api-proxy/api/exports/sie?period=${encodeURIComponent(raw)}`}
          download={`ledger-${raw}.sie`}
          data-testid="export-sie"
          className="block rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white"
        >
          Download SIE 4 ({raw})
        </a>
        <button
          type="button"
          data-testid="export-csv"
          onClick={downloadCsv}
          className="block rounded-lg border px-4 py-2 text-sm font-medium"
        >
          Download CSV (Resultaträkning)
        </button>
        <a
          href={`/api-proxy/api/exports/pdf?report=pl&period=${encodeURIComponent(raw)}`}
          download={`resultatrakning-${raw}.pdf`}
          data-testid="export-pdf"
          className="block rounded-lg border px-4 py-2 text-sm font-medium"
        >
          Download PDF (Resultaträkning)
        </a>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Rewrite the Reports screen (remove Phase-7 placeholders)**

Replace the body of `apps/web/components/screens/reports-screen.tsx` with:

```tsx
"use client";

import { parseAsStringEnum, useQueryState } from "nuqs";
import { PeriodSelector } from "../books/period-selector";
import { BalanceSheetView } from "../reports/balance-sheet-view";
import { ExportsView } from "../reports/exports-view";
import { ProfitLossView } from "../reports/profit-loss-view";
import { VatReturnView } from "../reports/vat-return-view";
import { ScreenHeader } from "../ui/screen-header";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";

const views = ["pl", "bs", "vat", "exports"] as const;
type View = (typeof views)[number];

export function ReportsScreen() {
  const [view, setView] = useQueryState("view", parseAsStringEnum<View>([...views]).withDefault("pl"));

  return (
    <div className="page-shell space-y-6">
      <ScreenHeader
        eyebrow="Reports"
        title="Statutory and management reports, projected from the event history."
        description="P&L, balance sheet, and VAT return — period-scoped and consistent with the audit trail. Exports for accountant handoff and Skatteverket filing."
        aside={<PeriodSelector />}
      />
      <Tabs value={view} onValueChange={(v) => setView(v as View)}>
        <TabsList data-testid="reports-tabs">
          <TabsTrigger value="pl">P&L</TabsTrigger>
          <TabsTrigger value="bs">Balance sheet</TabsTrigger>
          <TabsTrigger value="vat">VAT return</TabsTrigger>
          <TabsTrigger value="exports">Exports</TabsTrigger>
        </TabsList>
      </Tabs>
      <section className="mt-4">
        {view === "pl" ? <ProfitLossView /> : null}
        {view === "bs" ? <BalanceSheetView /> : null}
        {view === "vat" ? <VatReturnView /> : null}
        {view === "exports" ? <ExportsView /> : null}
      </section>
    </div>
  );
}
```

(`PeriodSelector` from Books is reused so Reports and Books share the same `?period=` URL state.)

- [ ] **Step 7: Commit (charts created next task — build runs after Task 7.10)**

```bash
git add apps/web/hooks/use-report.ts apps/web/components/reports/profit-loss-view.tsx apps/web/components/reports/balance-sheet-view.tsx apps/web/components/reports/vat-return-view.tsx apps/web/components/reports/exports-view.tsx apps/web/components/screens/reports-screen.tsx
git commit -m "feat(track-a/p7): reports screen, period-shared views, VAT filing UI, exports"
```

---

## Task 7.10: Chart components (Recharts v3 via shadcn chart)

**Files:** Create `apps/web/components/reports/charts/{pl-stacked-bar,bs-area,vat-bar}.tsx`

- [ ] **Step 1: P&L stacked bar**

Create `apps/web/components/reports/charts/pl-stacked-bar.tsx`:

```tsx
"use client";

import { Bar, BarChart, XAxis, YAxis } from "recharts";
import type { ProfitLoss } from "@jpx-accounting/contracts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "../../ui/chart";

export function PlStackedBar({ data }: { data: ProfitLoss }) {
  const chartData = [
    { name: "Intäkter", value: data.revenue.reduce((s, l) => s + l.amount, 0) },
    { name: "Kostnader", value: data.costs.reduce((s, l) => s + l.amount, 0) },
    { name: "Resultat", value: data.netResult },
  ];
  return (
    <ChartContainer
      data-testid="pl-chart"
      config={{ value: { label: "Belopp", color: "var(--chart-1)" } }}
      className="min-h-[200px] w-full"
    >
      <BarChart data={chartData}>
        <XAxis dataKey="name" tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="value" fill="var(--chart-1)" radius={4} />
      </BarChart>
    </ChartContainer>
  );
}
```

- [ ] **Step 2: Balance-sheet area**

Create `apps/web/components/reports/charts/bs-area.tsx`:

```tsx
"use client";

import { Area, AreaChart, XAxis, YAxis } from "recharts";
import type { BalanceSheet } from "@jpx-accounting/contracts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "../../ui/chart";

export function BsArea({ data }: { data: BalanceSheet }) {
  const chartData = [
    { name: "Tillgångar", value: data.totalAssets },
    { name: "EK & skulder", value: data.totalEquityAndLiabilities },
  ];
  return (
    <ChartContainer
      data-testid="bs-chart"
      config={{ value: { label: "Belopp", color: "var(--chart-2)" } }}
      className="min-h-[200px] w-full"
    >
      <AreaChart data={chartData}>
        <XAxis dataKey="name" tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Area dataKey="value" stroke="var(--chart-2)" fill="var(--chart-2)" />
      </AreaChart>
    </ChartContainer>
  );
}
```

- [ ] **Step 3: VAT bar**

Create `apps/web/components/reports/charts/vat-bar.tsx`:

```tsx
"use client";

import { Bar, BarChart, XAxis, YAxis } from "recharts";
import type { VatReturn } from "@jpx-accounting/contracts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "../../ui/chart";

export function VatBar({ data }: { data: VatReturn }) {
  const chartData = data.boxes.map((b) => ({ name: b.box, value: b.amount }));
  return (
    <ChartContainer
      data-testid="vat-chart"
      config={{ value: { label: "Belopp", color: "var(--chart-3)" } }}
      className="min-h-[200px] w-full"
    >
      <BarChart data={chartData}>
        <XAxis dataKey="name" tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="value" fill="var(--chart-3)" radius={4} />
      </BarChart>
    </ChartContainer>
  );
}
```

- [ ] **Step 4: Typecheck + build**

Run: `pnpm typecheck && pnpm --filter @jpx-accounting/web build`
Expected: PASS. If the build errors on `ChartContainer`/`ChartTooltipContent` prop names, open `apps/web/components/ui/chart.tsx` and align imports to the exact exports the shadcn generator produced (the v3 generator exports `ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartConfig`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/reports/charts
git commit -m "feat(track-a/p7): P&L/BS/VAT chart components (recharts v3)"
```

---

## Task 7.11: Server-side PDF export route

**Files:** Modify `services/api/src/app.ts`; create `services/api/src/pdf/profit-loss-pdf.tsx`

- [ ] **Step 1: Create the PDF document**

Create `services/api/src/pdf/profit-loss-pdf.tsx`:

```tsx
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ProfitLoss } from "@jpx-accounting/contracts";

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 11 },
  h1: { fontSize: 18, marginBottom: 12, color: "#0f766e" },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  total: { flexDirection: "row", justifyContent: "space-between", marginTop: 8, fontWeight: "bold" },
});

export function ProfitLossPdf({ data }: { data: ProfitLoss }) {
  const all = [...data.revenue, ...data.costs, ...data.financial];
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.h1}>Resultaträkning — {data.period.label}</Text>
        {all.map((l) => (
          <View style={styles.row} key={`${l.label}-${l.accountRange}`}>
            <Text>{l.label}</Text>
            <Text>{l.amount.toFixed(2)} SEK</Text>
          </View>
        ))}
        <View style={styles.total}>
          <Text>Årets resultat</Text>
          <Text>{data.netResult.toFixed(2)} SEK</Text>
        </View>
      </Page>
    </Document>
  );
}
```

- [ ] **Step 2: Add the route**

In `services/api/src/app.ts`, add the PDF route after the SIE route:

```typescript
app.get("/api/exports/pdf", async (context) => {
  const { renderToBuffer } = await import("@react-pdf/renderer");
  const { ProfitLossPdf } = await import("./pdf/profit-loss-pdf");
  const period = resolveMonthPeriod(context.req.query("period") ?? "");
  const pl = await currentStore.getProfitLoss(period);
  const buffer = await renderToBuffer(ProfitLossPdf({ data: pl }));
  context.header("content-type", "application/pdf");
  context.header("content-disposition", `attachment; filename="resultatrakning-${period.label}.pdf"`);
  return context.body(buffer);
});
```

- [ ] **Step 3: Ensure the API bundles TSX**

The API runs via `tsx` (see `playwright.config.ts:25`), which compiles `.tsx` natively. Confirm `services/api/tsconfig.json` has `"jsx": "react-jsx"`; if absent, add it under `compilerOptions`. Run `pnpm --filter @jpx-accounting/api exec tsc --noEmit` → PASS.

- [ ] **Step 4: Smoke test**

Run:

```bash
pnpm --filter @jpx-accounting/api exec tsx src/index.ts &
sleep 2
curl -s "http://127.0.0.1:3001/api/exports/pdf?report=pl&period=2026-05" -o /tmp/pl.pdf && file /tmp/pl.pdf
kill %1
```

Expected: `/tmp/pl.pdf: PDF document`.

- [ ] **Step 5: Commit**

```bash
git add services/api/src/app.ts services/api/src/pdf/profit-loss-pdf.tsx services/api/tsconfig.json
git commit -m "feat(track-a/p7): server-side PDF export route"
```

---

## Task 7.12: E2E coverage (tabs, period, chart SVG smoke, VAT filing, exports, axe)

**Files:** Modify `tests/e2e/reports.spec.ts`

- [ ] **Step 1: Replace the reports spec**

Replace `tests/e2e/reports.spec.ts` with:

```typescript
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

test("reports shows P&L, BS, VAT, Exports — no Phase 7 placeholder", async ({ page }) => {
  await page.goto("/reports");
  await expect(page.getByTestId("reports-tabs")).toBeVisible();
  await expect(page.getByTestId("pl-view")).toBeVisible();
  await expect(page.getByText("Coming in Phase 7")).toHaveCount(0);
});

test("a chart renders real SVG (recharts v3 / React 19.2 smoke)", async ({ page }) => {
  await page.goto("/reports?view=pl");
  const svgPaths = page.locator('[data-testid="pl-chart"] svg path, [data-testid="pl-chart"] svg rect');
  await expect(svgPaths.first()).toBeVisible({ timeout: 10_000 });
});

test("VAT period can be filed and shows provenance", async ({ page }) => {
  await page.goto("/reports?view=vat");
  await page.getByTestId("vat-file-button").click();
  await expect(page.getByTestId("vat-filed")).toContainText("Filed by");
});

test("exports expose period-scoped SIE and PDF links", async ({ page }) => {
  await page.goto("/reports?view=exports");
  await expect(page.getByTestId("export-sie")).toHaveAttribute("href", /\/api-proxy\/api\/exports\/sie\?period=/);
  await expect(page.getByTestId("export-pdf")).toBeVisible();
});

test("reports has no serious accessibility violations", async ({ page }) => {
  await page.goto("/reports?view=pl");
  await expect(page.getByTestId("pl-view")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
});
```

- [ ] **Step 2: Confirm axe dependency**

`@axe-core/playwright` is listed in DEV_STATUS as landed. Verify: `pnpm --filter-prod -r list @axe-core/playwright || true`. If missing at the root test scope, install: `pnpm -w add -D @axe-core/playwright`.

- [ ] **Step 3: Run the full reports E2E**

Run: `pnpm build && npx playwright test tests/e2e/reports.spec.ts`
Expected: all 5 tests PASS on both `desktop-chromium` and `mobile-chromium`. If the chart SVG test fails (blank render — recharts#6857), apply the documented fallback: replace the three chart components with bespoke inline SVG (a simple `<svg>` with `<rect>` bars from the same data) and re-run; tables/numbers are unaffected.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/reports.spec.ts package.json pnpm-lock.yaml
git commit -m "test(track-a/p7): reports e2e — tabs, chart smoke, VAT filing, exports, axe"
```

---

## Phase 7 acceptance check

- [ ] `/reports` shows P&L, Balance Sheet, VAT, Exports; zero "Coming in Phase 7" copy
- [ ] Changing the period (PeriodSelector) re-fetches; the same `?period=` drives Books
- [ ] A chart renders real SVG in CI (smoke test green) — or documented bespoke-SVG fallback applied
- [ ] Marking a VAT period filed appends a `VatPeriodFiled` event; the period shows "Filed by … on …" and the button disappears
- [ ] SIE download is period-scoped; PDF P&L downloads as a valid PDF; CSV serializes the active P&L
- [ ] `pnpm typecheck && pnpm test:unit && pnpm build && pnpm test:e2e` all pass

## Self-review summary

- **Spec coverage (§4.1):** projections (7.2–7.5), period endpoints (7.7), `VatPeriodFiled` event (7.1, 7.6), charts via v3-native shadcn (7.0, 7.10), server-side PDF (7.11), shared `usePeriodScope` period with Books (7.9), `useReport` single fetch abstraction (7.9). VAT filing is event-sourced and idempotent (7.6).
- **Placeholders:** none — every code step shows complete code; BAS ranges, box defs, and test fixtures are concrete.
- **Type consistency:** `ProfitLoss`/`BalanceSheet`/`VatReturn`/`ReportPeriodInput`/`VatFilingInput` defined in 7.1 are used identically in 7.6/7.8/7.9/7.10/7.11; `resolveMonthPeriod` is the single period resolver everywhere; `classifyAccount` signature is stable across 7.2→7.3→7.4.
- **Backout:** every task ends in one revertable commit; reverting Task 7.10 (charts) leaves tables/exports working.
