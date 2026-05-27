# Unified Radius System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dual radius system with a single calc-based scale and update all component classes to follow a consistent Nordic Minimal hierarchy.

**Architecture:** Remove pixel-based radius values from ui-tokens. The shadcn `@theme inline` calc system (derived from `--radius: 0.75rem`) becomes the single source of truth. Every Tailwind `rounded-*` class in the codebase is updated to match the hierarchy: shell containers (`rounded-2xl`), section panels (`rounded-xl`), inner cards (`rounded-lg`), controls (`rounded-md`), badges (`rounded-full`).

**Tech Stack:** Tailwind CSS 4.2, CSS custom properties, shadcn/ui theming

**Spec:** `docs/superpowers/specs/2026-04-01-unified-radius-design.md`

---

## File Map

| File                                              | Action | Responsibility                                          |
| ------------------------------------------------- | ------ | ------------------------------------------------------- |
| `packages/ui-tokens/styles.css`                   | Modify | Remove `--radius-*` pixel properties                    |
| `apps/web/app/globals.css`                        | Modify | Remove `.skeleton` border-radius referencing old tokens |
| `apps/web/components/app-shell.tsx`               | Modify | Update ~18 radius classes                               |
| `apps/web/components/screens/home-screen.tsx`     | Modify | Update ~18 radius classes                               |
| `apps/web/components/screens/reports-screen.tsx`  | Modify | Update ~9 radius classes                                |
| `apps/web/components/screens/settings-screen.tsx` | Modify | Update 3 radius classes                                 |
| `apps/web/components/ui/metric-card.tsx`          | Modify | Update 1 radius class                                   |
| `apps/web/components/ui/status-badge.tsx`         | Modify | Update 1 radius class                                   |

---

### Task 1: Remove pixel-based radius from ui-tokens

**Files:**

- Modify: `packages/ui-tokens/styles.css:66-73`

- [ ] **Step 1: Remove the `--radius-*` block from ui-tokens**

In `packages/ui-tokens/styles.css`, delete lines 66-73 (the border radius section):

```css
/* Border radius — aligned with Mercury/Linear scale */
--radius-sm: 6px;
--radius-md: 8px;
--radius-lg: 12px;
--radius-xl: 16px;
--radius-2xl: 22px;
--radius-3xl: 28px;
--radius-4xl: 32px;
```

These are superseded by the `@theme inline` calc-based values in `globals.css`.

- [ ] **Step 2: Remove the `.skeleton` border-radius from globals.css**

In `apps/web/app/globals.css`, the `.skeleton` class (around line 233) has `border-radius: var(--radius-lg)` which references the now-deleted token. Remove that line — shadcn's Skeleton component handles its own border-radius.

Find and remove this line inside the `.skeleton` rule:

```css
border-radius: var(--radius-lg);
```

- [ ] **Step 3: Verify build**

Run: `pnpm typecheck && pnpm build`
Expected: Both pass. The old `--radius-*` vars are only used in globals.css (the `.skeleton` class we just fixed) and Tailwind utilities (which are now served by `@theme inline`).

- [ ] **Step 4: Commit**

```bash
git add packages/ui-tokens/styles.css apps/web/app/globals.css
git commit -m "refactor(tokens): remove pixel-based radius values

Radius scale is now derived from shadcn's --radius: 0.75rem via
@theme inline calc multipliers. Removes duplicate ui-tokens values."
```

---

### Task 2: Update app-shell.tsx radius classes

**Files:**

- Modify: `apps/web/components/app-shell.tsx`

All changes are Tailwind class replacements. Use find-and-replace within the file.

- [ ] **Step 1: Apply all radius class changes**

Make these exact replacements in `apps/web/components/app-shell.tsx`:

**Shell containers — `rounded-4xl` → `rounded-2xl`:**

- Line 177: `glass-chrome rounded-4xl` → `glass-chrome rounded-2xl`
- Line 198: `glass-panel rounded-4xl` → `glass-panel rounded-2xl`
- Line 236: `glass-panel rounded-4xl` → `glass-panel rounded-2xl`
- Line 257: `glass-panel-soft mt-auto rounded-4xl` → `glass-panel-soft mt-auto rounded-2xl`

**Top bar and dock — `rounded-3xl` → `rounded-2xl`:**

- Line 271: `glass-chrome flex items-center justify-between gap-4 rounded-3xl` → `glass-chrome flex items-center justify-between gap-4 rounded-2xl`
- Line 343: `mobile-dock glass-chrome rounded-3xl` → `mobile-dock glass-chrome rounded-2xl`

**Capture sheet dialog — `rounded-4xl` → `rounded-xl`:**

- Line 385: `glass-chrome w-full max-w-xl rounded-4xl` → `glass-chrome w-full max-w-xl rounded-xl`

**Nav items — `rounded-2xl` → `rounded-lg`:**

- Line 208: `rounded-2xl px-4 py-4 transition` → `rounded-lg px-4 py-4 transition`

**Nav icon background — `rounded-xl` → `rounded-lg`:**

- Line 215: `mt-0.5 rounded-xl p-2` → `mt-0.5 rounded-lg p-2`

**Buttons — `rounded-xl` → `rounded-md`:**

- Line 250: `rounded-xl bg-[var(--color-accent)]` (capture desktop) → `rounded-md bg-[var(--color-accent)]`
- Line 298: `rounded-xl bg-[var(--color-accent)]` (capture mobile) → `rounded-md bg-[var(--color-accent)]`

**Banners/notices — `rounded-2xl` → `rounded-lg`:**

- Line 192: `rounded-2xl bg-[var(--color-warning-soft)]` → `rounded-lg bg-[var(--color-warning-soft)]`
- Line 311: `glass-panel-soft rounded-2xl border` → `glass-panel-soft rounded-lg border`
- Line 328: `rounded-2xl px-4 py-3 text-center` → `rounded-lg px-4 py-3 text-center`

**Mobile dock items — `rounded-xl` → `rounded-lg`:**

- Line 355: `rounded-xl px-2 py-3` → `rounded-lg px-2 py-3`

**Capture sheet controls:**

- Line 405: `rounded-xl bg-white/72` (close btn) → `rounded-md bg-white/72`
- Line 422: `glass-panel rounded-xl px-4 py-4` (mode btns) → `glass-panel rounded-lg px-4 py-4`

**Date/location pill:**

- Line 290: `rounded-xl glass-panel-soft` → `rounded-lg glass-panel-soft`

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/app-shell.tsx
git commit -m "style(shell): apply unified radius scale to app shell

Shell containers: rounded-2xl, panels: rounded-xl, inner elements:
rounded-lg, buttons: rounded-md. Follows Nordic Minimal hierarchy."
```

---

### Task 3: Update home-screen.tsx radius classes

**Files:**

- Modify: `apps/web/components/screens/home-screen.tsx`

- [ ] **Step 1: Apply all radius class changes**

**Section headers — `rounded-3xl` → `rounded-xl`:**

- Line 150: `glass-chrome rounded-3xl` → `glass-chrome rounded-xl`

**Section panels — `rounded-3xl` → `rounded-xl`:**

- Line 202: `glass-panel rounded-3xl` → `glass-panel rounded-xl`
- Line 320: `glass-panel rounded-3xl` → `glass-panel rounded-xl`
- Line 340: `glass-panel rounded-3xl` → `glass-panel rounded-xl`
- Line 359: `glass-panel rounded-3xl` → `glass-panel rounded-xl`

**Inner cards — `rounded-2xl` → `rounded-lg`:**

- Line 205: `glass-panel-soft rounded-2xl` → `glass-panel-soft rounded-lg`
- Line 275: `glass-panel-soft rounded-2xl` → `glass-panel-soft rounded-lg`
- Line 282: `glass-panel-soft rounded-2xl` → `glass-panel-soft rounded-lg`
- Line 330: `glass-panel-soft rounded-2xl` → `glass-panel-soft rounded-lg`
- Line 344: `glass-panel-soft rounded-2xl` → `glass-panel-soft rounded-lg`
- Line 363: `glass-panel-soft rounded-2xl` → `glass-panel-soft rounded-lg`

**Data cells — `rounded-xl` → `rounded-lg`:**

- Line 218: `rounded-xl bg-[var(--color-accent-soft)]` → `rounded-lg bg-[var(--color-accent-soft)]`
- Line 239: `glass-panel-inset rounded-xl` → `glass-panel-inset rounded-lg`
- Line 245: `glass-panel-inset rounded-xl` → `glass-panel-inset rounded-lg`
- Line 251: `glass-panel-inset rounded-xl` → `glass-panel-inset rounded-lg`
- Line 286: `glass-panel-inset rounded-xl` → `glass-panel-inset rounded-lg`

**Tags/labels — `rounded-lg` → `rounded-md`:**

- Line 261: `rounded-lg bg-[var(--color-surface-muted)]` → `rounded-md bg-[var(--color-surface-muted)]`
- Line 264: `rounded-lg bg-[var(--color-accent-soft)]` → `rounded-md bg-[var(--color-accent-soft)]`
- Line 268: `rounded-lg bg-[var(--color-info-soft)]` → `rounded-md bg-[var(--color-info-soft)]`

**Buttons — `rounded-xl` → `rounded-md`:**

- Line 166: `glass-panel-soft rounded-xl` → `glass-panel-soft rounded-md`
- Line 175: `rounded-xl bg-[var(--color-accent)]` → `rounded-md bg-[var(--color-accent)]`

**Banners — `rounded-2xl` → `rounded-lg`:**

- Line 182: `rounded-2xl bg-[var(--color-danger-soft)]` → `rounded-lg bg-[var(--color-danger-soft)]`
- Line 307: `rounded-2xl bg-[var(--color-warning-soft)]` → `rounded-lg bg-[var(--color-warning-soft)]`

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/screens/home-screen.tsx
git commit -m "style(home): apply unified radius scale to home screen

Section panels: rounded-xl, inner cards: rounded-lg, data cells:
rounded-lg, tags: rounded-md, buttons: rounded-md."
```

---

### Task 4: Update reports-screen.tsx, settings-screen.tsx, and UI components

**Files:**

- Modify: `apps/web/components/screens/reports-screen.tsx`
- Modify: `apps/web/components/screens/settings-screen.tsx`
- Modify: `apps/web/components/ui/metric-card.tsx`
- Modify: `apps/web/components/ui/status-badge.tsx`

- [ ] **Step 1: Update reports-screen.tsx**

**Section panels — `rounded-3xl` → `rounded-xl`:**

- Line 63: `glass-panel rounded-3xl` → `glass-panel rounded-xl`
- Line 80: `glass-panel rounded-3xl` → `glass-panel rounded-xl`
- Line 114: `glass-panel rounded-3xl` → `glass-panel rounded-xl`

**Inner cards — `rounded-2xl` → `rounded-lg`:**

- Line 72: `glass-panel-soft rounded-2xl` → `glass-panel-soft rounded-lg`
- Line 84: `glass-panel-soft rounded-2xl` → `glass-panel-soft rounded-lg`
- Line 118: `glass-panel-soft rounded-2xl` → `glass-panel-soft rounded-lg`

**Data cells — `rounded-xl` → `rounded-lg`:**

- Line 95: `glass-panel-inset rounded-xl` → `glass-panel-inset rounded-lg`
- Line 101: `glass-panel-inset rounded-xl` → `glass-panel-inset rounded-lg`

- [ ] **Step 2: Update settings-screen.tsx**

**Section panels — `rounded-3xl` → `rounded-xl`:**

- Line 16: `glass-panel rounded-3xl` → `glass-panel rounded-xl`
- Line 34: `glass-panel rounded-3xl` → `glass-panel rounded-xl`
- Line 43: `glass-panel rounded-3xl` → `glass-panel rounded-xl`

- [ ] **Step 3: Update metric-card.tsx**

- Line 8: `glass-panel-soft rounded-2xl` → `glass-panel-soft rounded-lg`

- [ ] **Step 4: Update status-badge.tsx**

- Line 17: `rounded-lg px-3 py-1` → `rounded-full px-3 py-1`

- [ ] **Step 5: Verify typecheck and build**

Run: `pnpm typecheck && pnpm build`
Expected: Both pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/screens/reports-screen.tsx apps/web/components/screens/settings-screen.tsx apps/web/components/ui/metric-card.tsx apps/web/components/ui/status-badge.tsx
git commit -m "style(ui): apply unified radius to reports, settings, and shared components

Reports/settings sections: rounded-xl, inner cards: rounded-lg,
metric cards: rounded-lg, status badges: rounded-full (pill)."
```

---

### Task 5: Visual verification and E2E

- [ ] **Step 1: Start dev server and visually verify**

Run: `pnpm dev:web`

Check at these viewports:

- **Mobile (375px):** Home, Reports — verify no content cramped at corners
- **Desktop (1440px):** Home — verify sidebar sections, review cards, close copilot panel
- **Hierarchy check:** No nested element has a larger radius than its parent

- [ ] **Step 2: Run E2E tests**

Run: `pnpm test:e2e`
Expected: All tests pass (radius changes are visual only, no test IDs or behavior changed).

- [ ] **Step 3: Commit spec and plan docs**

```bash
git add docs/superpowers/specs/2026-04-01-unified-radius-design.md docs/superpowers/plans/2026-04-01-unified-radius.md
git commit -m "docs: add unified radius system spec and implementation plan"
```
