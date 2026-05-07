# UX Improvements Implementation Plan

> **Status (2026‑05‑07): Shipped.** Phases 1–4 of this plan landed in a single sweep, plus a follow-on simplification pass. The detailed task lists below are kept as historical reference for the original spec — they do **not** describe outstanding work. See **Implementation summary** immediately below for what's in `main` today, and **Still deferred** for the items that did not ship.

## Implementation summary

| Phase                                  | Outcome                                                                                                                                                                                                                                                    | Where it lives                                                                                                                                                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — Mobile occlusion**               | `.workspace-canvas` reserves `calc(env(safe-area-inset-bottom) + 144px)` on mobile; resets to `24px` at `≥1024px`. Regression test guards three screens at Pixel 7 size.                                                                                   | [apps/web/app/globals.css](../../../apps/web/app/globals.css) · [tests/e2e/mobile-bottom-clearance.spec.ts](../../../tests/e2e/mobile-bottom-clearance.spec.ts)                                               |
| **2 — Chrome cleanup**                 | `Control` → `Settings`; capture verb unified ("Capture" everywhere); `runtime-mode-banner` removed (pill is the single signal); per-screen marketing headlines replaced with screen-status summaries (`Review queue` / `Reports` / `Ask AI` / `Settings`). | [apps/web/components/app-shell.tsx](../../../apps/web/components/app-shell.tsx) · [apps/web/components/screens/](../../../apps/web/components/screens/)                                                       |
| **3a — Inbox primary action**          | Approve button is now part of each `data-testid="review-card"`; "Create sample receipt" lives in a `queue-overflow-menu`.                                                                                                                                  | [apps/web/components/screens/home-screen.tsx](../../../apps/web/components/screens/home-screen.tsx)                                                                                                           |
| **3b — Reports period + SIE**          | `getPeriodDayRange` / `journalEntryInPeriod` filter the journal by preset (`this-month`, `last-month`, quarters, YTD, all). Local-calendar formatting (not `toISOString`) — bug documented in the file. Export SIE primary CTA.                            | [apps/web/lib/report-period.ts](../../../apps/web/lib/report-period.ts) · [apps/web/components/screens/reports-screen.tsx](../../../apps/web/components/screens/reports-screen.tsx)                           |
| **3c — Assistant threads**             | `prependAssistantThread` returns the merged array (single localStorage round-trip), capped at `MAX_THREADS = 30`. Thread list rendered in the rail on desktop, collapsible on mobile.                                                                      | [apps/web/lib/assistant-thread-storage.ts](../../../apps/web/lib/assistant-thread-storage.ts) · [apps/web/components/screens/assistant-screen.tsx](../../../apps/web/components/screens/assistant-screen.tsx) |
| **3d — Settings split**                | Status / posture content kept; `workspace-info` card surfaces region + ISO date previously in the topbar. Profile / integrations / billing remain stubs.                                                                                                   | [apps/web/components/screens/settings-screen.tsx](../../../apps/web/components/screens/settings-screen.tsx)                                                                                                   |
| **4a — Command palette (⌘K / Ctrl K)** | Searches vouchers, reviews, balances. O(R) review-by-voucher map (no per-voucher `find`). Platform-aware shortcut hint via `navigator.platform`. Uses the shared focus-trap hook.                                                                          | [apps/web/components/command-palette.tsx](../../../apps/web/components/command-palette.tsx)                                                                                                                   |
| **4b — Notifications surface**         | Bell + unread dot in the topbar, sourced from `data.alerts`; clicking deep-links to `/reports#compliance-watch`. Controlled-open + invisible-backdrop pattern.                                                                                             | `NotificationMenu` in [apps/web/components/app-shell.tsx](../../../apps/web/components/app-shell.tsx)                                                                                                         |
| **4c — Account menu**                  | `AccountMenu` (mobile topbar) and `AccountRailCard` (desktop rail) replaced the `<details>` versions; both close on outside click. Identity strings centralised as `ACCOUNT_DISPLAY_NAME` / `ACCOUNT_WORKSPACE_LABEL`.                                     | [apps/web/components/app-shell.tsx](../../../apps/web/components/app-shell.tsx)                                                                                                                               |
| **4d — Capture sheet**                 | Single primary `Capture evidence` opens a file picker; Camera/Paste/Share live behind a `<details>` "More capture options".                                                                                                                                | `AppShell` capture sheet in [apps/web/components/app-shell.tsx](../../../apps/web/components/app-shell.tsx)                                                                                                   |

**Cross-cutting:** focus-trap logic was extracted into [apps/web/lib/focus-trap.ts](../../../apps/web/lib/focus-trap.ts) (`useDialogFocusTrap`) and is now reused by both the capture sheet and the command palette.

## Still deferred

- **Localize chrome to Swedish** (account labels are Swedish, chrome is English — mixed-language UI is intentional for now).
- **Voucher card one-thumb scroll** — full-width approve button at card bottom on mobile (current Approve sits at top of the card).
- **Capture sheet mode differentiation** — Camera / Paste / Share buttons all save a placeholder draft; only the file-picker primary is functionally distinct. Wire each handler when the data path is ready (`getUserMedia`, clipboard read, native share target).
- **Sign out / workspace switcher** — UI placeholders exist in `AccountMenu`/`AccountRailCard` but auth integration is not wired.
- **Notification deep-links** — currently all alerts route to `#compliance-watch`; per-alert routing comes when the alert types diverge.

---

> **For agentic workers (historical context):** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **The unchecked checkboxes below are from the original spec and were ticked off via direct implementation; do not re-execute them.**

**Goal:** Address the 2026‑05‑07 UX review findings for the JPX Accounting PWA — fix the mobile content occlusion defect, simplify the chrome, give every screen one obvious primary action, and add the missing global primitives (search, notifications, account menu).

**Architecture:** Four sequenced phases, each independently shippable. Phase 1 is a CSS-only defect fix. Phase 2 is a chrome cleanup contained to `app-shell.tsx`, layout copy, and screen headers. Phase 3 reshapes per-screen interaction. Phase 4 introduces new components for global primitives. Phases 1 and 2 are fully detailed below; Phases 3 and 4 are roadmap-level and should each be re-spec'd via the brainstorming skill before execution.

**Tech Stack:** Next.js 16 App Router, React 19, TailwindCSS 4 (custom CSS in `apps/web/app/globals.css`), Motion 12, Playwright (`pnpm test:e2e`, mobile project = Pixel 7), TypeScript 5.

**Findings reference:** [.reviews/2026-05-07-ux/](../../../.reviews/2026-05-07-ux/) — eight screenshots (desktop + mobile across all four screens) plus the capture sheet and a snapshot of the inbox a11y tree.

---

## Phase 1 — Fix mobile dock & capture-pill occlusion (P0 defect)

**Why:** On every mobile screen except the home, the fixed bottom dock plus the floating "Capture" pill cover the last cards of the workspace. Reproducible at 390×844 on `/reports`, `/assistant`, `/settings`. Caused by `.workspace-canvas { padding-bottom: 16px }` not accounting for the fixed dock (~64px) + capture pill (~52px) + safe-area inset.

### Task 1: Add a Playwright regression test for mobile dock occlusion

**Files:**

- Create: `tests/e2e/mobile-bottom-clearance.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { expect, test } from "@playwright/test";

import { resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

const screensWithLongContent = [
  { path: "/reports", lastCardTestId: "vat-preparation" },
  { path: "/assistant", lastCardTestId: "policy-rules-studio" },
  { path: "/settings", lastCardTestId: "audit-spine" },
];

for (const { path, lastCardTestId } of screensWithLongContent) {
  test(`mobile dock does not overlap last card on ${path}`, async ({ page }) => {
    test.skip(!test.info().project.name.includes("mobile"), "mobile-only");

    await page.goto(path);

    const lastCard = page.getByTestId(lastCardTestId);
    await lastCard.scrollIntoViewIfNeeded();
    const cardBox = await lastCard.boundingBox();
    expect(cardBox).not.toBeNull();

    const dock = page.getByTestId("mobile-dock");
    const dockBox = await dock.boundingBox();
    expect(dockBox).not.toBeNull();

    // The bottom of the last card must clear the top of the fixed dock.
    expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(dockBox!.y);
  });
}
```

- [ ] **Step 2: Verify the test data-testids exist on each screen**

Run: `pnpm exec rg -n 'data-testid="(vat-preparation|policy-rules-studio|audit-spine)"' apps/web/components/screens`

Expected: All three testids found. If `policy-rules-studio` is missing, add it as a `data-testid` on the matching card in [apps/web/components/screens/assistant-screen.tsx](apps/web/components/screens/assistant-screen.tsx) (the "Policy and rules studio" section). Locate the section first; pick the existing wrapper element rather than introducing a new one.

- [ ] **Step 3: Run the test (mobile project only) and confirm it fails**

Run: `pnpm build && pnpm exec playwright test tests/e2e/mobile-bottom-clearance.spec.ts --project=mobile-chromium`

Expected: 3 failures. The assertion `cardBox.y + cardBox.height <= dockBox.y` is false because the canvas does not reserve space for the dock.

### Task 2: Reserve bottom space on mobile in `.workspace-canvas`

**Files:**

- Modify: `apps/web/app/globals.css:126-128`

- [ ] **Step 1: Apply the CSS change**

Replace the existing `.workspace-canvas` rule:

```css
.workspace-canvas {
  padding-bottom: 16px;
}
```

with one that reserves space for the fixed dock + capture pill on small screens, then resets at the desktop breakpoint where both elements are hidden.

```css
.workspace-canvas {
  /*
   * Mobile reserves space for the fixed dock (~64px) and the floating
   * Capture pill (~52px) above it, plus safe-area inset and breathing room.
   * Desktop ≥1024px hides both, so the override below clears the padding.
   */
  padding-bottom: calc(env(safe-area-inset-bottom) + 144px);
}
```

Also add a desktop reset inside the existing `@media (min-width: 1024px)` block (the file already has this block at line 229; append the rule alongside `.mobile-dock, .capture-button-mobile { display: none }` at line 267):

```css
.workspace-canvas {
  padding-bottom: 24px;
}
```

- [ ] **Step 2: Run the regression test on mobile**

Run: `pnpm build && pnpm exec playwright test tests/e2e/mobile-bottom-clearance.spec.ts --project=mobile-chromium`

Expected: 3 passes.

- [ ] **Step 3: Run the regression test on desktop too (it should self-skip)**

Run: `pnpm exec playwright test tests/e2e/mobile-bottom-clearance.spec.ts --project=desktop-chromium`

Expected: 3 skipped. (Confirms the `test.skip` guard works.)

- [ ] **Step 4: Run the full e2e suite to make sure nothing else regressed**

Run: `pnpm test:e2e`

Expected: All tests pass on both projects.

- [ ] **Step 5: Visually sanity-check the desktop layout**

Run: `pnpm dev:web` and open http://localhost:3002/reports in a 1440×900 window. The page should look identical to the screenshot at [.reviews/2026-05-07-ux/02-desktop-reports.png](../../../.reviews/2026-05-07-ux/02-desktop-reports.png) — no extra empty space at the bottom of the canvas.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/globals.css tests/e2e/mobile-bottom-clearance.spec.ts apps/web/components/screens/assistant-screen.tsx
git commit -m "fix(web): reserve bottom space on mobile so dock + capture pill stop overlapping content"
```

---

## Phase 2 — Chrome cleanup: rename, dedupe, calm the topbar

**Why:** The "Control" tab contains zero controls; "Capture" has four different names; the topbar shows brand + runtime mode + region + date on every page; the runtime-mode banner duplicates the topbar pill. Each issue is small in isolation but together they make the chrome shout.

Each task in this phase produces a working app. Stop and ship between tasks if you want.

### Task 3: Rename `Control` → `Settings` in primary nav

**Files:**

- Modify: `apps/web/components/app-shell.tsx:16-21` — the `navigation` array
- Modify: `tests/e2e/navigation-and-share.spec.ts:21` — the link selector

- [ ] **Step 1: Update the e2e test first (it must keep passing)**

In [tests/e2e/navigation-and-share.spec.ts:21](../../../tests/e2e/navigation-and-share.spec.ts#L21), change:

```typescript
await page.getByRole("link", { name: "Control" }).click();
```

to:

```typescript
await page.getByRole("link", { name: "Settings" }).click();
```

- [ ] **Step 2: Update the navigation entry**

In [apps/web/components/app-shell.tsx:20](../../../apps/web/components/app-shell.tsx#L20), change:

```typescript
{ href: "/settings", label: "Control", summary: "Guardrails and deployment posture", icon: ControlIcon },
```

to:

```typescript
{ href: "/settings", label: "Settings", summary: "Status, posture, and account", icon: ControlIcon },
```

(Keep the `ControlIcon` import — it's a sliders icon and still semantically fits.)

- [ ] **Step 3: Run the e2e suite**

Run: `pnpm test:e2e`

Expected: All tests pass on both projects.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/app-shell.tsx tests/e2e/navigation-and-share.spec.ts
git commit -m "refactor(web): rename Control tab to Settings to match its actual contents"
```

### Task 4: Unify the Capture verb across all surfaces

**Why:** Today: "Capture Evidence" (rail), "Capture" (mobile pill), "Add business evidence" (sheet title), "Quick Intake" (sheet eyebrow). One concept, four phrasings.

**Files:**

- Modify: `apps/web/components/app-shell.tsx:252-256` (rail button), `:300-304` (mobile pill — already says "Capture"), `:394-396` (sheet title), `:394` (sheet eyebrow)

- [ ] **Step 1: Update copy**

In [apps/web/components/app-shell.tsx](../../../apps/web/components/app-shell.tsx):

- Rail button (line ~256): `Capture Evidence` → `Capture`
- Sheet eyebrow (line ~394): `Quick Intake` → `Capture`
- Sheet title (line ~395): `Add business evidence` → `Capture evidence`

This makes the verb "Capture" everywhere, with the sheet adding "evidence" only as the noun being captured.

- [ ] **Step 2: Run typecheck + lint**

Run: `pnpm typecheck && pnpm lint`

Expected: No errors.

- [ ] **Step 3: Run the e2e suite**

Run: `pnpm test:e2e`

Expected: All tests pass — the existing tests target `data-testid` selectors, not the visible copy, so no test changes are needed.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/app-shell.tsx
git commit -m "refactor(web): unify capture verb across rail, mobile pill, and sheet"
```

### Task 5: Suppress the runtime-mode banner when the topbar pill is visible

**Why:** Both the topbar pill (`runtime-mode-pill`) and the soft-yellow `runtime-mode-banner` say "Demo mode is active" in the same viewport. One signal is enough.

**Files:**

- Modify: `apps/web/components/app-shell.tsx:309-318` — the demo banner block

- [ ] **Step 1: Tighten the e2e expectation first**

Find every reference to `runtime-mode-banner` in `tests/e2e`:

Run: `pnpm exec rg -n 'runtime-mode-banner' tests`

Expected matches: `tests/e2e/home.spec.ts:21`, possibly others. Update each to assert the **pill** instead, since that's what we keep.

For example, in [tests/e2e/home.spec.ts:21](../../../tests/e2e/home.spec.ts#L21), change:

```typescript
await expect(page.getByTestId("runtime-mode-banner")).toContainText("Demo mode is active");
```

to:

```typescript
await expect(page.getByTestId("runtime-mode-pill")).toContainText("Demo");
```

- [ ] **Step 2: Run the suite to confirm it still passes against the unmodified UI**

Run: `pnpm test:e2e`

Expected: All tests pass (the banner still exists, the pill still exists; we just changed which one we assert).

- [ ] **Step 3: Remove the demo banner block**

In [apps/web/components/app-shell.tsx:309-318](../../../apps/web/components/app-shell.tsx#L309-L318), delete the entire `webRuntimeConfig.runtimeMode === "demo" ? (...) : null` block that renders `runtime-mode-banner`.

- [ ] **Step 4: Run the full suite**

Run: `pnpm check`

Expected: lint + format:check + typecheck + unit + build all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/app-shell.tsx tests/e2e/home.spec.ts
git commit -m "refactor(web): drop redundant demo-mode banner; the topbar pill already conveys it"
```

### Task 6: Calm the topbar — drop region/date on mobile

**Why:** Every mobile page top inch shows brand + runtime + "Sweden Central / Stockholm" + ISO date. None of this is action-relevant 99% of sessions. Move it to Settings under a small "Workspace" section.

**Files:**

- Modify: `apps/web/components/app-shell.tsx:292-295` — the region/date block (already hidden under `sm:block`, but still occupies the topbar grid on `sm+`; we want to pull it entirely off mobile and demote on desktop)
- Modify: `apps/web/components/screens/settings-screen.tsx` — append a "Workspace" section that surfaces region + ISO date

- [ ] **Step 1: Read the current settings screen so the new section matches its style**

Run: `Read apps/web/components/screens/settings-screen.tsx`

Note: the existing screen uses card sections with eyebrow + heading + body. Match that.

- [ ] **Step 2: Add the Workspace section to settings**

Append a new card before the audit-spine card:

```tsx
<section data-testid="workspace-info" className="glass-panel rounded-3xl p-5">
  <p className="text-eyebrow">Workspace</p>
  <h3 className="mt-2 text-lg font-semibold">Sweden Central · Stockholm</h3>
  <p className="mt-2 text-sm text-[var(--color-text-muted)]">
    Today is{" "}
    <time dateTime={new Date().toISOString().slice(0, 10)}>{new Intl.DateTimeFormat("sv-SE").format(new Date())}</time>.
  </p>
</section>
```

- [ ] **Step 3: Remove the topbar region/date block**

In [apps/web/components/app-shell.tsx:292-295](../../../apps/web/components/app-shell.tsx#L292-L295), delete the `<div className="hidden ... sm:block">…Sweden Central…</div>` block entirely. The topbar grid will collapse — no other change needed.

- [ ] **Step 4: Run the e2e suite**

Run: `pnpm test:e2e`

Expected: All tests pass. (No test asserts on the topbar region/date string.)

- [ ] **Step 5: Visually verify**

Open the app at 390×844 and 1440×900. Topbar should now show only brand + runtime pill + active page label + capture button on mobile; on desktop the rail handles brand and capture, so the topbar shows brand pill + active page + spacer.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/app-shell.tsx apps/web/components/screens/settings-screen.tsx
git commit -m "refactor(web): move workspace region/date out of the topbar into Settings"
```

### Task 7: Replace per-screen marketing headlines with status summaries

**Why:** Each screen opens with brand-statement copy ("Review-ready bookkeeping, shaped for the phone first.", "Architecture guardrails baked into the product surface.") that pushes real work below the fold every visit.

**Files:**

- Modify: `apps/web/components/screens/home-screen.tsx` — the `<h1>` and lede paragraph
- Modify: `apps/web/components/screens/reports-screen.tsx` — the `<h1>`
- Modify: `apps/web/components/screens/assistant-screen.tsx` — the `<h1>`
- Modify: `apps/web/components/screens/settings-screen.tsx` — the `<h1>`
- Modify: `tests/e2e/home.spec.ts` — heading regex
- Modify: `tests/e2e/reports.spec.ts` — heading name
- Modify: `tests/e2e/assistant.spec.ts` — heading (verify with grep first)

- [ ] **Step 1: Verify which tests assert on which headings**

Run: `pnpm exec rg -n 'getByRole.*heading' tests/e2e`

Note every match. Expected: `home.spec.ts:19`, `reports.spec.ts:13`, possibly `assistant.spec.ts`.

- [ ] **Step 2: Pick the new headlines (use these exact strings)**

| Screen   | Old                                                              | New                                                                                                                                              |
| -------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Home     | `Review-ready bookkeeping, shaped for the phone first.`          | `Review queue` (h1) + dynamic lede `"{n} vouchers awaiting review."` (where n comes from the `pendingReviews` count already in the screen state) |
| Reports  | `Fast reporting with the ledger still in plain sight.`           | `Reports`                                                                                                                                        |
| Advisor  | `Source-grounded finance guidance with room for human judgment.` | `Ask AI`                                                                                                                                         |
| Settings | `Architecture guardrails baked into the product surface.`        | `Settings`                                                                                                                                       |

The existing long descriptions become the body paragraph below the heading — keep them but demote them in size from `text-lg` to `text-sm text-[var(--color-text-muted)]`.

- [ ] **Step 3: Update each screen file**

Replace the `<h1>` and the immediate paragraph in each screen file. Match the existing component structure (eyebrow + heading + summary). Wire the home-screen lede to the existing pendingReviews count — no new state.

- [ ] **Step 4: Update the e2e tests**

In `home.spec.ts:19`:

```typescript
await expect(page.getByRole("heading", { name: /Review queue/i })).toBeVisible();
```

In `reports.spec.ts:13`:

```typescript
await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
```

Update `assistant.spec.ts` analogously if it asserts the heading.

- [ ] **Step 5: Run the e2e suite**

Run: `pnpm test:e2e`

Expected: All tests pass on both projects.

- [ ] **Step 6: Run typecheck + lint + build**

Run: `pnpm check`

Expected: All green.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/screens tests/e2e
git commit -m "refactor(web): replace marketing headlines with screen-status summaries"
```

---

## Phase 3 — One primary action per screen (roadmap)

> **Re-spec before executing.** Use the `superpowers:brainstorming` skill to interrogate each screen's goals, data dependencies, and stakeholders before writing the detailed plan. The tasks below are the shape, not the spec.

### 3a. Inbox — promote "Approve next" to a primary CTA on every voucher card

- Move the approve button from the queue header into each `data-testid="review-card"`, full-width at the bottom of the card.
- Demote `Create sample receipt` to a `…` overflow menu on the queue header, hidden in non-demo runtime modes.
- Surface the queue's first card by default (no scroll required) on mobile.

### 3b. Reports — period selector + Export SIE primary

- Add a sticky period selector (this month / last month / Q1–Q4 / custom) above the journal summary card. Default: this month.
- Promote a single primary `Export SIE` button to the top right of the screen header.
- Move the "Compliance watch" card (currently inside the Inbox right-rail) here — Reports is where deadlines belong.
- Drop the duplicated "Entries 3 / Accounts 3 / VAT slices 2" hero metrics; the journal summary card already shows them.

### 3c. Assistant — keep "Run advisory pass" primary, add thread history

- Persist Q&A pairs into a thin `assistant_threads` table (or local storage if the back-end is not yet ready).
- Render the previous thread list in a left/right secondary column on desktop, collapsible on mobile.
- Keep "Run advisory pass" as the screen's primary CTA.

### 3d. Settings — split into Status and configuration

- Move the existing Runtime / Deployment / Audit copy into a `Status` sub-section.
- Introduce stub configuration sections users expect: Profile, Workspace, Integrations (Skatteverket, banks), Team, Billing. Stub them with "coming soon" empty states — the _information architecture_ matters even before the wiring.

**Each of 3a–3d should be its own plan, written via the brainstorming skill once Phase 2 has shipped.**

---

## Phase 4 — Global primitives (roadmap)

> **Each item is its own plan.** Brainstorm the spec, then write a TDD plan per item.

### 4a. Global search (`⌘K` palette)

Searchable surfaces: vouchers (by number, supplier, amount), accounts (BAS code or name), suppliers, queue states. Anchored in the topbar; opens a Motion-animated palette overlay.

### 4b. Notifications surface

Bell icon in topbar with unread dot. Backed by the same `compliance watch` events Inbox renders — single source. Tapping a notification deep-links to the relevant queue item.

### 4c. Account / workspace menu

Avatar in the bottom-left of the desktop rail (replacing the current "Innovation track" marketing card) and as a topbar menu on mobile. Surfaces: signed-in user, workspace switcher, sign out, link to docs.

### 4d. Capture sheet — collapse to one primary

Today the four buttons (Camera / Upload / Paste / Share) are functionally identical. Either:

- (a) Collapse to one `Capture evidence` primary that opens the device camera or file picker; tuck Paste/Share behind a small disclosure or only show when a clipboard image is detected; **or**
- (b) Wire each button to its actual handler (Camera = `getUserMedia`, Paste = clipboard read, Share = native share target). Don't ship four labels for one behavior.

---

## Stretch (post-Phase 4)

- Localize chrome to Swedish (or expose a language toggle). Account labels are already Swedish; the chrome is English; the mix is jarring.
- Empty-state copy on Inbox when the queue is clear ("Your queue is clear — capture an invoice or wait for share-target uploads").
- Voucher card: one-thumb scroll experience — full-width approve button at the card bottom on mobile.

---

## Self-Review

**Spec coverage:** Each of the 20 findings from the 2026‑05‑07 review maps to a phase task —

- Findings 1, 18 → Phase 1 (mobile occlusion, Compliance Watch buried — second is addressed by moving the card to Reports in Phase 3b)
- Findings 4, 5 → Task 3 (rename Control)
- Findings 6, 7 → Task 6 (topbar) + Task 4 (capture verb)
- Finding 8 → Task 5 (demo banner dedupe)
- Finding 9 → Task 7 (replace headlines)
- Findings 2, 11, 12, 19 → Phase 3a/3b (primary actions on Inbox, drop duplicate metrics on Reports)
- Finding 17 → Phase 3b (VAT preparation gets an action via Export SIE)
- Findings 10, 13, 14, 15 → Phase 4 (global search, notifications, account menu, drop Innovation Track)
- Finding 16 → Phase 4d (capture sheet rationalization)
- Finding 20 → Phase 4c (rail width — replacing the marketing card with the avatar menu shrinks the rail by reclaiming the bottom card)

**Placeholder scan:** Phases 3 and 4 are intentionally roadmap-level and explicitly call this out at the section header. Phase 1 and Phase 2 contain complete code for every step.

**Type consistency:** No new TypeScript types are introduced; all code reuses existing helpers (`pendingReviews`, `data-testid` strings, etc.).

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-07-ux-improvements.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Good fit because Phase 1 + Phase 2 are seven small tasks, each independently shippable.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?** And do you want to scope the first execution to Phase 1 only (the defect fix), Phases 1+2 (the full chrome cleanup), or run further?
