# Information Architecture Restructure Implementation Plan

> **Progress (2026-05-19):** Phases 1–4 largely done; 5–8 not started. See [DEV_STATUS.md](../../DEV_STATUS.md) for the phase table before picking up work.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Plan is phased: complete Phase 1 fully before starting Phase 2, etc.

**Goal:** Replace the 4-tab IA (`Inbox / Reports / Advisor / Control`) with a 5-tab job-oriented IA (`Today / Capture / Books / Reports / Settings`), surface API capabilities currently without UI, and ship a real Settings page.

**Architecture:** Five-tab dock + ambient digest via parallel routes, global Cmd-K Advisor palette via `cmdk`, search-param-driven URL state via `nuqs`, real Settings sub-routes with React Hook Form + Zod, drill-through navigation in Books, statutory exports in Reports.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind 4, shadcn/ui (Base UI primitives) + cmdk + Sidebar block, TanStack Table 8, Recharts (via shadcn charts), nuqs 2, react-hotkeys-hook 5, react-hook-form 8 + zod 4, `@react-pdf/renderer` (lazy), Motion 12, Playwright + axe-core.

**Spec:** `docs/superpowers/specs/2026-05-13-ia-restructure-design.md`

---

## File map (high-level)

| Path | Action | Phase |
|---|---|---|
| `apps/web/proxy.ts` | Create | 1 |
| `apps/web/app/(shell)/layout.tsx` | Modify | 1 |
| `apps/web/app/(shell)/@digest/` | Create | 1 |
| `apps/web/app/(shell)/today/` | Create | 1 |
| `apps/web/app/(shell)/capture/` | Create | 1 (skeleton) → 5 (real) |
| `apps/web/app/(shell)/books/` | Create | 1 (skeleton) → 3 (real) |
| `apps/web/app/(shell)/reports/` | Modify | 1 + 3 + 7 |
| `apps/web/app/(shell)/settings/` | Restructure | 2 |
| `apps/web/app/(shell)/assistant/page.tsx` | Modify | 1 (becomes history) |
| `apps/web/components/screens/today-screen.tsx` | Create | 1 → 4 |
| `apps/web/components/screens/capture-screen.tsx` | Create | 5 |
| `apps/web/components/screens/books-screen.tsx` | Create | 3 |
| `apps/web/components/screens/reports-screen.tsx` | Rewrite | 3 + 7 |
| `apps/web/components/screens/settings/*` | Create | 2 + 8 |
| `apps/web/components/app-shell.tsx` | Rewrite (use shadcn sidebar) | 1 |
| `apps/web/components/ui/sidebar.tsx` | Add (shadcn) | 1 |
| `apps/web/components/ui/command.tsx` | Add (shadcn) | 6 |
| `apps/web/components/ui/data-table.tsx` | Add (shadcn) | 3 |
| `apps/web/components/ui/form.tsx` | Add (shadcn) | 2 |
| `apps/web/components/ui/chart.tsx` | Add (shadcn) | 7 |
| `apps/web/components/ui/tabs.tsx` | Add (shadcn) | 3 |
| `apps/web/components/ui/popover.tsx`, `calendar.tsx`, `dropdown-menu.tsx`, `toggle-group.tsx`, `switch.tsx`, `alert-dialog.tsx`, `avatar.tsx`, `breadcrumb.tsx`, `radio-group.tsx`, `kbd.tsx` | Add (shadcn or custom) | as needed |
| `packages/contracts/src/settings.ts` | Create | 2 |
| `packages/reporting/src/profit-loss.ts`, `balance-sheet.ts`, `vat-return.ts` | Create | 7 |
| `tests/e2e/today.spec.ts` (renamed) | Modify | 1 |
| `tests/e2e/capture.spec.ts` | Create | 5 |
| `tests/e2e/books.spec.ts` | Create | 3 |
| `tests/e2e/reports.spec.ts` | Modify | 3 + 7 |
| `tests/e2e/settings.spec.ts` | Create | 2 |
| `tests/e2e/advisor-palette.spec.ts` | Create | 6 |

---

## Phase 1 — Navigation foundation and route skeletons

**Goal:** Ship the new 5-tab dock, parallel-route digest, and skeleton pages with all redirects in place. After Phase 1, navigation feels new but functionality is identical to today (review queue still works, reports still work, settings shows old "about" content via redirect). No user-visible regressions.

**Estimated effort:** 1–2 days.

### Task 1.1: Install new dependencies

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Add nuqs and hotkeys to web app**

Run from repo root:

```bash
pnpm --filter @jpx-accounting/web add nuqs@^2 react-hotkeys-hook@^5
```

Note: `nuqs` latest stable is the `2.x` line (2.8.9 at time of writing). The `parseAsString`, `parseAsStringEnum`, `useQueryState`, and `NuqsAdapter` APIs used in later tasks are all available in 2.x.

- [ ] **Step 2: Verify install**

Run:

```bash
pnpm --filter @jpx-accounting/web list nuqs react-hotkeys-hook
```

Expected: both packages listed with versions matching the install.

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "chore(web): add nuqs and react-hotkeys-hook for IA restructure"
```

### Task 1.2: Add shadcn sidebar primitive

**Files:**
- Create: `apps/web/components/ui/sidebar.tsx` (via shadcn CLI)
- Create: `apps/web/hooks/use-mobile.tsx` (already may exist from earlier shadcn install — verify)
- Modify: `apps/web/app/globals.css` (sidebar CSS variables if not already set)

- [ ] **Step 1: Install via CLI**

Run from repo root:

```bash
pnpm --filter @jpx-accounting/web exec shadcn@latest add sidebar
```

If prompted about overwriting existing files, accept for `sidebar.tsx` only. Decline for any file already customized.

- [ ] **Step 2: Verify sidebar CSS variables**

Open `apps/web/app/globals.css` and confirm the `--sidebar*` variables already exist (set in `2026-04-01-shadcn-setup-design.md`). If missing, append the block from lines 78–88 of that spec.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/ui/sidebar.tsx apps/web/hooks/use-mobile.tsx apps/web/app/globals.css
git commit -m "feat(web): add shadcn sidebar primitive for new IA"
```

### Task 1.3: Create middleware for legacy-route redirects

**Files:**
- Create: `apps/web/proxy.ts`
- Test: `tests/e2e/navigation-and-share.spec.ts` (modify)

- [ ] **Step 1: Add failing E2E test for `/` redirect**

In `tests/e2e/navigation-and-share.spec.ts`, append:

```typescript
test("legacy / redirects to /today", async ({ page }) => {
  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(page.url()).toMatch(/\/today$/);
  expect(response?.status()).toBe(200);
});

test("legacy /assistant redirects to /today with advisor query", async ({ page }) => {
  await page.goto("/assistant");
  expect(page.url()).toMatch(/\/today\?advisor=open$/);
});
```

- [ ] **Step 2: Run tests — confirm failure**

```bash
pnpm test:e2e -- --grep "legacy"
```

Expected: both tests fail (no redirect yet).

- [ ] **Step 3: Implement proxy (Next.js 16 successor to middleware.ts)**

Create `apps/web/proxy.ts`:

```typescript
import { type NextRequest, NextResponse } from "next/server";

const REDIRECTS: Record<string, string> = {
  "/": "/today",
  "/assistant": "/today?advisor=open",
  "/settings": "/settings/company",
};

export function proxy(request: NextRequest) {
  const target = REDIRECTS[request.nextUrl.pathname];
  if (!target) {
    return NextResponse.next();
  }

  const destination = new URL(target, request.url);
  return NextResponse.redirect(destination, 308);
}

export const config = {
  matcher: ["/", "/assistant", "/settings"],
};
```

Note: Next.js 16 renamed `middleware.ts` → `proxy.ts` and the named export `middleware` → `proxy`. The `edge` runtime is not supported in `proxy`; this redirect runs on the node runtime, which is fine here.

- [ ] **Step 4: Run tests — confirm pass**

```bash
pnpm test:e2e -- --grep "legacy"
```

Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/proxy.ts tests/e2e/navigation-and-share.spec.ts
git commit -m "feat(web): redirect legacy routes to new IA"
```

### Task 1.4: Create new route skeletons

**Files:**
- Create: `apps/web/app/(shell)/today/page.tsx`
- Create: `apps/web/app/(shell)/capture/page.tsx`
- Create: `apps/web/app/(shell)/books/page.tsx`
- Modify: `apps/web/app/(shell)/page.tsx` (delete — handled by middleware redirect)
- Modify: `apps/web/app/(shell)/reports/page.tsx` (unchanged for now)
- Modify: `apps/web/app/(shell)/settings/page.tsx` (will be redirected by middleware; leave existing file as fallback)
- Modify: `apps/web/app/(shell)/assistant/page.tsx` (becomes Advisor history; covered later)

- [ ] **Step 1: Move `HomeScreen` to `TodayScreen`**

```bash
git mv apps/web/components/screens/home-screen.tsx apps/web/components/screens/today-screen.tsx
```

Edit the export name inside the file:

```typescript
// apps/web/components/screens/today-screen.tsx
export function TodayScreen() { /* ... same body for now ... */ }
```

Search and replace `HomeScreen` → `TodayScreen` inside that file.

- [ ] **Step 2: Create `/today` page**

Create `apps/web/app/(shell)/today/page.tsx`:

```typescript
import { TodayScreen } from "../../../components/screens/today-screen";

export default function TodayPage() {
  return <TodayScreen />;
}
```

- [ ] **Step 3: Delete old `/` page**

```bash
git rm apps/web/app/(shell)/page.tsx
```

Middleware will redirect `/` → `/today`.

- [ ] **Step 3.5: Clean up the Task 1.3 Playwright probe workaround**

Task 1.3 temporarily set `playwright.config.ts` `webServer.url` to `${baseURL}/reports` because the readiness probe hit `/` which now 308-redirects. Now that `/today` exists, change the probe back to point at the canonical home:

In `playwright.config.ts`, change the web `webServer.url` from `${baseURL}/reports` to `${baseURL}/today`.

This removes the workaround introduced in commit `3e220e5` so the probe always tracks the actual canonical home. (See the "no legacy code" rule — workaround configs are tracked debt; they don't outlive their phase.)

- [ ] **Step 4: Create skeleton pages for Capture and Books**

Create `apps/web/app/(shell)/capture/page.tsx`:

```typescript
import { ScreenHeader } from "../../../components/ui/screen-header";

export default function CapturePage() {
  return (
    <div className="page-shell space-y-6">
      <ScreenHeader
        eyebrow="Capture"
        title="Add evidence, see drafts, browse the archive."
        description="The single home for everything you've captured — drafts in progress, freshly uploaded, fully archived. Full implementation lands in Phase 5."
      />
    </div>
  );
}
```

Create `apps/web/app/(shell)/books/page.tsx`:

```typescript
import { ScreenHeader } from "../../../components/ui/screen-header";

export default function BooksPage() {
  return (
    <div className="page-shell space-y-6">
      <ScreenHeader
        eyebrow="Books"
        title="Explore the ledger — accounts, suppliers, journal, close."
        description="Drill-through navigation across journal, general ledger, trial balance, and suppliers. Full implementation lands in Phase 3."
      />
    </div>
  );
}
```

- [ ] **Step 5: Run typecheck**

```bash
pnpm typecheck
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app apps/web/components/screens
git commit -m "feat(web): scaffold today/capture/books routes and rename home → today"
```

### Task 1.5: Create parallel-route ambient digest

**Files:**
- Create: `apps/web/app/(shell)/@digest/default.tsx`
- Create: `apps/web/app/(shell)/@digest/page.tsx`
- Create: `apps/web/components/digest/digest-panel.tsx`
- Modify: `apps/web/app/(shell)/layout.tsx`

- [ ] **Step 1: Update `(shell)/layout.tsx` to accept the slot**

Replace the contents of `apps/web/app/(shell)/layout.tsx`:

```typescript
import type { ReactNode } from "react";

import { AppShell } from "../../components/app-shell";

export default function ShellLayout({
  children,
  digest,
}: {
  children: ReactNode;
  digest: ReactNode;
}) {
  return <AppShell digest={digest}>{children}</AppShell>;
}
```

- [ ] **Step 2: Create the digest fallback**

`apps/web/app/(shell)/@digest/default.tsx`:

```typescript
export default function DigestDefault() {
  return null;
}
```

- [ ] **Step 3: Create the digest page**

`apps/web/app/(shell)/@digest/page.tsx`:

```typescript
import { DigestPanel } from "../../../components/digest/digest-panel";

export default function DigestSlot() {
  return <DigestPanel />;
}
```

- [ ] **Step 4: Create the DigestPanel component**

`apps/web/components/digest/digest-panel.tsx`:

```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { apiClient } from "../../lib/client";
import { SectionLabel } from "../ui/section-label";
import { StatusBadge } from "../ui/status-badge";

export function DigestPanel() {
  const { data } = useQuery({
    queryKey: ["workspace"],
    queryFn: () => apiClient.getSnapshot(),
  });

  if (!data) return null;

  const pendingCount = data.reviews.filter((r) => r.status === "needs-review").length;
  const closeReady = data.closeRun?.checklist.filter((c) => c.status === "ready").length ?? 0;
  const closeBlocked = data.closeRun?.checklist.filter((c) => c.status === "blocked").length ?? 0;
  const topAlert = data.alerts[0];

  return (
    <aside data-testid="ambient-digest" className="glass-panel-soft rounded-xl p-4 space-y-4">
      <div>
        <SectionLabel>Today&apos;s pulse</SectionLabel>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Link href="/today" className="rounded-md bg-[var(--color-accent-soft)] px-3 py-2 font-medium text-[var(--color-accent)]">
            {pendingCount} pending
          </Link>
          <Link href="/books?view=close" className="rounded-md bg-[var(--color-info-soft)] px-3 py-2 font-medium text-[var(--color-info)]">
            {closeReady} ready · {closeBlocked} blocked
          </Link>
        </div>
      </div>
      {topAlert ? (
        <div>
          <SectionLabel>Compliance</SectionLabel>
          <Link href="/settings/compliance" className="mt-3 block">
            <p className="text-sm font-semibold">{topAlert.title}</p>
            <StatusBadge status={topAlert.source} variant="warning" />
          </Link>
        </div>
      ) : null}
    </aside>
  );
}
```

- [ ] **Step 5: Run typecheck**

```bash
pnpm typecheck
```

Expected: pass. (The `AppShell` prop change in Step 1 will fail until Task 1.6.)

If failure is only "Property 'digest' is missing": that's expected; proceed to Task 1.6 in the same commit branch.

### Task 1.6: Rewrite app-shell with new dock + sidebar + digest slot

**Files:**
- Modify: `apps/web/components/app-shell.tsx`
- Test: `tests/e2e/navigation-and-share.spec.ts`

- [ ] **Step 1: Update the navigation array**

In `apps/web/components/app-shell.tsx`, replace the `navigation` array (lines 17–22):

```typescript
const navigation = [
  { href: "/today", label: "Today", summary: "Today's review queue", icon: InboxIcon },
  { href: "/capture", label: "Capture", summary: "Evidence & drafts", icon: CaptureIcon },
  { href: "/books", label: "Books", summary: "Journal, accounts, close", icon: ReportsIcon },
  { href: "/reports", label: "Reports", summary: "P&L, BS, VAT, exports", icon: ReportsIcon },
  { href: "/settings", label: "Settings", summary: "Company & integrations", icon: ControlIcon },
];
```

- [ ] **Step 2: Update `AppShell` props to accept digest**

Change the component signature:

```typescript
export function AppShell({ children, digest }: { children: ReactNode; digest?: ReactNode }) {
```

- [ ] **Step 3: Render digest in the right rail (desktop) and as a collapsible chip (mobile)**

Inside the rail (`shell-rail-inner`), after the navigation `<nav>` block and before the capture section, add:

```tsx
{digest ? <div className="hidden lg:block">{digest}</div> : null}
```

For mobile, after the `<header>` block and before `<main>`, add:

```tsx
{digest ? (
  <details className="page-shell page-shell-compact lg:hidden" data-testid="digest-mobile">
    <summary className="glass-panel-soft cursor-pointer rounded-md px-4 py-3 text-sm font-medium">
      Today&apos;s pulse
    </summary>
    <div className="mt-2">{digest}</div>
  </details>
) : null}
```

- [ ] **Step 4: Update mobile dock to use 5 columns**

Replace `grid-cols-4` with `grid-cols-5` in the mobile dock div.

Since 5 icons on a phone is tight, also make icons size-3.5 instead of size-4 in the mobile dock.

- [ ] **Step 5: Update active-nav detection for new routes**

The existing `activeNavItem` logic uses `pathname === item.href` for `/`. Remove that special case — `/today`, `/capture`, etc. all use `startsWith` comparison:

```typescript
const activeNavItem = useMemo(
  () => navigation.find((item) => pathname.startsWith(item.href)) ?? navigation[0]!,
  [pathname],
);
```

Repeat the same change inside the desktop nav `<Link>` map and the mobile dock `<Link>` map.

- [ ] **Step 6: Update E2E navigation test**

In `tests/e2e/navigation-and-share.spec.ts`, find tests that visit `/` and `/assistant` and update them to use new routes. Add a test that verifies all 5 dock tabs are clickable:

```typescript
test("primary dock navigates between all five tabs", async ({ page }) => {
  await page.goto("/today");
  for (const route of ["/capture", "/books", "/reports", "/settings/company", "/today"]) {
    await page.getByRole("link", { name: new RegExp(route.split("/")[1]!, "i") }).first().click();
    await expect(page).toHaveURL(new RegExp(route));
  }
});
```

- [ ] **Step 7: Run E2E**

```bash
pnpm build && pnpm test:e2e -- --grep "navigation|legacy|dock"
```

Expected: navigation and legacy redirect tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/web/app apps/web/components tests/e2e/navigation-and-share.spec.ts
git commit -m "feat(web): five-tab IA dock with ambient digest parallel route"
```

### Task 1.7: Move /assistant content to history-only stub

**Files:**
- Modify: `apps/web/app/(shell)/assistant/page.tsx`
- Modify: `apps/web/components/screens/assistant-screen.tsx`
- Test: `tests/e2e/assistant.spec.ts`

- [ ] **Step 1: Rewrite assistant screen as history list**

Replace the body of `apps/web/components/screens/assistant-screen.tsx` to drop the question textarea and only render `assistantExamples` from the workspace snapshot as a list of past sessions. Add a top button "Open Advisor (⌘K)" that simply links to `/today?advisor=open` (the actual palette ships in Phase 6).

(See spec §5.1 for the eventual palette behavior.)

- [ ] **Step 2: Update assistant E2E**

Edit `tests/e2e/assistant.spec.ts`:
- Update test that asserted the question textarea exists — instead assert the "Open Advisor" button exists.
- Update test that submitted a question — for now, assert that clicking "Open Advisor" navigates to `/today?advisor=open`.

- [ ] **Step 3: Run E2E**

```bash
pnpm build && pnpm test:e2e -- tests/e2e/assistant.spec.ts
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/(shell)/assistant apps/web/components/screens/assistant-screen.tsx tests/e2e/assistant.spec.ts
git commit -m "refactor(web): demote assistant page to history; palette lands in phase 6"
```

### Phase 1 acceptance check

- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` succeeds
- [ ] `pnpm test:e2e` passes (legacy redirects, new dock, navigation tests)
- [ ] Manual: cold load `/` lands on `/today`; cold load `/assistant` lands on `/today?advisor=open`; cold load `/settings` lands on `/settings/company` (page may 404 until Phase 2 — acceptable).
- [ ] Manual: ambient digest visible in right rail on desktop and behind chip on mobile.

---

## Phase 2 — Real Settings page with company form

**Goal:** Replace the brochure-style Settings page with a sub-navigated settings shell. Ship the Company sub-page as the first real form (server action, Zod validation, persistence to the same workspace snapshot the API exposes). Move the old "Control" content under `/settings/about`.

**Estimated effort:** 1–2 days.

### Task 2.1: Install form primitives

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Add react-hook-form**

```bash
pnpm --filter @jpx-accounting/web add react-hook-form@^7 @hookform/resolvers@^5
```

Note: `react-hook-form` latest stable is the `7.x` line (no `^8` exists yet). `@hookform/resolvers` latest is `5.x`. The Zod resolver and `Controller` APIs we use are stable across these majors.

- [ ] **Step 2: Add shadcn form primitive**

```bash
pnpm --filter @jpx-accounting/web exec shadcn@latest add form
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json apps/web/components/ui pnpm-lock.yaml
git commit -m "chore(web): add react-hook-form and shadcn form primitive"
```

### Task 2.2: Add settings layout with sub-navigation

**Files:**
- Create: `apps/web/app/(shell)/settings/layout.tsx`
- Modify: `apps/web/app/(shell)/settings/page.tsx` (replace existing body with redirect)
- Create: `apps/web/components/settings/settings-sidebar.tsx`

- [ ] **Step 1: Build the sub-nav config**

`apps/web/components/settings/settings-sidebar.tsx`:

```typescript
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const sections = [
  { href: "/settings/company", label: "Company" },
  { href: "/settings/fiscal-year", label: "Fiscal year & VAT" },
  { href: "/settings/integrations", label: "Integrations" },
  { href: "/settings/team", label: "Team & roles" },
  { href: "/settings/ai-posture", label: "AI posture" },
  { href: "/settings/retention", label: "Retention" },
  { href: "/settings/compliance", label: "Compliance watch" },
  { href: "/settings/about", label: "About this build" },
];

export function SettingsSidebar() {
  const pathname = usePathname();
  return (
    <nav data-testid="settings-sidebar" className="glass-panel rounded-xl p-2 lg:w-64">
      <ul className="space-y-1">
        {sections.map((section) => {
          const active = pathname.startsWith(section.href);
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={`block rounded-md px-3 py-2 text-sm ${
                  active
                    ? "bg-[var(--color-accent)] text-white"
                    : "text-[var(--color-text)] hover:bg-[rgba(255,255,255,0.5)]"
                }`}
              >
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 2: Create settings layout**

`apps/web/app/(shell)/settings/layout.tsx`:

```typescript
import type { ReactNode } from "react";

import { SettingsSidebar } from "../../../components/settings/settings-sidebar";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="page-shell space-y-6">
      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <SettingsSidebar />
        <main>{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Replace settings index with redirect**

Replace `apps/web/app/(shell)/settings/page.tsx`:

```typescript
import { redirect } from "next/navigation";

export default function SettingsIndex() {
  redirect("/settings/company");
}
```

- [ ] **Step 4: Run typecheck**

```bash
pnpm typecheck
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/(shell)/settings apps/web/components/settings
git commit -m "feat(web): settings layout with section sub-navigation"
```

### Task 2.3: Move old Control content to /settings/about

**Files:**
- Create: `apps/web/app/(shell)/settings/about/page.tsx`
- Delete: `apps/web/components/screens/settings-screen.tsx` (or rename to `about-screen.tsx`)

- [ ] **Step 1: Rename the old screen component**

```bash
git mv apps/web/components/screens/settings-screen.tsx apps/web/components/screens/settings-about-screen.tsx
```

In the moved file, rename the export `SettingsScreen` → `SettingsAboutScreen`.

- [ ] **Step 2: Create the about page**

`apps/web/app/(shell)/settings/about/page.tsx`:

```typescript
import { SettingsAboutScreen } from "../../../../components/screens/settings-about-screen";

export default function SettingsAboutPage() {
  return <SettingsAboutScreen />;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/(shell)/settings/about apps/web/components/screens
git commit -m "refactor(web): move legacy settings content to /settings/about"
```

### Task 2.4: Add contracts schema for company settings

**Files:**
- Create: `packages/contracts/src/settings.ts`
- Modify: `packages/contracts/src/index.ts` (export new schemas)

- [ ] **Step 1: Define Zod schemas**

`packages/contracts/src/settings.ts`:

```typescript
import { z } from "zod";

export const companySettingsSchema = z.object({
  organizationId: z.string(),
  organizationName: z.string().min(1, "Organization name is required").max(200),
  organizationNumber: z
    .string()
    .regex(/^\d{6}-\d{4}$/, "Swedish org number format is XXXXXX-XXXX"),
  addressLine1: z.string().min(1).max(200),
  addressLine2: z.string().max(200).optional(),
  postalCode: z.string().regex(/^\d{3}\s?\d{2}$/, "Swedish postal code format is XXX XX"),
  city: z.string().min(1).max(100),
  contactEmail: z.string().email(),
  contactPhone: z.string().max(50).optional(),
  bankIban: z.string().max(34).optional(),
  bankBic: z.string().max(11).optional(),
});

export type CompanySettings = z.infer<typeof companySettingsSchema>;
```

- [ ] **Step 2: Export from index**

Append to `packages/contracts/src/index.ts`:

```typescript
export * from "./settings.js";
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): add company settings schema"
```

### Task 2.5: Add API route to read/write company settings

**Files:**
- Modify: `services/api/src/app.ts`
- Modify: `packages/domain/src/store.ts` (extend with company settings storage)
- Modify: `packages/domain/src/store.ts` (also contains the `LedgerStore` interface) (extend interface)

- [ ] **Step 1: Extend LedgerStore interface**

In `packages/domain/src/store.ts` (also contains the `LedgerStore` interface), add to the interface:

```typescript
getCompanySettings(): Promise<CompanySettings | null>;
saveCompanySettings(input: CompanySettings): Promise<CompanySettings>;
```

Import `CompanySettings` from `@jpx-accounting/contracts`.

- [ ] **Step 2: Implement in MemoryLedgerStore**

In `packages/domain/src/store.ts`, add a private field and methods:

```typescript
private companySettings: CompanySettings = {
  organizationId: "org_jpx",
  organizationName: "JPX Demo AB",
  organizationNumber: "556677-8899",
  addressLine1: "Kungsgatan 1",
  postalCode: "111 22",
  city: "Stockholm",
  contactEmail: "hello@example.com",
};

async getCompanySettings() {
  return this.companySettings;
}

async saveCompanySettings(input: CompanySettings) {
  this.companySettings = input;
  return this.companySettings;
}
```

- [ ] **Step 3: Add UnavailableLedgerStore stubs**

In `services/api/src/runtime.ts` (search for `UnavailableLedgerStore`), add the same two methods, throwing `LedgerStoreUnavailableError`.

- [ ] **Step 4: Add Hono routes**

In `services/api/src/app.ts`, after the existing settings-adjacent routes (~line 220), add:

```typescript
app.get("/api/settings/company", async (context) =>
  context.json(await currentStore.getCompanySettings()),
);

app.put("/api/settings/company", async (context) => {
  const input = await parseBody(context.req.raw, companySettingsSchema);
  return context.json(await currentStore.saveCompanySettings(input));
});
```

Import `companySettingsSchema` from `@jpx-accounting/contracts` at the top of the file.

- [ ] **Step 5: Add api-client methods**

In `packages/api-client/src/index.ts` (find the existing client class), add:

```typescript
async getCompanySettings(): Promise<CompanySettings> {
  return this.request("/api/settings/company", { method: "GET" });
}

async saveCompanySettings(input: CompanySettings): Promise<CompanySettings> {
  return this.request("/api/settings/company", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}
```

For the demo-mode in-memory fallback path, also wire to the local `MemoryLedgerStore` instance.

- [ ] **Step 6: Run typecheck**

```bash
pnpm typecheck
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add services/api packages/domain packages/api-client
git commit -m "feat(api): company settings GET/PUT endpoints"
```

### Task 2.6: Build Company settings page with form

**Files:**
- Create: `apps/web/app/(shell)/settings/company/page.tsx`
- Create: `apps/web/components/settings/company-form.tsx`
- Test: `tests/e2e/settings.spec.ts`

- [ ] **Step 1: Build the form component**

`apps/web/components/settings/company-form.tsx`:

```typescript
"use client";

import { companySettingsSchema, type CompanySettings } from "@jpx-accounting/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { apiClient } from "../../lib/client";
import { Button } from "../ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "../ui/form";
import { Input } from "../ui/input";
import { ScreenSkeleton } from "../ui/skeleton";

export function CompanyForm() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["company-settings"],
    queryFn: () => apiClient.getCompanySettings(),
  });

  const form = useForm<CompanySettings>({
    resolver: zodResolver(companySettingsSchema),
    values: settingsQuery.data,
  });

  const mutation = useMutation({
    mutationFn: (input: CompanySettings) => apiClient.saveCompanySettings(input),
    onSuccess: (saved) => {
      queryClient.setQueryData(["company-settings"], saved);
      toast.success("Company settings saved.");
    },
    onError: () => {
      toast.error("Could not save company settings.");
    },
  });

  if (!settingsQuery.data) return <ScreenSkeleton />;

  return (
    <Form {...form}>
      <form
        data-testid="company-form"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        className="space-y-6"
      >
        <FormField
          control={form.control}
          name="organizationName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Organization name</FormLabel>
              <FormControl><Input {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="organizationNumber"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Organization number</FormLabel>
              <FormControl><Input placeholder="556677-8899" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="addressLine1"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Address</FormLabel>
              <FormControl><Input {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="postalCode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Postal code</FormLabel>
                <FormControl><Input placeholder="111 22" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="city"
            render={({ field }) => (
              <FormItem>
                <FormLabel>City</FormLabel>
                <FormControl><Input {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="contactEmail"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Contact email</FormLabel>
              <FormControl><Input type="email" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={mutation.isPending} data-testid="company-form-submit">
          {mutation.isPending ? "Saving…" : "Save company"}
        </Button>
      </form>
    </Form>
  );
}
```

- [ ] **Step 2: Build the page**

`apps/web/app/(shell)/settings/company/page.tsx`:

```typescript
import { ScreenHeader } from "../../../../components/ui/screen-header";
import { CompanyForm } from "../../../../components/settings/company-form";

export default function CompanySettingsPage() {
  return (
    <div className="space-y-6">
      <ScreenHeader
        eyebrow="Settings / Company"
        title="Your organization details."
        description="Used on invoices, exports, and Skatteverket filings. Changes are versioned in the audit spine."
      />
      <div className="glass-panel rounded-xl p-5">
        <CompanyForm />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write E2E test**

Create `tests/e2e/settings.spec.ts`:

```typescript
import { expect, test } from "@playwright/test";

test("settings redirect lands on company sub-page", async ({ page }) => {
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings\/company$/);
  await expect(page.getByTestId("settings-sidebar")).toBeVisible();
  await expect(page.getByTestId("company-form")).toBeVisible();
});

// Also tighten the five-tabs test in navigation-and-share.spec.ts now that
// /settings/company exists — change the loose `/settings/` URL assertion
// (introduced in Task 1.6 as a workaround) to the canonical `/settings/company`
// match. Per the no-legacy-code rule, fix the workaround when its underlying
// blocker is resolved.

test("company form persists name change", async ({ page }) => {
  await page.goto("/settings/company");
  const input = page.getByLabel("Organization name");
  await input.fill("New Test Name AB");
  await page.getByTestId("company-form-submit").click();
  await expect(page.getByText("Company settings saved")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Organization name")).toHaveValue("New Test Name AB");
});

test("about page shows legacy posture content", async ({ page }) => {
  await page.goto("/settings/about");
  await expect(page.getByText(/runtime posture/i)).toBeVisible();
});
```

- [ ] **Step 4: Run E2E**

```bash
pnpm build && pnpm test:e2e -- tests/e2e/settings.spec.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web tests/e2e/settings.spec.ts
git commit -m "feat(web): settings/company page with persistence"
```

### Task 2.7: Stub remaining settings sub-pages

**Files:**
- Create one page each: `fiscal-year/`, `integrations/`, `team/`, `ai-posture/`, `retention/`, `compliance/`

- [ ] **Step 1: Create stub pages**

For each section (`fiscal-year`, `integrations`, `team`, `ai-posture`, `retention`, `compliance`), create `apps/web/app/(shell)/settings/<section>/page.tsx`:

```typescript
import { ScreenHeader } from "../../../../components/ui/screen-header";

export default function SectionPage() {
  return (
    <div className="space-y-6">
      <ScreenHeader
        eyebrow="Settings"
        title="<Section title>"
        description="This section is scaffolded. Full implementation lands in Phase 8."
      />
    </div>
  );
}
```

Replace `<Section title>` with the corresponding label from the sidebar config.

- [ ] **Step 2: Verify sub-nav navigates to all stubs**

```bash
pnpm build && pnpm test:e2e -- tests/e2e/settings.spec.ts
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/(shell)/settings
git commit -m "feat(web): scaffold remaining settings sub-pages"
```

### Phase 2 acceptance check

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test:e2e` passes including new settings spec
- [ ] Manual: visit `/settings` → redirected to `/settings/company`
- [ ] Manual: edit company name, save, reload → persists
- [ ] Manual: navigate to `/settings/about` → see old runtime/deployment/audit content
- [ ] Manual: settings sub-nav visible on desktop, accessible on mobile
- [ ] Manual: navigating between settings sub-pages preserves the dock's "Settings" active state

---

## Phase 3 — Books page with tabs, periods, drill-through

**Goal:** Split today's Reports page. The journal+trial-balance halves move into Books with new general-ledger and supplier views, period scope, and drill-through. Reports keeps the VAT half and gains a charts skeleton (real P&L / BS land in Phase 7).

**Estimated effort:** 2–3 days.

### Task 3.1: Install table primitives

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Install TanStack Table and shadcn table**

```bash
pnpm --filter @jpx-accounting/web add @tanstack/react-table@^8
pnpm --filter @jpx-accounting/web exec shadcn@latest add table tabs
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/package.json apps/web/components/ui pnpm-lock.yaml
git commit -m "chore(web): add tanstack-table and shadcn table/tabs primitives"
```

### Task 3.2: Build period scope hook

**Files:**
- Create: `apps/web/hooks/use-period-scope.ts`
- Create: `apps/web/components/books/period-selector.tsx`

- [ ] **Step 1: Hook for URL-driven period state**

`apps/web/hooks/use-period-scope.ts`:

```typescript
"use client";

import { parseAsString, useQueryState } from "nuqs";
import { useMemo } from "react";

export type Period = { start: string; end: string; label: string };

function currentMonthIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function usePeriodScope() {
  const [period, setPeriod] = useQueryState("period", parseAsString.withDefault(currentMonthIso()));

  const parsed = useMemo<Period>(() => {
    const [year, month] = period.split("-").map(Number);
    if (!year || !month) return { start: "", end: "", label: period };
    const start = new Date(year, month - 1, 1).toISOString().slice(0, 10);
    const end = new Date(year, month, 0).toISOString().slice(0, 10);
    const label = new Date(year, month - 1, 1).toLocaleDateString("sv-SE", { year: "numeric", month: "long" });
    return { start, end, label };
  }, [period]);

  return { period: parsed, setPeriod, raw: period };
}
```

- [ ] **Step 2: Selector component**

`apps/web/components/books/period-selector.tsx`:

```typescript
"use client";

import { usePeriodScope } from "../../hooks/use-period-scope";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

function lastTwelveMonths() {
  const months: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("sv-SE", { year: "numeric", month: "long" });
    months.push({ value, label });
  }
  return months;
}

export function PeriodSelector() {
  const { raw, setPeriod } = usePeriodScope();
  const options = lastTwelveMonths();
  return (
    <Select value={raw} onValueChange={(value) => setPeriod(value)}>
      <SelectTrigger data-testid="period-selector" className="w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 3: Add nuqs provider**

In `apps/web/app/layout.tsx`, wrap the existing tree with `NuqsAdapter`:

```typescript
import { NuqsAdapter } from "nuqs/adapters/next/app";
// ...
<NuqsAdapter>{children}</NuqsAdapter>
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/hooks apps/web/components/books apps/web/app/layout.tsx
git commit -m "feat(web): period scope hook and selector with nuqs URL state"
```

### Task 3.3: Build BooksScreen with tab dispatch

**Files:**
- Create: `apps/web/components/screens/books-screen.tsx`
- Modify: `apps/web/app/(shell)/books/page.tsx`

- [ ] **Step 1: Build the screen**

`apps/web/components/screens/books-screen.tsx`:

```typescript
"use client";

import { parseAsStringEnum, useQueryState } from "nuqs";

import { PeriodSelector } from "../books/period-selector";
import { ScreenHeader } from "../ui/screen-header";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { JournalView } from "../books/journal-view";
import { GeneralLedgerView } from "../books/general-ledger-view";
import { TrialBalanceView } from "../books/trial-balance-view";
import { SuppliersView } from "../books/suppliers-view";
import { CloseView } from "../books/close-view";

const views = ["journal", "general-ledger", "trial-balance", "suppliers", "close"] as const;
type View = (typeof views)[number];

export function BooksScreen() {
  const [view, setView] = useQueryState(
    "view",
    parseAsStringEnum<View>([...views]).withDefault("journal"),
  );

  return (
    <div className="page-shell space-y-6">
      <ScreenHeader
        eyebrow="Books"
        title="The ledger, drillable."
        description="Journal, general ledger, trial balance, suppliers, and close — all scoped to a period."
        aside={<PeriodSelector />}
      />
      <Tabs value={view} onValueChange={(v) => setView(v as View)}>
        <TabsList data-testid="books-tabs">
          <TabsTrigger value="journal">Journal</TabsTrigger>
          <TabsTrigger value="general-ledger">General ledger</TabsTrigger>
          <TabsTrigger value="trial-balance">Trial balance</TabsTrigger>
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
          <TabsTrigger value="close">Close</TabsTrigger>
        </TabsList>
      </Tabs>
      <section className="mt-4">
        {view === "journal" ? <JournalView /> : null}
        {view === "general-ledger" ? <GeneralLedgerView /> : null}
        {view === "trial-balance" ? <TrialBalanceView /> : null}
        {view === "suppliers" ? <SuppliersView /> : null}
        {view === "close" ? <CloseView /> : null}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Wire the page**

`apps/web/app/(shell)/books/page.tsx`:

```typescript
import { BooksScreen } from "../../../components/screens/books-screen";

export default function BooksPage() {
  return <BooksScreen />;
}
```

- [ ] **Step 3: Verify typecheck (views will fail until next tasks)**

Skip typecheck here; the next tasks add the view components.

### Task 3.4: Build each Books view component

**Files:** Create one component per view.

- [ ] **Step 1: Journal view**

`apps/web/components/books/journal-view.tsx`:

```typescript
"use client";

import { useQuery } from "@tanstack/react-query";

import { apiClient } from "../../lib/client";
import { usePeriodScope } from "../../hooks/use-period-scope";
import { formatMoney } from "../../lib/presentation";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

export function JournalView() {
  const { period } = usePeriodScope();
  const { data } = useQuery({
    queryKey: ["workspace"],
    queryFn: () => apiClient.getSnapshot(),
  });

  const entries = (data?.reports.journal ?? []).filter((entry) => {
    if (!period.start || !period.end) return true;
    const date = entry.bookedAt.slice(0, 10);
    return date >= period.start && date <= period.end;
  });

  return (
    <div className="glass-panel rounded-xl p-5" data-testid="journal-view">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Voucher</TableHead>
            <TableHead>Account</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Debit</TableHead>
            <TableHead className="text-right">Credit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={`${entry.voucherId}-${entry.accountNumber}`}>
              <TableCell>{entry.bookedAt.slice(0, 10)}</TableCell>
              <TableCell className="text-mono">{entry.voucherId}</TableCell>
              <TableCell>{entry.accountNumber} {entry.accountName}</TableCell>
              <TableCell>{entry.description}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(entry.debit)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(entry.credit)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 2: General ledger view**

`apps/web/components/books/general-ledger-view.tsx`: groups journal entries by `accountNumber`, renders one collapsible section per account using `<details><summary>` showing running balance and per-transaction rows.

```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { apiClient } from "../../lib/client";
import { usePeriodScope } from "../../hooks/use-period-scope";
import { formatMoney } from "../../lib/presentation";
import { SectionLabel } from "../ui/section-label";

export function GeneralLedgerView() {
  const { period } = usePeriodScope();
  const { data } = useQuery({ queryKey: ["workspace"], queryFn: () => apiClient.getSnapshot() });

  const grouped = useMemo(() => {
    const journal = (data?.reports.journal ?? []).filter((entry) => {
      if (!period.start || !period.end) return true;
      const date = entry.bookedAt.slice(0, 10);
      return date >= period.start && date <= period.end;
    });
    const map = new Map<string, typeof journal>();
    for (const entry of journal) {
      const list = map.get(entry.accountNumber) ?? [];
      list.push(entry);
      map.set(entry.accountNumber, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [data, period]);

  return (
    <div className="space-y-3" data-testid="general-ledger-view">
      {grouped.map(([accountNumber, entries]) => {
        const debit = entries.reduce((sum, e) => sum + e.debit, 0);
        const credit = entries.reduce((sum, e) => sum + e.credit, 0);
        const accountName = entries[0]?.accountName ?? "";
        return (
          <details key={accountNumber} className="glass-panel rounded-lg p-4">
            <summary className="flex cursor-pointer items-center justify-between gap-4">
              <span>
                <SectionLabel>{accountNumber}</SectionLabel>
                <p className="text-sm font-semibold">{accountName}</p>
              </span>
              <span className="text-sm tabular-nums">Net {formatMoney(debit - credit)}</span>
            </summary>
            <ul className="mt-4 space-y-2 text-sm">
              {entries.map((entry) => (
                <li key={`${entry.voucherId}-${entry.bookedAt}`} className="flex justify-between gap-3">
                  <span>{entry.bookedAt.slice(0, 10)} · {entry.description}</span>
                  <span className="tabular-nums">{formatMoney(entry.debit - entry.credit)}</span>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Trial balance view**

`apps/web/components/books/trial-balance-view.tsx`: lifts the existing trial-balance code block from the old reports-screen (lines 80–111 of `apps/web/components/screens/reports-screen.tsx`) into its own component. Each row becomes a button that calls `setView("general-ledger")` and adds `?account=` URL state via nuqs.

- [ ] **Step 4: Suppliers view**

`apps/web/components/books/suppliers-view.tsx`: iterates `data.vouchers`, groups by `voucherFields.supplierName`, renders one row per supplier with total spent and a button to drill into the journal filtered by supplier.

- [ ] **Step 5: Close view**

`apps/web/components/books/close-view.tsx`: lifts the existing close-copilot block from the old `home-screen.tsx` (lines 320–338) into its own component. Add a "Refresh close run" button calling `POST /api/close-runs`.

- [ ] **Step 6: Run typecheck and E2E**

```bash
pnpm typecheck
pnpm build && pnpm test:e2e
```

Expected: pass. Update any tests that relied on close-copilot or trial-balance being on `/today`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/books apps/web/components/screens/books-screen.tsx apps/web/app/(shell)/books
git commit -m "feat(web): books page with tab dispatch and period scope"
```

### Task 3.5: Clean up old reports/today references

**Files:**
- Modify: `apps/web/components/screens/today-screen.tsx`
- Modify: `apps/web/components/screens/reports-screen.tsx`

- [ ] **Step 1: Remove balance pulse, close copilot, alerts from TodayScreen**

In `apps/web/components/screens/today-screen.tsx`, delete the right `<aside>` block (lines 319–373 of the old file). The page becomes the review queue only (Phase 4 will add per-card actions and filters).

- [ ] **Step 2: Rewrite ReportsScreen to keep only VAT, plus chart stubs**

For now, rewrite `apps/web/components/screens/reports-screen.tsx` to a single VAT view + Tabs scaffold (P&L / BS / VAT / Exports). P&L and BS tabs render "Coming in Phase 7" placeholders. Exports tab links to `GET /api/exports/sie` for SIE download.

- [ ] **Step 3: Update existing E2E tests**

In `tests/e2e/reports.spec.ts`, remove assertions for journal-summary / trial-balance (they live in `tests/e2e/books.spec.ts` now). Keep VAT assertions.

- [ ] **Step 4: Add books E2E**

Create `tests/e2e/books.spec.ts`:

```typescript
import { expect, test } from "@playwright/test";

test("books default view is journal", async ({ page }) => {
  await page.goto("/books");
  await expect(page).toHaveURL(/\/books/);
  await expect(page.getByTestId("books-tabs")).toBeVisible();
  await expect(page.getByTestId("journal-view")).toBeVisible();
});

test("books period selector changes URL", async ({ page }) => {
  await page.goto("/books");
  await page.getByTestId("period-selector").click();
  const option = page.getByRole("option").first();
  await option.click();
  await expect(page).toHaveURL(/period=/);
});

test("trial balance row drills to general ledger", async ({ page }) => {
  await page.goto("/books?view=trial-balance");
  await page.getByRole("button", { name: /6540|6071/ }).first().click();
  await expect(page).toHaveURL(/view=general-ledger/);
});
```

- [ ] **Step 5: Run all E2E**

```bash
pnpm build && pnpm test:e2e
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web tests/e2e
git commit -m "refactor(web): move journal/trial-balance/close into Books; reports keeps VAT + scaffolds P&L/BS"
```

### Phase 3 acceptance check

- [ ] Today page only shows the review queue (no balance pulse / close / alerts sidebar)
- [ ] Books shows journal/GL/trial-balance/suppliers/close tabs with shared period scope
- [ ] Period selector persists via URL `?period=`
- [ ] Trial balance row click drills to General Ledger filtered to that account
- [ ] Reports shows only VAT (other tabs are scaffolds with download SIE link working)
- [ ] All E2E tests pass

---

## Phase 4 — Today page: per-card actions, keyboard flow, filters

**Goal:** Make the review queue feel like Linear / Ramp. Per-card accept/reject/edit, full keyboard navigation, filters with URL state.

**Estimated effort:** 2 days.

### Task 4.1: Add keyboard hook and primitives

**Files:**
- Create: `apps/web/hooks/use-review-keyboard.ts`
- Create: `apps/web/components/ui/kbd.tsx` (small custom component for keyboard hint pills)
- Modify: `apps/web/package.json` (react-hotkeys-hook already installed in Phase 1)

- [ ] **Step 1: Build `kbd.tsx`**

```typescript
import type { ReactNode } from "react";

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[var(--color-text-muted)]">
      {children}
    </kbd>
  );
}
```

- [ ] **Step 2: Build `use-review-keyboard.ts`**

Hook that takes `{ reviews, focusedId, onFocus, onAccept, onReject, onEdit, onBookWithoutVat }` and wires `j/k/y/n/e/b` via `react-hotkeys-hook`. Scoped to skip when an `<input>` / `<textarea>` is focused.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/ui/kbd.tsx apps/web/hooks/use-review-keyboard.ts
git commit -m "feat(web): keyboard hook and kbd primitive for review queue"
```

### Task 4.2: Add per-card actions

**Files:**
- Modify: `apps/web/components/screens/today-screen.tsx`
- Create: `apps/web/components/today/review-card-actions.tsx`

- [ ] **Step 1: Split review card into its own component**

Move the review card JSX from `today-screen.tsx` into `apps/web/components/today/review-card.tsx`. The screen now maps over reviews and renders `<ReviewCard review={review} onAccept onReject onEdit onBookWithoutVat focused />`.

- [ ] **Step 2: Build action toolbar**

`apps/web/components/today/review-card-actions.tsx`:

```typescript
"use client";

import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";

type Props = {
  onAccept: () => void;
  onReject: () => void;
  onEdit: () => void;
  onBookWithoutVat: () => void;
  disabled: boolean;
};

export function ReviewCardActions({ onAccept, onReject, onEdit, onBookWithoutVat, disabled }: Props) {
  return (
    <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Review actions">
      <Button onClick={onAccept} disabled={disabled} data-testid="review-accept">
        Accept <Kbd>Y</Kbd>
      </Button>
      <Button variant="secondary" onClick={onEdit} disabled={disabled} data-testid="review-edit">
        Edit <Kbd>E</Kbd>
      </Button>
      <Button variant="ghost" onClick={onBookWithoutVat} disabled={disabled} data-testid="review-book-without-vat">
        Book w/o VAT <Kbd>B</Kbd>
      </Button>
      <Button variant="destructive" onClick={onReject} disabled={disabled} data-testid="review-reject">
        Reject <Kbd>N</Kbd>
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Wire mutations in screen**

In `today-screen.tsx`, add `useMutation` for reject and book-without-vat (the existing snapshot already has approve mutation). Use optimistic updates on the workspace query cache.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/today apps/web/components/screens/today-screen.tsx
git commit -m "feat(web): per-card review actions on Today"
```

### Task 4.3: Add filters with URL state

**Files:**
- Create: `apps/web/components/today/review-filters.tsx`
- Modify: `apps/web/components/screens/today-screen.tsx`

- [ ] **Step 1: Filter component**

`apps/web/components/today/review-filters.tsx` uses `nuqs` for `status` (enum), `supplier` (string), `confidence` (enum). Renders `ToggleGroup` for status, `Input` for supplier search, `Select` for confidence band.

Install missing primitives:

```bash
pnpm --filter @jpx-accounting/web exec shadcn@latest add toggle-group
```

- [ ] **Step 2: Filter logic in screen**

Filter the `reviews` array client-side based on URL state. Empty state shows "No reviews match these filters" with a "Clear filters" button.

- [ ] **Step 3: E2E**

Add to `tests/e2e/today.spec.ts`:

```typescript
test("status filter narrows queue", async ({ page }) => {
  await page.goto("/today");
  await page.getByRole("button", { name: /blocked/i }).click();
  await expect(page).toHaveURL(/status=blocked/);
});
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/today apps/web/components/screens/today-screen.tsx tests/e2e/today.spec.ts
git commit -m "feat(web): URL-driven filters on Today"
```

### Phase 4 acceptance check

- [ ] Each review card has Accept / Edit / Book-w/o-VAT / Reject buttons with keyboard hint pills
- [ ] Pressing `y` accepts the focused card; `n` rejects; `e` opens edit; `b` books w/o VAT
- [ ] `j` and `k` move focus; `?` opens cheat sheet
- [ ] Status filter, supplier search, confidence band update URL params
- [ ] E2E tests pass

---

## Phase 5 — Capture page: drafts and evidence archive

**Goal:** Make Capture a real page (today it's only the modal sheet). Show local drafts, allow promoting them, and render an evidence archive with hash chain.

**Estimated effort:** 1.5 days.

### Task 5.1: Lift quick-add tiles into the page

- [ ] **Step 1: Build `quick-add-grid.tsx`** rendering 4 large tiles (camera, upload, paste, share) that call the same `saveCaptureDraft` from `lib/draft-queue` the modal already uses, plus a fifth tile "Import SIE file" (input[type=file] posting to `/api/imports/sie`).
- [ ] **Step 2: Build `capture-screen.tsx`** that composes `<QuickAddGrid />`, `<DraftsTable />`, `<EvidenceArchiveTable />`.
- [ ] **Step 3: Commit.**

### Task 5.2: Drafts table from IndexedDB

- [ ] **Step 1: Extend `draft-queue.ts`** to expose a `listDrafts()` function that reads all drafts from IndexedDB (the current core file has the write path but not a list path).
- [ ] **Step 2: Build `drafts-table.tsx`** using `<Table>` (shadcn). Each row: thumbnail (or icon), mode, created-at, storage tier badge, "Promote to ledger" button that calls `apiClient.createEvidence` and then deletes the local draft.
- [ ] **Step 3: Commit.**

### Task 5.3: Evidence archive table

- [ ] **Step 1: Use TanStack Table** for sorting / pagination / filtering of `data.evidence` from the workspace snapshot.
- [ ] **Step 2: Each row shows** title, mime type, hash (first 8 chars with copy button), uploaded-at, voucher status badge.
- [ ] **Step 3: Drill-through** — clicking a row navigates to `/capture/evidence/[id]` (a basic detail page rendering all packet info + hash chain + provenance).
- [ ] **Step 4: E2E** add `tests/e2e/capture.spec.ts` asserting page loads, drafts section visible, archive section visible, can navigate to detail.
- [ ] **Step 5: Commit.**

### Phase 5 acceptance check

- [ ] `/capture` shows quick-add, drafts, and evidence archive
- [ ] A captured draft from the modal appears in the drafts table; promoting it creates evidence
- [ ] Clicking an evidence row navigates to detail with hash visible
- [ ] E2E tests pass

---

## Phase 6 — Global Advisor Cmd-K palette

**Goal:** Add the global keyboard-shortcut palette that combines navigation, AI Q&A, knowledge lookup, and simulations.

**Estimated effort:** 2 days.

### Task 6.1: Install command primitive

```bash
pnpm --filter @jpx-accounting/web add cmdk@^1
pnpm --filter @jpx-accounting/web exec shadcn@latest add command
```

### Task 6.2: Build the palette

- [ ] **Step 1:** Create `apps/web/components/advisor/advisor-palette.tsx` — a `<CommandDialog>` open via `⌘K`. The dialog tracks mode (`nav` / `ask` / `lookup` / `simulate`) based on input prefix (`/`, `?`, `sim:`).
- [ ] **Step 2:** Provide a context provider `AdvisorPaletteProvider` at the app root in `apps/web/app/layout.tsx` so any page can `useAdvisor()` to open it.
- [ ] **Step 3:** Wire `?advisor=open` URL param (the legacy `/assistant` redirect) to auto-open the palette on mount.
- [ ] **Step 4:** Add a small "Ask" button in the top-bar that opens the palette (visible discoverability).

### Task 6.3: Mode handlers

- [ ] **Step 1:** Nav mode — list every primary route + key actions ("Approve next review", "Go to Books → Suppliers", "Mark VAT filed for period"). Selecting an action calls a registry function.
- [ ] **Step 2:** Ask mode — submits to `POST /api/assistant/sessions`, streams response into the palette body with citation chips.
- [ ] **Step 3:** Lookup mode — `/policy <query>` → `POST /mcp { tool: "lookup_policy" }`. Render structured result.
- [ ] **Step 4:** Simulate mode — `sim: <description>` → `POST /api/simulations/run`. Render proposed ledger lines.

### Task 6.4: E2E

```typescript
test("cmd-k opens advisor palette", async ({ page }) => {
  await page.goto("/today");
  await page.keyboard.press("Meta+k");
  await expect(page.getByTestId("advisor-palette")).toBeVisible();
});
```

### Phase 6 acceptance check

- [ ] `⌘K` opens palette from any page
- [ ] Typing `/policy vat` returns policy lookup result
- [ ] Typing `?` switches to Ask mode and streams an answer with citations
- [ ] Legacy `/assistant` URL still works (now redirects and opens palette)

---

## Phase 7 — P&L, Balance Sheet, charts, real exports

**Goal:** Make Reports a real statutory reports surface. Add P&L (Resultaträkning), Balance Sheet (Balansräkning), period-aware VAT return with filing state, and real PDF / SIE / CSV exports.

**Estimated effort:** 3 days.

### Task 7.1: Add chart primitives

```bash
pnpm --filter @jpx-accounting/web add recharts@^2
pnpm --filter @jpx-accounting/web exec shadcn@latest add chart
```

### Task 7.2: Reporting projections

- [ ] **Step 1:** `packages/reporting/src/profit-loss.ts` — given a period and the full journal, returns `{ revenue: {account, amount}[], expenses: {account, amount}[], operatingResult, net }`. Use BAS account ranges (3xxx revenue, 4xxx-7xxx expenses) per Swedish convention.
- [ ] **Step 2:** `packages/reporting/src/balance-sheet.ts` — returns `{ assets: …, equityAndLiabilities: … }` grouped by BAS class.
- [ ] **Step 3:** `packages/reporting/src/vat-return.ts` — returns Skatteverket box-by-box VAT return (boxes 05–48 with row-to-journal reconciliation).
- [ ] **Step 4:** Unit tests in `tests/unit/` for each projection with a fixture journal.

### Task 7.3: Chart components

- [ ] **Step 1:** `apps/web/components/reports/charts/pl-stacked-bar.tsx` — stacked bar of expense categories by month using `recharts` via shadcn `<ChartContainer>`.
- [ ] **Step 2:** `apps/web/components/reports/charts/bs-area.tsx` — area chart of assets vs liabilities+equity over the last 12 months.
- [ ] **Step 3:** `apps/web/components/reports/charts/vat-bar.tsx` — bar of VAT collected vs deductible per period.

### Task 7.4: VAT filing state

- [ ] **Step 1:** Add `vat-period-filed` event type to `packages/contracts/src/events.ts`. Extend `applyLedgerEvent` to track filed periods.
- [ ] **Step 2:** Add `POST /api/vat/periods/:period/file` route that emits the event and returns the updated VAT return.
- [ ] **Step 3:** UI: "Mark period as filed" button on VAT view. Once filed, render the period read-only with a "Filed by X on Y" provenance line.

### Task 7.5: Real exports

- [ ] **Step 1:** Move SIE export button to `/reports?view=exports`. The button hits `GET /api/exports/sie` with `?period=` and downloads.
- [ ] **Step 2:** CSV export — client-side serialize current Books view to CSV with `sv-SE` locale formatting.
- [ ] **Step 3:** PDF export — dynamic `import("@react-pdf/renderer")` on click. Render P&L and BS as PDF using brand colors.

### Phase 7 acceptance check

- [ ] Reports shows P&L, BS, VAT, Exports tabs with charts
- [ ] Period scope is shared with Books and persists in URL
- [ ] Marking VAT period filed records an event visible in audit timeline
- [ ] SIE download contains entries for the selected period
- [ ] PDF export downloads a styled P&L

---

## Phase 8 — Remaining settings + simulations + integrations placeholders

**Goal:** Fill out the remaining Settings sub-pages with real (if scaffolded) UI and surface simulations as a Books sub-tab.

**Estimated effort:** 2 days.

### Task 8.1: Fiscal year & VAT settings

- [ ] **Step 1:** Extend `companySettingsSchema` with `fiscalYearStartMonth: z.number().min(1).max(12)` and `vatReportingPeriod: z.enum(["monthly", "quarterly", "annually"])`. Or split into a new `fiscalYearSettingsSchema`.
- [ ] **Step 2:** Build the form in `apps/web/components/settings/fiscal-year-form.tsx` with `RadioGroup` for VAT cadence and `Select` for start month.
- [ ] **Step 3:** Add `GET/PUT /api/settings/fiscal-year` routes.

### Task 8.2: AI posture settings

- [ ] **Step 1:** Schema `aiPostureSchema { autoApproveConfidence: number, surfacesEnabled: { advisor: bool, inline: bool, ambient: bool }, killSwitch: bool }`.
- [ ] **Step 2:** Form with `Switch` and `Slider` (install slider primitive).
- [ ] **Step 3:** Persist via API; the values are read by `aiRuntime` factory in normal mode.

### Task 8.3: Team & roles (display-only)

- [ ] **Step 1:** Render team table from `closeRun.assignees` or a new `team` snapshot field.
- [ ] **Step 2:** "Invite member" button opens a dialog that posts to `POST /api/team/invitations`. Endpoint returns a stub for now; mark as "Coming soon".

### Task 8.4: Integrations placeholders

- [ ] **Step 1:** List of integration cards: Bank feeds, Skatteverket, Accountant access. Each card shows "Not connected" with a "Connect" button that opens a dialog explaining "Integration available in Q3 2026" and links to a roadmap doc.

### Task 8.5: Retention controls

- [ ] **Step 1:** Show baseline "7-year retention per Bokföringslagen" as a read-only banner.
- [ ] **Step 2:** Table of voucher classes with a toggle for "Legal hold". Persist as `LedgerEvent` of type `retention-policy-updated`.

### Task 8.6: Compliance watch

- [ ] **Step 1:** List subscribed rule sources (Skatteverket, BFN, BAS).
- [ ] **Step 2:** Alert history table from `data.alerts` with detail drawer.
- [ ] **Step 3:** "Refresh compliance watch" button calling `POST /api/compliance-watch/refresh`.

### Task 8.7: Simulations under Books

- [ ] **Step 1:** Add Books sub-tab `simulate` (`/books?view=simulate`).
- [ ] **Step 2:** Form: free-text description + voucher selector. Submit posts to `/api/simulations/run` and renders the proposed ledger lines vs current state with diff highlighting.

### Phase 8 acceptance check

- [ ] Every Settings sub-page renders real content or a clearly-marked roadmap card
- [ ] Fiscal year and AI posture changes persist
- [ ] Compliance watch refresh button works
- [ ] Simulations sub-tab in Books runs a simulation and shows proposed entries

---

## Cross-phase chores

After every phase, run:

```bash
pnpm typecheck && pnpm build && pnpm test:unit && pnpm test:e2e
```

If `pnpm test:e2e:headed` shows visible glitches, capture screenshots and address before merging.

After Phase 4 (when keyboard navigation lands), add axe-core assertions for keyboard-only navigation to `tests/e2e/today.spec.ts` per the EAA mandate.

---

## Backout

If a phase causes regressions, revert by rolling back its commits (each phase ends in commits that are independently revertable). The redirects in `middleware.ts` mean rolling back later phases doesn't require restoring `/` or `/assistant` routes — old URLs continue to land on whatever `/today`, `/settings/*`, etc. exist at the time.

---

## Self-review summary

- **Spec coverage:** Every section of `2026-05-13-ia-restructure-design.md` maps to one or more tasks above (5 tabs → Phase 1, ambient digest → Phase 1, Settings sub-pages → Phase 2 + 8, Books drill-through → Phase 3, Today keyboard flow → Phase 4, Capture → Phase 5, Cmd-K palette → Phase 6, P&L/BS/exports → Phase 7).
- **No placeholders:** Tasks reference exact files, exact commands, and runnable code. Stub pages in Phases 1–2 are intentionally minimal but contain working code.
- **Type consistency:** `CompanySettings` (Phase 2), `Period` (Phase 3), `View` (Phase 3) names are used consistently across tasks.
- **Open question (label "Today" vs "Inbox") is unresolved** — Task 1.6 ships "Today"; if the user prefers "Inbox", change the single `label` string and the corresponding test grep.
