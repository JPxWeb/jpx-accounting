# shadcn/ui Setup & Theming Design Spec

**Date:** 2026-04-01
**Status:** Approved
**Scope:** Configure shadcn/ui theming to match JPX Accounting design system, install initial component set, add a11y tooling.

## Decisions

| Decision           | Choice                                | Rationale                                    |
| ------------------ | ------------------------------------- | -------------------------------------------- |
| Style preset       | Nova (`base-nova`)                    | Compact layout suits financial data density  |
| Primitives         | Base UI (`@base-ui/react`)            | Already installed, designed for React 19     |
| Component location | App-local (`apps/web/components/ui/`) | Single app, YAGNI on shared package          |
| Base color         | Slate                                 | Cool blue undertone complements teal accent  |
| Icon library       | Lucide (already installed)            | 1,500+ icons, tree-shakeable, shadcn default |

## 1. Theming — OKLCH Color Mapping

Replace the default neutral palette in `apps/web/app/globals.css` with Slate-based values and teal primary.

### Light mode (`:root`)

**Primary (teal):**

```
--primary: oklch(0.486 0.096 175.8)        /* #0f766e */
--primary-foreground: oklch(0.985 0 0)      /* white */
```

**Backgrounds (Slate):**

```
--background: oklch(0.95 0.006 264)         /* cool light slate, ~#e9eff2 */
--foreground: oklch(0.145 0.014 265)        /* near-black with slate tint */
```

**Cards/Surfaces:**

```
--card: oklch(0.995 0.001 264)              /* near-white, slight cool */
--card-foreground: oklch(0.145 0.014 265)
--popover: oklch(0.995 0.001 264)
--popover-foreground: oklch(0.145 0.014 265)
```

**Secondary/Muted (Slate grays):**

```
--secondary: oklch(0.968 0.005 264)
--secondary-foreground: oklch(0.205 0.012 265)
--muted: oklch(0.968 0.005 264)
--muted-foreground: oklch(0.556 0.01 264)   /* ~#607280 */
```

**Accent (lighter teal for hover/selected):**

```
--accent: oklch(0.968 0.005 264)
--accent-foreground: oklch(0.205 0.012 265)
```

**Destructive (danger red):**

```
--destructive: oklch(0.45 0.18 25)          /* ~#991b1b */
```

**Borders/Input:**

```
--border: oklch(0.91 0.006 264)
--input: oklch(0.91 0.006 264)
--ring: oklch(0.486 0.096 175.8)            /* teal, same as primary */
```

**Charts (teal-anchored palette for financial data):**

```
--chart-1: oklch(0.486 0.096 175.8)         /* teal primary */
--chart-2: oklch(0.6 0.08 175)              /* lighter teal */
--chart-3: oklch(0.4 0.07 265)              /* slate blue */
--chart-4: oklch(0.7 0.06 175)              /* light teal */
--chart-5: oklch(0.3 0.05 265)              /* dark slate */
```

**Sidebar (matches card):**

```
--sidebar: oklch(0.985 0.002 264)
--sidebar-foreground: oklch(0.145 0.014 265)
--sidebar-primary: oklch(0.486 0.096 175.8)
--sidebar-primary-foreground: oklch(0.985 0 0)
--sidebar-accent: oklch(0.968 0.005 264)
--sidebar-accent-foreground: oklch(0.205 0.012 265)
--sidebar-border: oklch(0.91 0.006 264)
--sidebar-ring: oklch(0.486 0.096 175.8)
```

**Radius:**

```
--radius: 0.75rem                            /* 12px, matches --radius-lg from ui-tokens */
```

### Dark mode (`.dark`)

Invert luminance, keep hue angles. Teal accent shifts lighter for dark backgrounds.

```
--background: oklch(0.16 0.014 265)
--foreground: oklch(0.985 0.002 264)
--card: oklch(0.22 0.012 265)
--card-foreground: oklch(0.985 0.002 264)
--popover: oklch(0.22 0.012 265)
--popover-foreground: oklch(0.985 0.002 264)
--primary: oklch(0.65 0.12 175.8)           /* lighter teal for dark bg */
--primary-foreground: oklch(0.16 0.014 265)
--secondary: oklch(0.27 0.01 265)
--secondary-foreground: oklch(0.985 0.002 264)
--muted: oklch(0.27 0.01 265)
--muted-foreground: oklch(0.708 0.008 264)
--accent: oklch(0.27 0.01 265)
--accent-foreground: oklch(0.985 0.002 264)
--destructive: oklch(0.65 0.2 25)
--border: oklch(0.27 0.01 265)
--input: oklch(0.32 0.01 265)
--ring: oklch(0.65 0.12 175.8)              /* lighter teal */
--chart-1: oklch(0.65 0.12 175.8)
--chart-2: oklch(0.55 0.09 175)
--chart-3: oklch(0.5 0.07 265)
--chart-4: oklch(0.7 0.08 175)
--chart-5: oklch(0.4 0.06 265)
--sidebar: oklch(0.22 0.012 265)
--sidebar-foreground: oklch(0.985 0.002 264)
--sidebar-primary: oklch(0.65 0.12 175.8)
--sidebar-primary-foreground: oklch(0.985 0 0)
--sidebar-accent: oklch(0.27 0.01 265)
--sidebar-accent-foreground: oklch(0.985 0.002 264)
--sidebar-border: oklch(0.27 0.01 265)
--sidebar-ring: oklch(0.65 0.12 175.8)
```

### `@theme inline` block

Update to match the new variables. Also fix `--font-mono` mapping and keep radius calc-based from shadcn's `--radius` var.

### Coexistence with `ui-tokens/styles.css`

The existing `--color-*` custom properties from `packages/ui-tokens/styles.css` (hex/rgba-based) continue to work alongside shadcn's OKLCH variables. They are parallel systems:

- **shadcn variables** (`--primary`, `--background`, etc.) are used by shadcn components via Tailwind utilities like `bg-primary`, `text-muted-foreground`
- **ui-tokens variables** (`--color-accent`, `--color-bg`, `--color-surface-*`, etc.) are used by existing custom CSS classes (`.glass-chrome`, `.glass-panel`, layout classes)

No consolidation needed now. Both are imported in globals.css and don't conflict. A future cleanup pass could unify them, but that's out of scope.

### `@layer base` block

Keep shadcn's base layer:

```css
@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
  html {
    @apply font-sans;
  }
}
```

The existing custom body styles (radial gradient background, font-family) in globals.css should override the base layer since they come after it. Verify this works visually after implementation.

## 2. Components to Install

### Phase 1 — Install now (core UI primitives)

```bash
cd apps/web
npx shadcn@latest add button card badge dialog sheet input label select separator skeleton sonner tooltip
```

These cover the immediate needs: review actions, cards, status badges, modals, mobile sheets, form inputs, notifications, and loading states.

### Phase 2 — Install when features need them

| Component                      | Trigger                              |
| ------------------------------ | ------------------------------------ |
| `form` (React Hook Form + Zod) | Voucher entry, account mapping forms |
| `table` (TanStack Table)       | Journal, balance, VAT report views   |
| `chart` (Recharts v3)          | Report dashboard visualizations      |
| `calendar` + `date-picker`     | Date range filters for reports       |
| `command`                      | Search/command palette               |
| `dropdown-menu`                | Context menus, overflow actions      |
| `tabs`                         | Report view switching                |
| `alert`                        | Compliance warnings, blocking rules  |
| `progress`                     | Upload/processing indicators         |
| `switch`                       | Settings toggles                     |

### Migration of existing custom components

| Current                 | Action                                                 |
| ----------------------- | ------------------------------------------------------ |
| `status-badge.tsx`      | Replace with shadcn Badge + custom variant classes     |
| `skeleton.tsx`          | Replace with shadcn Skeleton                           |
| `metric-card.tsx`       | Refactor to use shadcn Card as base                    |
| `icons.tsx`             | Keep — domain-specific SVGs, not replaceable by Lucide |
| `screen-header.tsx`     | Keep — layout component                                |
| `section-label.tsx`     | Keep — layout component                                |
| `unavailable-state.tsx` | Keep — layout component                                |

## 3. Additional Tooling

### Install now

**`@axe-core/playwright`** — a11y testing in existing E2E suite:

```bash
pnpm add -D @axe-core/playwright -w
```

Add to existing Playwright tests:

```typescript
import AxeBuilder from "@axe-core/playwright";

// In each page test:
const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
expect(results.violations).toEqual([]);
```

### Install later (when features need them)

| Library       | When                                         |
| ------------- | -------------------------------------------- |
| `next-themes` | Dark mode implementation (P2)                |
| Storybook 8   | When design system stabilizes and team grows |

## 4. File Changes Summary

| File                           | Action                                                       |
| ------------------------------ | ------------------------------------------------------------ |
| `apps/web/app/globals.css`     | Replace OKLCH values with Slate+teal palette                 |
| `apps/web/components.json`     | Already configured (no changes needed)                       |
| `apps/web/components/ui/*.tsx` | New files from shadcn CLI (Phase 1 components)               |
| `apps/web/hooks/`              | New directory for shadcn hooks (if any component needs them) |
| `package.json` (root)          | Add `@axe-core/playwright` dev dependency                    |
| `tests/e2e/*.spec.ts`          | Add axe-core a11y assertions to existing page tests          |

## 5. Verification

After implementation, verify:

1. `pnpm typecheck` passes
2. `pnpm build` succeeds
3. `pnpm test:e2e` passes (including new a11y assertions)
4. Visual check: radial gradient background still renders correctly over shadcn's `bg-background`
5. Visual check: glass-morphism classes still look correct with new slate surfaces
6. Visual check: teal accent appears on Button primary variant, focus rings, and badges
