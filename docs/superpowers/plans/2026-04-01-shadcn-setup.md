# shadcn/ui Setup & Theming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure shadcn/ui theming to match JPX Accounting's teal+slate design system, install initial component set, and add a11y testing.

**Architecture:** Replace shadcn's default neutral OKLCH palette with slate-tinted values and teal primary in globals.css. Install 12 shadcn components (button, card, badge, dialog, sheet, input, label, select, separator, skeleton, sonner, tooltip). Add axe-core to Playwright E2E tests for WCAG 2.2 AA compliance checking.

**Tech Stack:** shadcn/ui 4.x, Tailwind CSS 4.2, Base UI, OKLCH color space, Lucide icons, axe-core/playwright

**Spec:** `docs/superpowers/specs/2026-04-01-shadcn-setup-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `apps/web/app/globals.css` | Modify (lines 8-42, 341-416) | Replace OKLCH values with slate+teal palette |
| `apps/web/components/ui/*.tsx` | Create (12 files) | shadcn component installations |
| `apps/web/hooks/use-mobile.tsx` | Create | shadcn hook (installed with sheet) |
| `apps/web/package.json` | Modify | New dependencies from shadcn add |
| `package.json` (root) | Modify | Add @axe-core/playwright devDep |
| `tests/e2e/home.spec.ts` | Modify | Add axe-core a11y assertion |
| `tests/e2e/a11y-helpers.ts` | Create | Shared axe-core helper |

---

### Task 1: Apply Teal + Slate OKLCH Theme

**Files:**
- Modify: `apps/web/app/globals.css:8-42` (light mode `:root` variables)
- Modify: `apps/web/app/globals.css:384-416` (dark mode `.dark` variables)

- [ ] **Step 1: Replace light mode `:root` OKLCH values**

In `apps/web/app/globals.css`, replace lines 8-42 with the teal primary + slate neutral palette:

```css
:root {
  color-scheme: light;
  --background: oklch(0.95 0.006 264);
  --foreground: oklch(0.145 0.014 265);
  --card: oklch(0.995 0.001 264);
  --card-foreground: oklch(0.145 0.014 265);
  --popover: oklch(0.995 0.001 264);
  --popover-foreground: oklch(0.145 0.014 265);
  --primary: oklch(0.486 0.096 175.8);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.968 0.005 264);
  --secondary-foreground: oklch(0.205 0.012 265);
  --muted: oklch(0.968 0.005 264);
  --muted-foreground: oklch(0.556 0.01 264);
  --accent: oklch(0.968 0.005 264);
  --accent-foreground: oklch(0.205 0.012 265);
  --destructive: oklch(0.45 0.18 25);
  --border: oklch(0.91 0.006 264);
  --input: oklch(0.91 0.006 264);
  --ring: oklch(0.486 0.096 175.8);
  --chart-1: oklch(0.486 0.096 175.8);
  --chart-2: oklch(0.6 0.08 175);
  --chart-3: oklch(0.4 0.07 265);
  --chart-4: oklch(0.7 0.06 175);
  --chart-5: oklch(0.3 0.05 265);
  --radius: 0.75rem;
  --sidebar: oklch(0.985 0.002 264);
  --sidebar-foreground: oklch(0.145 0.014 265);
  --sidebar-primary: oklch(0.486 0.096 175.8);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.968 0.005 264);
  --sidebar-accent-foreground: oklch(0.205 0.012 265);
  --sidebar-border: oklch(0.91 0.006 264);
  --sidebar-ring: oklch(0.486 0.096 175.8);
}
```

- [ ] **Step 2: Replace dark mode `.dark` OKLCH values**

Replace lines 384-416 (the `.dark` block) with slate-tinted dark values and lighter teal accent:

```css
.dark {
  --background: oklch(0.16 0.014 265);
  --foreground: oklch(0.985 0.002 264);
  --card: oklch(0.22 0.012 265);
  --card-foreground: oklch(0.985 0.002 264);
  --popover: oklch(0.22 0.012 265);
  --popover-foreground: oklch(0.985 0.002 264);
  --primary: oklch(0.65 0.12 175.8);
  --primary-foreground: oklch(0.16 0.014 265);
  --secondary: oklch(0.27 0.01 265);
  --secondary-foreground: oklch(0.985 0.002 264);
  --muted: oklch(0.27 0.01 265);
  --muted-foreground: oklch(0.708 0.008 264);
  --accent: oklch(0.27 0.01 265);
  --accent-foreground: oklch(0.985 0.002 264);
  --destructive: oklch(0.65 0.2 25);
  --border: oklch(0.27 0.01 265);
  --input: oklch(0.32 0.01 265);
  --ring: oklch(0.65 0.12 175.8);
  --chart-1: oklch(0.65 0.12 175.8);
  --chart-2: oklch(0.55 0.09 175);
  --chart-3: oklch(0.5 0.07 265);
  --chart-4: oklch(0.7 0.08 175);
  --chart-5: oklch(0.4 0.06 265);
  --sidebar: oklch(0.22 0.012 265);
  --sidebar-foreground: oklch(0.985 0.002 264);
  --sidebar-primary: oklch(0.65 0.12 175.8);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.27 0.01 265);
  --sidebar-accent-foreground: oklch(0.985 0.002 264);
  --sidebar-border: oklch(0.27 0.01 265);
  --sidebar-ring: oklch(0.65 0.12 175.8);
}
```

- [ ] **Step 3: Verify build**

Run: `pnpm typecheck && pnpm build`
Expected: Both pass. The CSS variables are consumed by `@theme inline` which maps them to Tailwind utility classes — no TypeScript changes needed.

- [ ] **Step 4: Visual check**

Run: `pnpm dev:web` and open `http://localhost:3000`
Expected: The app should look the same as before (the radial gradient background and glass-morphism classes use `ui-tokens` variables, not shadcn vars). The teal primary will be visible once shadcn components are added in Task 2.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/globals.css
git commit -m "style: apply teal + slate OKLCH theme for shadcn/ui

Replace default neutral palette with slate-tinted neutrals (hue 264-265)
and teal primary (oklch 0.486 0.096 175.8 = #0f766e). Dark mode values
use lighter teal and inverted slate luminance."
```

---

### Task 2: Install shadcn Components (Phase 1)

**Files:**
- Create: `apps/web/components/ui/button.tsx`
- Create: `apps/web/components/ui/card.tsx`
- Create: `apps/web/components/ui/badge.tsx`
- Create: `apps/web/components/ui/dialog.tsx`
- Create: `apps/web/components/ui/sheet.tsx`
- Create: `apps/web/components/ui/input.tsx`
- Create: `apps/web/components/ui/label.tsx`
- Create: `apps/web/components/ui/select.tsx`
- Create: `apps/web/components/ui/separator.tsx`
- Create: `apps/web/components/ui/skeleton.tsx` (overwrites existing)
- Create: `apps/web/components/ui/sonner.tsx`
- Create: `apps/web/components/ui/tooltip.tsx`
- Create: `apps/web/hooks/use-mobile.tsx` (may be created by sheet)
- Modify: `apps/web/package.json` (new dependencies added by CLI)

- [ ] **Step 1: Install all 12 components via shadcn CLI**

Run from `apps/web/`:
```bash
cd apps/web && npx shadcn@latest add button card badge dialog sheet input label select separator skeleton sonner tooltip -y
```

The `-y` flag accepts defaults without prompts. This will:
- Create component files in `apps/web/components/ui/`
- Add dependencies to `apps/web/package.json` (e.g., `sonner`, `@radix-ui/react-*` or Base UI equivalents)
- May create `apps/web/hooks/use-mobile.tsx` (used by sheet for responsive behavior)

**Note:** This will overwrite `apps/web/components/ui/skeleton.tsx`. That's intentional — shadcn's Skeleton replaces our custom one.

- [ ] **Step 2: Install new dependencies**

Run from repo root:
```bash
pnpm install
```

- [ ] **Step 3: Verify typecheck and build**

Run: `pnpm typecheck && pnpm build`
Expected: Both pass. The new component files are standalone — nothing imports them yet.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/ui/ apps/web/hooks/ apps/web/package.json pnpm-lock.yaml
git commit -m "feat(ui): install shadcn/ui phase 1 components

Add 12 components: button, card, badge, dialog, sheet, input, label,
select, separator, skeleton, sonner, tooltip. All themed with teal
primary via OKLCH CSS variables."
```

---

### Task 3: Fix Skeleton Import Compatibility

The shadcn `skeleton.tsx` exports a single `Skeleton` component but our codebase also imports `ScreenSkeleton` from `../ui/skeleton`. We need to add `ScreenSkeleton` back to the shadcn skeleton file.

**Files:**
- Modify: `apps/web/components/ui/skeleton.tsx`

- [ ] **Step 1: Check the shadcn skeleton file**

Read `apps/web/components/ui/skeleton.tsx` to see what shadcn generated. It will look approximately like:

```tsx
import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("bg-accent animate-pulse rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
```

- [ ] **Step 2: Add ScreenSkeleton to the file**

Append the `ScreenSkeleton` component after the `Skeleton` export. This composite component uses shadcn's `Skeleton` internally:

```tsx
function ScreenSkeleton() {
  return (
    <div className="page-shell space-y-6">
      <div className="glass-panel rounded-3xl p-5 md:p-6">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-4 h-10 w-3/4" />
        <Skeleton className="mt-3 h-5 w-2/3" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="glass-panel rounded-3xl p-5">
          <Skeleton className="h-5 w-32" />
          <div className="mt-4 grid grid-cols-3 gap-3">
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
          </div>
        </div>
        <div className="glass-panel rounded-3xl p-5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-4 h-24 rounded-2xl" />
          <Skeleton className="mt-3 h-24 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

export { Skeleton, ScreenSkeleton }
```

Update the export statement at the bottom to include both.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS. The existing imports of `ScreenSkeleton` from `../ui/skeleton` now resolve correctly.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/ui/skeleton.tsx
git commit -m "fix(ui): restore ScreenSkeleton in shadcn skeleton file

The shadcn CLI overwrote our custom skeleton.tsx. Re-add the
ScreenSkeleton composite component using shadcn's Skeleton internally."
```

---

### Task 4: Add Sonner Toaster to Root Layout

The `sonner` component needs a `<Toaster />` provider in the root layout to work.

**Files:**
- Modify: `apps/web/app/layout.tsx`

- [ ] **Step 1: Add Toaster import and component to layout**

In `apps/web/app/layout.tsx`, add the Toaster import and place it inside the body, after `{children}`:

```tsx
import { Toaster } from "@/components/ui/sonner";
```

Add `<Toaster />` as the last child inside `<body>`, after the `</QueryProvider>` closing tag:

```tsx
        <QueryProvider>
          <ServiceWorkerRegistrar />
          {children}
        </QueryProvider>
        <Toaster />
```

- [ ] **Step 2: Verify typecheck and build**

Run: `pnpm typecheck && pnpm build`
Expected: Both pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/layout.tsx
git commit -m "feat(ui): add Sonner toaster provider to root layout"
```

---

### Task 5: Install axe-core for Playwright A11y Testing

**Files:**
- Modify: `package.json` (root)
- Create: `tests/e2e/a11y-helpers.ts`
- Modify: `tests/e2e/home.spec.ts`

- [ ] **Step 1: Install @axe-core/playwright**

```bash
pnpm add -D @axe-core/playwright -w
```

- [ ] **Step 2: Create shared a11y helper**

Create `tests/e2e/a11y-helpers.ts`:

```typescript
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * Run axe-core WCAG 2.2 AA checks on the current page.
 * Call after the page has fully loaded and settled.
 */
export async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
}
```

- [ ] **Step 3: Add a11y check to home page test**

In `tests/e2e/home.spec.ts`, add the import at the top:

```typescript
import { expectAccessible } from "./a11y-helpers";
```

Add a new test after the existing tests:

```typescript
test("home screen passes WCAG 2.2 AA accessibility checks", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("review-card")).toHaveCount(1);
  await expectAccessible(page);
});
```

- [ ] **Step 4: Run the E2E tests**

Run: `pnpm test:e2e`
Expected: Tests pass. If there are a11y violations, they will show specific WCAG rule failures — fix them before proceeding. Common initial violations:
- Missing landmarks (add `<main>` wrapper)
- Color contrast ratios below 4.5:1
- Missing form labels

**Note:** If violations are found, fix them as part of this task before committing. The goal is a green baseline.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml tests/e2e/a11y-helpers.ts tests/e2e/home.spec.ts
git commit -m "test(a11y): add axe-core WCAG 2.2 AA checks to Playwright E2E

Add @axe-core/playwright and shared expectAccessible() helper. Add
accessibility test for home screen. EAA compliance baseline."
```

---

### Task 6: Final Verification

- [ ] **Step 1: Full check pipeline**

Run: `pnpm check`
Expected: Typecheck + build both pass.

- [ ] **Step 2: E2E tests**

Run: `pnpm test:e2e`
Expected: All existing tests pass + new a11y test passes.

- [ ] **Step 3: Visual verification**

Run: `pnpm dev:web` and verify in the browser:
1. The radial gradient background still renders (teal + blue gradients)
2. Glass-morphism panels (`.glass-chrome`, `.glass-panel`) look unchanged
3. The skip-to-content link appears on Tab press
4. Font is still Manrope (not Geist)

- [ ] **Step 4: Verify shadcn add works for future components**

Test that the CLI can add components correctly with the configured aliases:
```bash
cd apps/web && npx shadcn@latest add alert -y --dry-run
```
Expected: Shows files that would be created in `apps/web/components/ui/alert.tsx` (not in a wrong path). The `--dry-run` flag prevents actual file creation.

If `--dry-run` is not supported, skip this step — the fact that Task 2 components installed correctly already validates the setup.
