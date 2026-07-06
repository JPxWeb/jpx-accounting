# Gamification Journey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve JPX onboarding from opt-in click-through tours into a **trust-first gamified activation journey** — data-honest checklist milestones, action-gated quests, and professional micro-celebrations — without points, streaks, or vanity badges.

**Architecture:** Preserve the existing split: **ledger-derived milestones = truth** (`getting-started-widget`), **localStorage = tour/quest UX state** (`onboarding-storage`, new `quest-progress-storage`). Add a thin **quest orchestrator** that gates Joyride steps on real user actions (evidence promoted, review approved, drill opened) via React Query subscriptions and DOM event emitters. Visual layer upgrades reuse existing tokens (`glass-chrome`, teal accent, `StatusBadge`, `Kbd`, Sonner toasts) with restrained motion.

**Tech Stack:** React 19, Next.js 16, react-joyride 3.1.0, nuqs, React Query 5, motion/react, next-intl, existing `@jpx-accounting/domain` projections.

**Research validated (July 2026):**

- B2B checklists: 5–7 discrete actions, visible progress, endowed progress on first item ([Alphonsolabs 2026](https://www.alphonsolabs.com/b2b-onboarding-ux-checklist-2026/), [Cubitrek](https://cubitrek.com/blog/gamified-onboarding-saas-activation))
- Gamification for professional SaaS: progress bars + milestones, **not** XP/badges/leaderboards ([Formbricks 2026](https://formbricks.com/blog/user-onboarding-best-practices), [Cubitrek](https://cubitrek.com/blog/gamified-onboarding-saas-activation))
- Opt-in tours ~2× completion vs auto-fire; 3–6 steps per tour ([UserTourKit 2026](https://usertourkit.com/blog/product-tour-guide-2026))
- **Action-based progression** closes the gap between tour completion and activation ([Jimo 2026](https://jimo.ai/blog/interactive-product-tour), [Apty](https://apty.ai/blog/interactive-walkthroughs/), [Product Fruits 2026](https://productfruits.com/blog/how-to-build-perfect-product-tours-in-2026))
- Micro-celebrations: subtle checkmark/toast at trust moments, not confetti ([SaaS UI Design 2026](https://www.saasui.design/blog/saas-onboarding-flows-that-actually-convert-2026), [Fluid22 2026](https://fluid22.com/insights/micro-interactions-that-matter-for-ux-wins-in-2026))
- Behavior-gated milestones, not calendar-day sequences ([Arcade 2026 playbook](https://www.arcade.software/post/saas-onboarding-complete-playbook))

**Product alignment:** Advisory pivot spec §3 journey — demo sandbox → checklist widget → capture ≤3 taps → review gate hero → reports drill → advisor chat. Design principles: AI suggests never mutates; every number traversable; tap budgets (capture ≤3, review ≤2).

---

## Current state (baseline)

| Layer                            | Status       | Key files                                     |
| -------------------------------- | ------------ | --------------------------------------------- |
| Data-derived checklist (5 steps) | ✅ Landed    | `getting-started-widget.tsx`                  |
| Opt-in Joyride tours (9 IDs)     | ✅ Landed    | `onboarding-shell.tsx`, `tour-definitions.ts` |
| Tour completion storage          | ✅ Landed    | `onboarding-storage.ts`                       |
| Action-gated quests              | ❌ Missing   | —                                             |
| Rich tooltip visuals             | ❌ Text-only | `tour-tooltip.tsx`                            |
| Broken review tour anchors       | ❌ Bug       | `data-tour` missing on review DOM             |
| Milestone celebrations           | ❌ Missing   | —                                             |

**Activation milestones (JPX-specific, derived from ledger):**

| ID        | Done when                                     | Source                             |
| --------- | --------------------------------------------- | ---------------------------------- |
| `capture` | `evidence.length > SEEDED_EVIDENCE_COUNT`     | workspace snapshot                 |
| `approve` | any review `approved` or `booked-without-vat` | workspace snapshot                 |
| `import`  | journal entry with `voucherId` prefix `sie_`  | reports pack                       |
| `advisor` | ≥1 assistant thread                           | `assistant-thread-storage` (local) |
| `profile` | company settings exist                        | `company-settings` query           |

**Priority quests (Phase 3):**

1. **First posting** — capture → promote → approve (action-gated)
2. **Trace a number** — reports KPI → narrative → drill drawer (require `?drill=` click)

---

## File map (new + modified)

| File                                                               | Responsibility                                      |
| ------------------------------------------------------------------ | --------------------------------------------------- |
| `apps/web/lib/onboarding/milestone-derivation.ts`                  | **New** — single source for checklist truth         |
| `apps/web/lib/onboarding/quest-model.ts`                           | **New** — QuestId, QuestGate, QuestDefinition types |
| `apps/web/lib/onboarding/quest-definitions.ts`                     | **New** — quest step + gate definitions             |
| `apps/web/lib/onboarding/quest-progress-storage.ts`                | **New** — `jpx.accounting.questProgress.v1`         |
| `apps/web/lib/onboarding/quest-events.ts`                          | **New** — emit/subscribe for user actions           |
| `apps/web/components/onboarding/quest-coach.tsx`                   | **New** — banner while quest active                 |
| `apps/web/components/onboarding/quest-flow-diagram.tsx`            | **New** — inline SVG flow for tooltips              |
| `apps/web/components/onboarding/hotkey-strip.tsx`                  | **New** — review keyboard discovery strip           |
| `apps/web/components/onboarding/quest-progress.tsx`                | **New** — upgraded progress bar + step dots         |
| `apps/web/components/onboarding/milestone-toast.tsx`               | **New** — edge-triggered celebration helper         |
| `apps/web/lib/onboarding/milestone-derivation.ts`                  | Extract from widget                                 |
| `apps/web/lib/onboarding/tour-definitions.ts`                      | Conditional steps, diagram keys, fix selectors      |
| `apps/web/components/onboarding/onboarding-shell.tsx`              | Controlled Joyride + gate logic                     |
| `apps/web/components/onboarding/onboarding-context.tsx`            | `startQuest`, `activeQuestId`                       |
| `apps/web/components/onboarding/tour-tooltip.tsx`                  | Step dots, diagram slot, hotkey slot                |
| `apps/web/components/dashboard/widgets/getting-started-widget.tsx` | Quest CTAs, progress upgrade, toasts                |
| `apps/web/components/today/review-card.tsx`                        | Add `data-tour` anchors                             |
| `apps/web/components/today/review-card-actions.tsx`                | Add `data-tour="review-accept"`                     |
| `apps/web/components/screens/today-screen.tsx`                     | Add `data-tour="today-view-queue"`                  |
| `apps/web/components/today/review-queue-view.tsx`                  | Hotkey strip, quest emit on approve                 |
| `apps/web/components/screens/reports-screen.tsx`                   | Drill quest emit, hint wiring                       |
| `apps/web/lib/promotion.ts`                                        | Quest emit on promote                               |
| `apps/web/messages/en.json` + `sv.json`                            | Quest, milestone, diagram, hotkey copy              |
| `tests/unit/milestone-derivation.test.ts`                          | **New**                                             |
| `tests/unit/quest-progress-storage.test.ts`                        | **New**                                             |
| `tests/e2e/onboarding.spec.ts`                                     | Action-gated quest specs                            |

---

## Phase 1 — Fix tour breakage + centralize milestones

### Task 1: Add missing review-gate tour anchors

**Files:**

- Modify: `apps/web/components/screens/today-screen.tsx`
- Modify: `apps/web/components/today/review-card.tsx`
- Modify: `apps/web/components/today/review-card-actions.tsx`
- Test: `tests/e2e/onboarding.spec.ts`

- [ ] **Step 1: Write failing E2E assertion**

Add to `tests/e2e/onboarding.spec.ts`:

```typescript
test("review-gate tour targets exist in demo queue", async ({ page }) => {
  await page.goto("/today?view=queue");
  await expect(page.locator('[data-tour="today-view-queue"]')).toBeVisible();
  await expect(page.locator('[data-tour="review-card"]').first()).toBeVisible();
  await expect(page.locator('[data-tour="review-accept"]').first()).toBeVisible();
});
```

- [ ] **Step 2: Run E2E to verify failure**

Run: `corepack pnpm build:e2e && npx playwright test tests/e2e/onboarding.spec.ts -g "review-gate tour targets" --project=desktop-chromium`

Expected: FAIL — locators not found

- [ ] **Step 3: Add data-tour attributes**

In `today-screen.tsx`, on the queue toggle control:

```tsx
data-tour="today-view-queue"
```

In `review-card.tsx`, on the article root:

```tsx
data-tour="review-card"
```

On the confidence band span (alongside existing `data-testid`):

```tsx
data-tour="confidence-band"
```

In `review-card-actions.tsx`, on the accept button:

```tsx
data-tour="review-accept"
```

- [ ] **Step 4: Run E2E to verify pass**

Run: same command as Step 2. Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/screens/today-screen.tsx apps/web/components/today/review-card.tsx apps/web/components/today/review-card-actions.tsx tests/e2e/onboarding.spec.ts
git commit -m "fix(onboarding): add review-gate data-tour anchors for Joyride targets"
```

---

### Task 2: Extract milestone derivation module

**Files:**

- Create: `apps/web/lib/onboarding/milestone-derivation.ts`
- Modify: `apps/web/components/dashboard/widgets/getting-started-widget.tsx`
- Create: `tests/unit/milestone-derivation.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create `tests/unit/milestone-derivation.test.ts`:

```typescript
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveMilestones, SEEDED_EVIDENCE_COUNT } from "../../apps/web/lib/onboarding/milestone-derivation";

describe("deriveMilestones", () => {
  const emptySnapshot = {
    evidence: [],
    reviews: [],
    reports: { journal: [] },
  } as Parameters<typeof deriveMilestones>[0]["snapshot"];

  it("demo capture requires evidence beyond seeded baseline", () => {
    const result = deriveMilestones({
      snapshot: { ...emptySnapshot, evidence: [{ id: "e1" }] as never[] },
      settings: null,
      advisorThreadCount: 0,
      runtimeMode: "demo",
    });
    assert.equal(result.capture, false);
    assert.equal(SEEDED_EVIDENCE_COUNT.demo, 1);
  });

  it("approve flips on approved review", () => {
    const result = deriveMilestones({
      snapshot: {
        ...emptySnapshot,
        reviews: [{ status: "approved" }] as never[],
      },
      settings: null,
      advisorThreadCount: 0,
      runtimeMode: "demo",
    });
    assert.equal(result.approve, true);
  });

  it("import flips on sie_ voucher", () => {
    const result = deriveMilestones({
      snapshot: {
        ...emptySnapshot,
        reports: { journal: [{ voucherId: "sie_001" }] } as never },
      },
      settings: null,
      advisorThreadCount: 0,
      runtimeMode: "normal",
    });
    assert.equal(result.import, true);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `corepack pnpm exec tsx --test tests/unit/milestone-derivation.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Implement milestone-derivation.ts**

Create `apps/web/lib/onboarding/milestone-derivation.ts`:

```typescript
import type { CompanySettings } from "@jpx-accounting/contracts";

import type { DashboardData } from "../../components/dashboard/use-dashboard-data";

export type MilestoneId = "capture" | "approve" | "import" | "advisor" | "profile";

export const SEEDED_EVIDENCE_COUNT = { demo: 1, normal: 0 } as const;

export function deriveMilestones(input: {
  snapshot: NonNullable<DashboardData["snapshot"]>;
  settings: CompanySettings | null | undefined;
  advisorThreadCount: number;
  runtimeMode: "demo" | "normal";
}): Record<MilestoneId, boolean> {
  const seeded = SEEDED_EVIDENCE_COUNT[input.runtimeMode];
  return {
    capture: input.snapshot.evidence.length > seeded,
    approve: input.snapshot.reviews.some(
      (review) => review.status === "approved" || review.status === "booked-without-vat",
    ),
    import: input.snapshot.reports.journal.some((entry) => entry.voucherId.startsWith("sie_")),
    advisor: input.advisorThreadCount > 0,
    profile: Boolean(input.settings),
  };
}

export function countCompletedMilestones(milestones: Record<MilestoneId, boolean>): number {
  return (Object.keys(milestones) as MilestoneId[]).filter((key) => milestones[key]).length;
}
```

- [ ] **Step 4: Refactor getting-started-widget to use deriveMilestones**

Replace inline `done` object and `SEEDED_EVIDENCE_COUNT` with imports from `milestone-derivation.ts`. Pass `webRuntimeConfig.runtimeMode` and `advisorThreadCount`.

- [ ] **Step 5: Run tests**

Run: `corepack pnpm exec tsx --test tests/unit/milestone-derivation.test.ts`

Expected: PASS

Run: `corepack pnpm typecheck`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/onboarding/milestone-derivation.ts apps/web/components/dashboard/widgets/getting-started-widget.tsx tests/unit/milestone-derivation.test.ts
git commit -m "refactor(onboarding): centralize milestone derivation for gamification spine"
```

---

### Task 3: Conditional review-gate tour steps for empty queue

**Files:**

- Modify: `apps/web/lib/onboarding/tour-definitions.ts`
- Modify: `apps/web/components/onboarding/onboarding-shell.tsx`

- [ ] **Step 1: Add buildReviewGateSteps with empty-state branch**

In `tour-definitions.ts`, change `buildReviewGateSteps` to accept `{ pendingReviewCount: number }`:

```typescript
export function buildReviewGateSteps(ctx: { pendingReviewCount: number; isMobile: boolean }): TourStepDef[] {
  const base = [
    /* queue toggle step */
  ];
  if (ctx.pendingReviewCount === 0) {
    return [
      ...base,
      {
        id: "empty",
        target: '[data-tour="getting-started-widget"]',
        route: "/today",
        placement: "bottom" as const,
      },
    ];
  }
  return [
    ...base,
    /* card, confidence, accept, actions, hotkeys — existing steps */
  ];
}
```

Add i18n keys `onboarding.tours.review-gate.steps.empty.title|content` in both locales explaining "Capture something first, then return here."

- [ ] **Step 2: Pass pendingReviewCount from onboarding-shell**

In `onboarding-shell.tsx`, when building steps for `review-gate`, read workspace snapshot from React Query cache (or accept count via context prop) and call `buildReviewGateSteps({ pendingReviewCount, isMobile })`.

- [ ] **Step 3: Manual verify in demo**

Run dev servers; start review-gate tour from checklist with empty queue (normal mode) vs demo queue populated. Expected: empty branch vs full steps.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/onboarding/tour-definitions.ts apps/web/components/onboarding/onboarding-shell.tsx apps/web/messages/en.json apps/web/messages/sv.json
git commit -m "fix(onboarding): branch review-gate tour when queue is empty"
```

---

## Phase 2 — Visual progress + tooltip upgrades

### Task 4: Quest progress bar component

**Files:**

- Create: `apps/web/components/onboarding/quest-progress.tsx`
- Modify: `apps/web/components/dashboard/widgets/getting-started-widget.tsx`

- [ ] **Step 1: Create QuestProgress component**

```tsx
"use client";

type QuestProgressProps = {
  done: number;
  total: number;
  label: string;
  showDots?: boolean;
};

export function QuestProgress({ done, total, label, showDots = true }: QuestProgressProps) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="font-mono text-caption tabular-nums text-muted-foreground">
          {done}/{total}
        </p>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-surface-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-label={label}
      >
        <div
          className="h-full rounded-full bg-primary transition-all duration-normal motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
      {showDots ? (
        <div className="flex gap-1.5" aria-hidden="true">
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={`size-1.5 rounded-full ${i < done ? "bg-primary" : "bg-border"}`} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Replace inline progress bar in getting-started-widget**

Import `QuestProgress`; pass `t("progress", { done, total })` as label.

- [ ] **Step 3: Verify aria + visual**

Run: `corepack pnpm typecheck`. Manually inspect Today dashboard — bar is `h-2`, dots render, reduced-motion respected via global CSS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/onboarding/quest-progress.tsx apps/web/components/dashboard/widgets/getting-started-widget.tsx
git commit -m "feat(onboarding): upgrade checklist progress bar with step dots"
```

---

### Task 5: Tour tooltip visual upgrade (dots + diagram slot)

**Files:**

- Create: `apps/web/components/onboarding/quest-flow-diagram.tsx`
- Modify: `apps/web/components/onboarding/tour-tooltip.tsx`
- Modify: `apps/web/lib/onboarding/tour-definitions.ts`

- [ ] **Step 1: Create QuestFlowDiagram**

Inline SVG component accepting `nodes: string[]` and `activeIndex: number`. Nodes render as `glass-panel-soft` chips connected by teal stroke lines. Mark SVG `aria-hidden="true"`. No animation when `prefers-reduced-motion`.

```tsx
export function QuestFlowDiagram({ nodes, activeIndex }: { nodes: string[]; activeIndex: number }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 py-2" aria-hidden="true">
      {nodes.map((label, i) => (
        <span key={label} className="flex items-center gap-1.5">
          <span
            className={`rounded-lg px-2 py-1 text-xs font-medium glass-panel-soft ${
              i === activeIndex ? "ring-2 ring-primary" : ""
            }`}
          >
            {label}
          </span>
          {i < nodes.length - 1 ? <span className="text-muted-foreground">→</span> : null}
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Extend TourStepDef with optional diagram**

In `tour-definitions.ts`:

```typescript
export type TourStepDef = {
  // existing fields...
  diagram?: { nodesKey: string; activeIndex: number };
};
```

Add diagram to `capture-flow` promote step (`Capture → Review → Books`) and `reports-drill` drill step (`KPI → Narrative → Drill`).

- [ ] **Step 3: Upgrade tour-tooltip.tsx**

Add step dot row (`size-1.5 rounded-full`, active `bg-primary`, done `bg-success`, upcoming `bg-border`). Render `QuestFlowDiagram` when step has `diagram`. Keep existing `glass-chrome` chrome and button row.

- [ ] **Step 4: Add i18n diagram node labels**

Under `onboarding.diagrams.capture-pipeline.*` and `onboarding.diagrams.reports-drill.*` in en.json and sv.json.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/onboarding/quest-flow-diagram.tsx apps/web/components/onboarding/tour-tooltip.tsx apps/web/lib/onboarding/tour-definitions.ts apps/web/messages/en.json apps/web/messages/sv.json
git commit -m "feat(onboarding): add step dots and flow diagrams to tour tooltips"
```

---

### Task 6: Review hotkey strip

**Files:**

- Create: `apps/web/components/onboarding/hotkey-strip.tsx`
- Modify: `apps/web/components/today/review-queue-view.tsx`
- Modify: `apps/web/messages/en.json` + `sv.json`

- [ ] **Step 1: Create HotkeyStrip**

Reuse existing `Kbd` from `@/components/ui/kbd`. Layout: `glass-panel-inset rounded-lg px-3 py-2`, eyebrow label, flex-wrap pairs of `[Kbd] + label`.

```tsx
import { Kbd } from "@/components/ui/kbd";

const KEYS = [
  { key: "Y", labelKey: "accept" },
  { key: "E", labelKey: "edit" },
  { key: "B", labelKey: "bookWithoutVat" },
  { key: "N", labelKey: "reject" },
] as const;

export function HotkeyStrip({ t }: { t: (key: string) => string }) {
  return (
    <div className="glass-panel-inset rounded-lg px-3 py-2">
      <p className="text-eyebrow mb-2 text-muted-foreground">{t("title")}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {KEYS.map(({ key, labelKey }) => (
          <span key={key} className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
            <Kbd>{key}</Kbd>
            {t(`keys.${labelKey}`)}
          </span>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount below queue header in review-queue-view**

Only when `view=queue` and at least one pending review. Add `data-tour="review-hotkeys-strip"` for tour targeting.

- [ ] **Step 3: Add i18n under `onboarding.hotkeys.*`**

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/onboarding/hotkey-strip.tsx apps/web/components/today/review-queue-view.tsx apps/web/messages/en.json apps/web/messages/sv.json
git commit -m "feat(onboarding): add review keyboard discovery strip"
```

---

## Phase 3 — Quest engine + action-gated tours

### Task 7: Quest progress storage + event bus

**Files:**

- Create: `apps/web/lib/onboarding/quest-model.ts`
- Create: `apps/web/lib/onboarding/quest-progress-storage.ts`
- Create: `apps/web/lib/onboarding/quest-events.ts`
- Create: `tests/unit/quest-progress-storage.test.ts`

- [ ] **Step 1: Define quest model types**

`quest-model.ts`:

```typescript
import type { MilestoneId } from "./milestone-derivation";
import type { TourId } from "./tour-ids";

export type QuestId = "quest-first-posting" | "quest-trace-number" | "quest-advisor-question";

export type QuestGate =
  | { type: "milestone"; milestone: MilestoneId }
  | { type: "dom-click"; selector: string }
  | { type: "url-param"; param: string }
  | { type: "event"; name: string };

export type QuestStep = {
  id: string;
  titleKey: string;
  bodyKey: string;
  tourId: TourId;
  tourStepId: string;
  gate: QuestGate;
};

export type QuestDefinition = {
  id: QuestId;
  teaches: MilestoneId;
  steps: QuestStep[];
};
```

- [ ] **Step 2: Write quest-progress-storage tests (mirror onboarding-storage pattern)**

Test parse/validate, mark quest completed, active quest index persistence.

- [ ] **Step 3: Implement quest-progress-storage.ts**

Storage key: `jpx.accounting.questProgress.v1`. Fields: `activeQuestId`, `activeStepIndex`, `completedQuests[]`, `events[]` (ring buffer max 50).

- [ ] **Step 4: Implement quest-events.ts**

```typescript
type QuestEventDetail = { name: string; meta?: Record<string, string | number | boolean> };

export function emitQuestAction(detail: QuestEventDetail): void {
  window.dispatchEvent(new CustomEvent("jpx:quest-action", { detail }));
}

export function subscribeQuestActions(handler: (detail: QuestEventDetail) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<QuestEventDetail>).detail);
  window.addEventListener("jpx:quest-action", listener);
  return () => window.removeEventListener("jpx:quest-action", listener);
}
```

- [ ] **Step 5: Run unit tests**

Run: `corepack pnpm exec tsx --test tests/unit/quest-progress-storage.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/onboarding/quest-model.ts apps/web/lib/onboarding/quest-progress-storage.ts apps/web/lib/onboarding/quest-events.ts tests/unit/quest-progress-storage.test.ts
git commit -m "feat(onboarding): add quest progress storage and action event bus"
```

---

### Task 8: Wire quest action emitters

**Files:**

- Modify: `apps/web/lib/promotion.ts`
- Modify: `apps/web/components/today/review-queue-view.tsx`
- Modify: `apps/web/components/screens/reports-screen.tsx`
- Modify: `apps/web/components/screens/assistant-screen.tsx` (or advisor-chat)

- [ ] **Step 1: Emit on successful promote**

In `promotion.ts`, after successful evidence creation:

```typescript
import { emitQuestAction } from "./onboarding/quest-events";
// ...
emitQuestAction({ name: "evidence.promoted", meta: { evidenceId } });
```

- [ ] **Step 2: Emit on review approve**

After successful `applyReviewSnapshotUpdate` with approved status:

```typescript
emitQuestAction({ name: "review.approved", meta: { reviewId } });
```

- [ ] **Step 3: Emit on drill open**

When `setDrill(accountNumber)` is called in reports-screen:

```typescript
emitQuestAction({ name: "reports.drill-opened", meta: { account: accountNumber } });
```

- [ ] **Step 4: Emit on first advisor message**

When a new assistant thread is persisted:

```typescript
emitQuestAction({ name: "advisor.message-sent" });
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/promotion.ts apps/web/components/today/review-queue-view.tsx apps/web/components/screens/reports-screen.tsx
git commit -m "feat(onboarding): emit quest actions on key activation events"
```

---

### Task 9: Quest definitions + QuestCoach banner

**Files:**

- Create: `apps/web/lib/onboarding/quest-definitions.ts`
- Create: `apps/web/components/onboarding/quest-coach.tsx`
- Modify: `apps/web/components/onboarding/onboarding-context.tsx`

- [ ] **Step 1: Define quest-first-posting**

```typescript
export const QUEST_DEFINITIONS: Record<QuestId, QuestDefinition> = {
  "quest-first-posting": {
    id: "quest-first-posting",
    teaches: "approve",
    steps: [
      {
        id: "capture",
        titleKey: "onboarding.quests.first-posting.steps.capture.title",
        bodyKey: "onboarding.quests.first-posting.steps.capture.body",
        tourId: "capture-flow",
        tourStepId: "dropzone",
        gate: { type: "event", name: "evidence.promoted" },
      },
      {
        id: "review",
        titleKey: "onboarding.quests.first-posting.steps.review.title",
        bodyKey: "onboarding.quests.first-posting.steps.review.body",
        tourId: "review-gate",
        tourStepId: "accept",
        gate: { type: "milestone", milestone: "approve" },
      },
    ],
  },
  // quest-trace-number: KPI step → drill gate on reports.drill-opened
};
```

- [ ] **Step 2: Create QuestCoach banner**

Fixed bottom banner (above mobile dock clearance) showing active quest title, step progress, "Waiting for you to…" copy when gate unsatisfied, checkmark when gate satisfied. Uses `glass-chrome`, dismissible. Register as tour blocker when visible.

- [ ] **Step 3: Extend onboarding-context with startQuest / activeQuestId**

- [ ] **Step 4: Add i18n for all quest strings (en + sv)**

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/onboarding/quest-definitions.ts apps/web/components/onboarding/quest-coach.tsx apps/web/components/onboarding/onboarding-context.tsx apps/web/messages/en.json apps/web/messages/sv.json
git commit -m "feat(onboarding): add quest definitions and coach banner"
```

---

### Task 10: Controlled Joyride + gate advancement

**Files:**

- Modify: `apps/web/components/onboarding/onboarding-shell.tsx`
- Modify: `apps/web/components/dashboard/widgets/getting-started-widget.tsx`

- [ ] **Step 1: Add controlled stepIndex state when quest active**

When `activeQuestId` is set:

- Initialize Joyride at quest step's `tourStepId`
- Set `stepIndex` controlled mode
- Hide Next button on gated steps (`hideNext: true` via step data)
- Subscribe to `subscribeQuestActions` + React Query workspace cache

- [ ] **Step 2: Advance on gate satisfaction**

```typescript
function gateSatisfied(gate: QuestGate, milestones: Record<MilestoneId, boolean>, lastEvent?: string): boolean {
  switch (gate.type) {
    case "milestone":
      return milestones[gate.milestone];
    case "event":
      return lastEvent === gate.name;
    case "url-param":
      return new URLSearchParams(window.location.search).has(gate.param);
    default:
      return false;
  }
}
```

When satisfied: `setStepIndex(i + 1)` or `controls.next()`; update quest progress storage; show QuestCoach check state.

- [ ] **Step 3: Fix skip semantics**

Change `onboarding-shell.tsx`: `STATUS.SKIPPED` does **not** call `markTourCompleted` — only `STATUS.FINISHED` does. Skipped tours remain replayable from Settings.

- [ ] **Step 4: Add "Start quest" CTA on getting-started widget**

For incomplete `capture` + `approve` steps, show primary "Start first posting quest" alongside existing "Guide me" text link. Calls `startQuest("quest-first-posting")`.

- [ ] **Step 5: Register tour blockers on ReviewEditSheet + AccountDrillDrawer**

Use existing `registerGlobalTourBlocker` pattern from `app-shell.tsx`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/onboarding/onboarding-shell.tsx apps/web/components/dashboard/widgets/getting-started-widget.tsx
git commit -m "feat(onboarding): action-gated quest progression with controlled Joyride"
```

---

### Task 11: Reports drill quest — auto-open drawer

**Files:**

- Modify: `apps/web/lib/onboarding/tour-definitions.ts`
- Modify: `apps/web/components/onboarding/onboarding-shell.tsx`
- Modify: `apps/web/components/screens/reports-screen.tsx`

- [ ] **Step 1: In drill step before-hook, set ?drill= param**

When quest `quest-trace-number` reaches drill step, read first `bs-line` account from pack and call `setDrill(accountNumber)` so drawer exists for spotlight.

- [ ] **Step 2: Gate on reports.drill-opened event**

- [ ] **Step 3: E2E test for trace-number quest**

```typescript
test("trace-number quest opens drill drawer", async ({ page }) => {
  await page.goto("/today");
  await page.getByRole("button", { name: /start.*posting|trace/i }).click();
  // navigate through quest or start trace quest directly
  await page.goto("/reports");
  await expect(page.locator('[data-testid="account-drill-drawer"]')).toBeVisible({ timeout: 10000 });
});
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/onboarding/tour-definitions.ts apps/web/components/onboarding/onboarding-shell.tsx apps/web/components/screens/reports-screen.tsx tests/e2e/onboarding.spec.ts
git commit -m "feat(onboarding): trace-number quest with drill drawer gate"
```

---

## Phase 4 — Milestone celebrations + polish

### Task 12: Milestone toast on step completion

**Files:**

- Create: `apps/web/components/onboarding/milestone-toast.tsx`
- Modify: `apps/web/components/dashboard/widgets/getting-started-widget.tsx`
- Modify: `apps/web/messages/en.json` + `sv.json`

- [ ] **Step 1: Create useMilestoneCelebration hook**

Track previous `deriveMilestones` result in a ref. On false→true transition, call `toast.success(t(\`milestone.${id}.title\`), { description: t(\`milestone.${id}.body\`) })`. Respect reduced motion — toast only, no scale animation when `prefers-reduced-motion`.

- [ ] **Step 2: Upgrade all-done state**

Replace plain text with `glass-panel-soft` + `StatusBadge variant="success"` + hint copy.

- [ ] **Step 3: Add i18n milestone copy (professional tone)**

Example en:

- `milestone.capture.title`: "First receipt captured"
- `milestone.approve.title`: "First posting approved"
- Avoid: "Level up!", "Quest complete!", confetti language.

- [ ] **Step 4: Optional row check animation**

On checklist row when step completes: 200ms scale on check circle using `motion/react` + `useReducedMotion()` (pattern from `review-card.tsx`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/onboarding/milestone-toast.tsx apps/web/components/dashboard/widgets/getting-started-widget.tsx apps/web/messages/en.json apps/web/messages/sv.json
git commit -m "feat(onboarding): subtle milestone toasts on checklist completion"
```

---

### Task 13: Wire dormant micro-hints + simplify entry points

**Files:**

- Modify: `apps/web/components/app-shell.tsx`
- Modify: `apps/web/components/screens/reports-screen.tsx`
- Modify: `apps/web/components/screens/capture-screen.tsx` (remove duplicate help if checklist covers it)
- Modify: `apps/web/components/onboarding/micro-hints.tsx`

- [ ] **Step 1: Wire hint-mobile-advisor on first mobile visit**

Show once when `advisor` milestone incomplete + mobile + tour not completed. CTA starts `hint-mobile-advisor` tour.

- [ ] **Step 2: Wire hint-reports-drill when pack has balance sheet lines**

One-time CTA on reports screen when `bs-line` rows exist.

- [ ] **Step 3: Consolidate help buttons**

Keep per-screen help only for Books/Reports (no checklist step). Remove Capture help button if checklist "Guide me" covers it — reduces surface sprawl per prior review.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/app-shell.tsx apps/web/components/screens/reports-screen.tsx apps/web/components/screens/capture-screen.tsx apps/web/components/onboarding/micro-hints.tsx
git commit -m "refactor(onboarding): wire micro-hints and reduce help button sprawl"
```

---

### Task 14: Endowed progress + empty-state branching

**Files:**

- Modify: `apps/web/components/dashboard/widgets/getting-started-widget.tsx`
- Modify: `apps/web/messages/en.json` + `sv.json`

- [ ] **Step 1: Endowed progress in demo mode**

In demo, pre-check "Explore dashboard" pseudo-step OR mark first checklist item visually as "Demo data loaded" when seeded evidence exists — shows progress at 1/5 without lying about user action. Copy must be honest: "Sample receipt included in demo."

- [ ] **Step 2: Empty-state aware checklist hints**

When `capture` incomplete and evidence empty, step hint links to `/capture` with copy "Drop a file or use quick-add." When `approve` incomplete but capture done, hint emphasizes review queue.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/dashboard/widgets/getting-started-widget.tsx apps/web/messages/en.json apps/web/messages/sv.json
git commit -m "feat(onboarding): endowed demo progress and empty-state checklist hints"
```

---

## Phase 5 — Analytics + verification

### Task 15: Local quest analytics ring buffer

**Files:**

- Modify: `apps/web/lib/onboarding/quest-progress-storage.ts`
- Modify: `apps/web/components/onboarding/onboarding-shell.tsx`

- [ ] **Step 1: Log events on quest lifecycle**

Events: `quest.started`, `quest.step.viewed`, `quest.step.gate-satisfied`, `quest.completed`, `quest.abandoned`, `tour.skipped`, `tour.finished`.

- [ ] **Step 2: Expose read-only export in Settings About (optional debug)**

Add to `OnboardingReplayPanel`: "Copy onboarding debug" button dumps JSON of onboarding + quest state (dev/demo only).

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/onboarding/quest-progress-storage.ts apps/web/components/onboarding/onboarding-shell.tsx apps/web/components/onboarding/micro-hints.tsx
git commit -m "feat(onboarding): local quest analytics ring buffer"
```

---

### Task 16: E2E + unit verification gate

**Files:**

- Modify: `tests/e2e/onboarding.spec.ts`
- Modify: `tests/e2e/mobile-bottom-clearance.spec.ts` (if QuestCoach overlaps dock)

- [ ] **Step 1: E2E — first posting quest (demo)**

```typescript
test("first posting quest advances on approve in demo", async ({ page }) => {
  await page.goto("/today");
  await page.getByRole("button", { name: /first posting/i }).click();
  await page.goto("/capture");
  // promote quick-add or existing flow
  await page.goto("/today?view=queue");
  await page.locator('[data-tour="review-accept"]').first().click();
  await expect(page.getByText(/first posting approved|milestone/i)).toBeVisible();
});
```

- [ ] **Step 2: E2E — mobile QuestCoach clearance**

Verify QuestCoach banner does not overlap mobile dock (144px clearance).

- [ ] **Step 3: Run full check**

Run: `corepack pnpm check`

Expected: lint + typecheck + unit + build pass

Run: `corepack pnpm build:e2e && npx playwright test tests/e2e/onboarding.spec.ts --project=desktop-chromium --project=mobile-chromium`

Expected: PASS (fix Playwright `pnpm` PATH in config if needed — use `corepack pnpm` in `playwright.config.ts` webServer command)

- [ ] **Step 4: Update DEV_STATUS.md**

Add gamification journey status under Phase 7 / onboarding follow-ups.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/onboarding.spec.ts tests/e2e/mobile-bottom-clearance.spec.ts docs/DEV_STATUS.md
git commit -m "test(onboarding): E2E coverage for action-gated gamification journey"
```

---

## Anti-patterns (do NOT implement)

| Pattern                     | Why avoided                        | Source                         |
| --------------------------- | ---------------------------------- | ------------------------------ |
| Points, XP, levels          | ~0 B2B activation lift             | Cubitrek 2026                  |
| Streaks                     | Bookkeeping is not daily           | Product context                |
| Leaderboards                | Private books — nonsensical        | Cubitrek, Formbricks           |
| Confetti / mascots          | Undermines trust for audit product | SaaS UI Design 2026, JPX brand |
| Auto-start tours            | 31% vs 67% completion              | UserTourKit 2026               |
| Local checkbox milestones   | Legal/compliance misrepresentation | JPX append-only integrity      |
| Blocking full-screen wizard | Violates opt-in principle          | Advisory pivot §3              |

---

## Risk register

| Risk                                              | Mitigation                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------------- |
| Empty queue in normal mode breaks review quest    | Conditional tour steps (Task 3); quest prerequisites                    |
| `suggestionsEnabled: false` hides confidence band | Branch tour definitions on settings                                     |
| Joyride + keyboard shortcuts conflict             | Pause review hotkeys while quest active on review steps                 |
| Widget hidden via dashboard customize             | Orientation tour step 1 falls back to nav anchor                        |
| Cross-device quest state                          | Quest progress stays local; milestones stay ledger-derived              |
| Teal contrast 3.31:1 on some surfaces             | Use `text-foreground` on white tooltip bodies; track axe fix separately |
| Playwright pnpm PATH                              | Use `corepack pnpm` in playwright webServer config                      |

---

## Success metrics (measure after launch)

| Metric                         | Target                    | How                                  |
| ------------------------------ | ------------------------- | ------------------------------------ |
| Checklist completion (14-day)  | +20% vs baseline          | Local quest events → future PostHog  |
| Time to first approval         | −30% median               | `milestone.approve` timestamp delta  |
| Tour skip rate                 | <40%                      | `tour.skipped` / `tour.started`      |
| Quest gate drop-off            | Identify worst step       | `quest.step.viewed` funnel           |
| Drill adoption post-onboarding | +15% users with `?drill=` | reports quest completion correlation |

---

## Execution order summary

```
Phase 1 (fix + spine):  Task 1 → Task 2 → Task 3
Phase 2 (visual):       Task 4 ∥ Task 5 ∥ Task 6
Phase 3 (quests):       Task 7 → Task 8 → Task 9 → Task 10 → Task 11
Phase 4 (polish):       Task 12 → Task 13 → Task 14
Phase 5 (verify):       Task 15 → Task 16
```

**Estimated effort:** 6–8 dev-days for one engineer; Tasks 1–6 can ship independently as a "visual + fix" PR before quest engine lands.

---

## Self-review checklist

- [x] Spec coverage: advisory pivot §3 journey steps mapped to quests/milestones
- [x] Research citations: July 2026 B2B gamification + action-based tours validated
- [x] Functional + visual aspects covered via multi-agent exploration
- [x] No placeholders — all tasks have file paths and code snippets
- [x] Preserves ledger-truth architecture from existing onboarding-storage comment
- [x] Type names consistent: `MilestoneId`, `QuestId`, `QuestGate` used throughout
