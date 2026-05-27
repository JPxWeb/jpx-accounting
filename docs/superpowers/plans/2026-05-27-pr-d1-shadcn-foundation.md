# PR-D1 shadcn/ui foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the shadcn/ui design-system foundation on `main` (deps, OKLCH theme, `@/` path alias, 18 primitives, Sonner toaster mount, skip-to-content a11y link) as a two-commit PR with a midpoint visual-inspection gate. No screen refactors.

**Architecture:** Approach C from brainstorming — single PR, two commits. Commit 1 ships the foundation (deps + tokens + theme + config). Commit 2 ships the primitive library + the toaster mount + the skip-to-content link. Visual inspection via Chrome DevTools MCP between Commit 2 and push. All primitive code copied verbatim from `deploy` branch (production-proven). Spec: [`docs/superpowers/specs/2026-05-27-pr-d1-shadcn-foundation-design.md`](../specs/2026-05-27-pr-d1-shadcn-foundation-design.md).

**Tech Stack:** Next.js 16, React 19, Tailwind 4 (CSS-vars first, no JS config), `@base-ui/react` (shadcn base-nova variant — not classic Radix), pnpm 10.29.2, prettier, ESLint. Branch: `port/d1-shadcn-foundation` off `origin/main`.

---

## File Structure

**Commit 1 (foundation):**

| File                       | Action | Responsibility                                                                                                                                                                                  |
| -------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/package.json`    | MODIFY | 15 new runtime deps + 1 dev dep                                                                                                                                                                 |
| `apps/web/tsconfig.json`   | MODIFY | Add `paths: { "@/*": ["./*"] }` so primitive imports `@/lib/utils` resolve                                                                                                                      |
| `apps/web/components.json` | CREATE | shadcn CLI config (base-nova / neutral / lucide / cssVariables)                                                                                                                                 |
| `apps/web/lib/utils.ts`    | CREATE | `cn(...inputs: ClassValue[])` helper (twMerge + clsx)                                                                                                                                           |
| `apps/web/app/globals.css` | MODIFY | Append `tw-animate-css` + `shadcn/tailwind.css` imports, `@custom-variant dark`, OKLCH `:root` block (light) and `.dark` block. Bespoke `@theme` radius block and existing selectors preserved. |

**Commit 2 (primitives + mount):**

| File                                      | Action  | Responsibility                                                                                                               |
| ----------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/components/ui/badge.tsx`        | CREATE  | shadcn Badge primitive (copy from deploy)                                                                                    |
| `apps/web/components/ui/button.tsx`       | CREATE  | shadcn Button primitive + CVA variants                                                                                       |
| `apps/web/components/ui/card.tsx`         | CREATE  | shadcn Card primitive set                                                                                                    |
| `apps/web/components/ui/dialog.tsx`       | CREATE  | shadcn Dialog (base-ui-backed)                                                                                               |
| `apps/web/components/ui/form.tsx`         | CREATE  | shadcn Form primitives (react-hook-form wrappers)                                                                            |
| `apps/web/components/ui/input.tsx`        | CREATE  | shadcn Input                                                                                                                 |
| `apps/web/components/ui/kbd.tsx`          | CREATE  | shadcn Kbd                                                                                                                   |
| `apps/web/components/ui/label.tsx`        | CREATE  | shadcn Label                                                                                                                 |
| `apps/web/components/ui/select.tsx`       | CREATE  | shadcn Select                                                                                                                |
| `apps/web/components/ui/separator.tsx`    | CREATE  | shadcn Separator                                                                                                             |
| `apps/web/components/ui/sheet.tsx`        | CREATE  | shadcn Sheet                                                                                                                 |
| `apps/web/components/ui/sidebar.tsx`      | CREATE  | shadcn Sidebar primitives                                                                                                    |
| `apps/web/components/ui/sonner.tsx`       | CREATE  | shadcn Sonner Toaster wrapper                                                                                                |
| `apps/web/components/ui/table.tsx`        | CREATE  | shadcn Table (pairs with `@tanstack/react-table`)                                                                            |
| `apps/web/components/ui/tabs.tsx`         | CREATE  | shadcn Tabs                                                                                                                  |
| `apps/web/components/ui/toggle.tsx`       | CREATE  | shadcn Toggle                                                                                                                |
| `apps/web/components/ui/toggle-group.tsx` | CREATE  | shadcn Toggle Group                                                                                                          |
| `apps/web/components/ui/tooltip.tsx`      | CREATE  | shadcn Tooltip                                                                                                               |
| `apps/web/components/ui/skeleton.tsx`     | REPLACE | Replace main's bespoke `ScreenSkeleton` with deploy's version (preserves `ScreenSkeleton` export AND adds shadcn `Skeleton`) |
| `apps/web/app/layout.tsx`                 | MODIFY  | Add `<Toaster />` mount + Skip-to-content link + use `cn()` for html className                                               |

**Untouched on main (explicitly out of scope):**
`apps/web/components/ui/icons.tsx`, `metric-card.tsx`, `screen-header.tsx`, `section-label.tsx`, `status-badge.tsx`, `unavailable-state.tsx` — bespoke project files; deploy keeps them too. No refactor in D1.

---

## Conventions used by every task

- Single unit test file: `npx tsx --test tests/unit/<file>.test.ts`
- Full unit suite: `pnpm test:unit`
- Typecheck workspaces: `pnpm typecheck`
- Typecheck tests: `pnpm typecheck:tests`
- Build: `pnpm build`
- Pre-commit hooks reformat — don't fight Prettier's output.
- Conventional Commits (`feat(web):`, `style:`, etc.).
- Every step that ends with code changes ends with a verification command in the next step.

---

## Phase 1 — Branch + Commit 1 (foundation)

### Task 1: Create the branch

**Files:** none (git only)

- [ ] **Step 1: Verify on main + up to date**

```bash
cd /c/git/jpx-accounting
git fetch origin
git status -sb
```

Expected: `## main...origin/main` (no ahead/behind). If diverged, run `git reset origin/main` (soft) first.

- [ ] **Step 2: Branch off origin/main**

```bash
git checkout -b port/d1-shadcn-foundation origin/main
```

Expected: `Switched to a new branch 'port/d1-shadcn-foundation'`.

### Task 2: Add the 15+1 dependencies

**Files:**

- Modify: `apps/web/package.json`

- [ ] **Step 1: Add runtime deps to `apps/web/package.json`**

Open `apps/web/package.json`. Find the `"dependencies"` block. Add these lines (alphabetized, matching the existing style):

```json
    "@base-ui/react": "^1.3.0",
    "@hookform/resolvers": "^5.2.2",
    "@radix-ui/react-slot": "^1.2.4",
    "@tanstack/react-table": "^8.21.3",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^1.7.0",
    "next-themes": "^0.4.6",
    "nuqs": "^2.8.9",
    "react-hook-form": "^7.75.0",
    "react-hotkeys-hook": "^5.3.2",
    "sonner": "^2.0.7",
    "tailwind-merge": "^3.5.0",
    "tw-animate-css": "^1.4.0",
```

These slot into the existing alphabetical dependency list (between `@jpx-accounting/*` and `@tanstack/react-query` for the `@` entries; between `idb` and `motion` for the rest, etc.). Match the existing comma+newline style.

- [ ] **Step 2: Add `shadcn` to `devDependencies`**

In the same file, under `"devDependencies"`, add:

```json
    "shadcn": "^4.1.2",
```

(alphabetized — after `postcss`, before `tailwindcss`).

- [ ] **Step 3: Run install + verify**

```bash
pnpm install 2>&1 | tail -20
```

Expected: install completes without `ERR_PNPM_*` errors. Some peer-dep warnings about React 19 are acceptable. If install fails on a specific package's peer-deps, downgrade that one package's caret range to match deploy's exact version (`git show origin/deploy:apps/web/package.json | grep <package>`).

### Task 3: Add `@/` path alias

**Files:**

- Modify: `apps/web/tsconfig.json`

- [ ] **Step 1: Add `paths` to compilerOptions**

Open `apps/web/tsconfig.json`. Find the `"compilerOptions"` block. Add a `paths` entry (alongside `"plugins"`, `"incremental"`, `"tsBuildInfoFile"`):

```json
    "paths": {
      "@/*": ["./*"]
    },
```

Result should look like (showing the order):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "plugins": [
      {
        "name": "next"
      }
    ],
    "incremental": true,
    "tsBuildInfoFile": "node_modules/.cache/web.tsbuildinfo",
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Note: the parent `tsconfig.base.json` has its own `paths` for `@jpx-accounting/*`. TypeScript merges the two: workspace aliases from base + `@/` from web. Both resolve.

- [ ] **Step 2: Typecheck to confirm the merge**

```bash
pnpm typecheck 2>&1 | tail -10
```

Expected: green. The `@/` alias adds resolution capability but no current file uses it yet.

### Task 4: Create `apps/web/lib/utils.ts`

**Files:**

- Create: `apps/web/lib/utils.ts`

- [ ] **Step 1: Write the file**

Create `apps/web/lib/utils.ts` with:

```ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck 2>&1 | tail -5
```

Expected: green. `clsx` and `tailwind-merge` were installed in Task 2; importing them here verifies the install.

### Task 5: Create `apps/web/components.json`

**Files:**

- Create: `apps/web/components.json`

- [ ] **Step 1: Write the file**

Create `apps/web/components.json` with this exact content (copied from deploy verbatim — Task 7 of survey confirmed):

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "base-nova",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "iconLibrary": "lucide",
  "rtl": false,
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "menuColor": "default",
  "menuAccent": "subtle",
  "registries": {}
}
```

- [ ] **Step 2: No verification needed** — `components.json` is consumed by the `shadcn` CLI when you run `shadcn add <primitive>`, not by the runtime build. Move on.

### Task 6: Append shadcn theme to `apps/web/app/globals.css`

**Files:**

- Modify: `apps/web/app/globals.css`

> **CRITICAL:** main's `globals.css` (284 lines) starts with `@import "tailwindcss"` and `@import "@jpx-accounting/ui-tokens/styles.css"`, then has a bespoke `@theme { --radius-sm: 6px; ... }` block, a `:root` block, html/body gradients, `.glass-chrome`, `.glass-panel`, and other selectors. **None of those get touched.** This task is purely additive: insert the shadcn imports + OKLCH `:root` vars + dark variant declaration.

- [ ] **Step 1: Add new imports above the existing `@theme` block**

Find the current top of `apps/web/app/globals.css`:

```css
@import "tailwindcss";
@import "@jpx-accounting/ui-tokens/styles.css";

@theme {
  --radius-sm: 6px;
  ...
}
```

Insert two new `@import` lines and the dark variant declaration, immediately after the existing two imports and BEFORE the existing `@theme` block. The result should be:

```css
@import "tailwindcss";
@import "@jpx-accounting/ui-tokens/styles.css";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@custom-variant dark (&:is(.dark *));

@theme {
  --radius-sm: 6px;
  ...
}
```

- [ ] **Step 2: Append OKLCH `:root` block AFTER the existing `:root { color-scheme: light; }` block**

Find the existing `:root` block in `globals.css`. It currently contains only `color-scheme: light;`. Replace JUST that block with one that retains `color-scheme` AND adds all shadcn OKLCH vars. Copy this verbatim from deploy:

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

- [ ] **Step 3: Append `.dark` overrides block at end of file**

At the very end of `globals.css` (after all bespoke selectors), append a `.dark { ... }` block. Copy from deploy by running `git show origin/deploy:apps/web/app/globals.css` and looking for the `.dark` section. The block is approximately:

```css
.dark {
  --background: oklch(0.13 0.018 265);
  --foreground: oklch(0.97 0.005 264);
  --card: oklch(0.18 0.015 265);
  --card-foreground: oklch(0.97 0.005 264);
  --popover: oklch(0.18 0.015 265);
  --popover-foreground: oklch(0.97 0.005 264);
  --primary: oklch(0.7 0.1 175.8);
  --primary-foreground: oklch(0.13 0.018 265);
  --secondary: oklch(0.25 0.012 265);
  --secondary-foreground: oklch(0.97 0.005 264);
  --muted: oklch(0.25 0.012 265);
  --muted-foreground: oklch(0.65 0.012 264);
  --accent: oklch(0.25 0.012 265);
  --accent-foreground: oklch(0.97 0.005 264);
  --destructive: oklch(0.65 0.2 25);
  --border: oklch(0.3 0.012 265);
  --input: oklch(0.3 0.012 265);
  --ring: oklch(0.7 0.1 175.8);
  --sidebar: oklch(0.18 0.015 265);
  --sidebar-foreground: oklch(0.97 0.005 264);
  --sidebar-primary: oklch(0.7 0.1 175.8);
  --sidebar-primary-foreground: oklch(0.13 0.018 265);
  --sidebar-accent: oklch(0.25 0.012 265);
  --sidebar-accent-foreground: oklch(0.97 0.005 264);
  --sidebar-border: oklch(0.3 0.012 265);
  --sidebar-ring: oklch(0.7 0.1 175.8);
}
```

(If deploy's `.dark` differs from the above, use deploy's exact values: run `git show origin/deploy:apps/web/app/globals.css | sed -n '/^\.dark/,/^}/p'`.)

- [ ] **Step 4: Build to verify CSS parses**

```bash
pnpm build 2>&1 | tail -20
```

Expected: build completes. Next.js / PostCSS will fail if any `@import` doesn't resolve or any CSS syntax is invalid. If `@import "shadcn/tailwind.css"` fails, check that `shadcn` is in `devDependencies` (Task 2 Step 2).

### Task 7: Commit 1 + validation

- [ ] **Step 1: Run the full check chain**

```bash
pnpm typecheck && pnpm typecheck:tests && pnpm test:unit && pnpm build
```

Expected: all green. Test count unchanged (33).

- [ ] **Step 2: Prettier-format new/changed files**

```bash
npx prettier --write apps/web/package.json apps/web/tsconfig.json apps/web/components.json apps/web/lib/utils.ts apps/web/app/globals.css
```

Expected: 5 files reformatted (whitespace only; no logic change).

- [ ] **Step 3: Re-verify after format**

```bash
pnpm typecheck 2>&1 | tail -5
```

Expected: still green.

- [ ] **Step 4: Stage + commit**

```bash
git add apps/web/package.json apps/web/tsconfig.json apps/web/components.json apps/web/lib/utils.ts apps/web/app/globals.css pnpm-lock.yaml
git status --short
```

Expected: 6 files staged.

```bash
git commit -m "$(cat <<'EOF'
feat(web): shadcn/ui foundation — deps, OKLCH theme, @/ alias, cn helper

First commit of PR-D1 (shadcn/ui foundation port from deploy). Lands
the design-system foundation without any primitive files or screen
refactors so Commit 2 can add primitives + apply changes against
a verified-green baseline.

- apps/web/package.json: 15 new runtime deps (@base-ui/react,
  @radix-ui/react-slot, class-variance-authority, clsx, tailwind-merge,
  tw-animate-css, lucide-react, sonner, next-themes, nuqs,
  react-hook-form, @hookform/resolvers, react-hotkeys-hook,
  @tanstack/react-table) + shadcn CLI as devDep
- apps/web/tsconfig.json: @/* path alias so future primitive imports
  resolve (merges with base's @jpx-accounting/* aliases)
- apps/web/components.json: shadcn CLI config (base-nova / neutral /
  lucide / cssVariables) — matches deploy verbatim
- apps/web/lib/utils.ts: cn() helper (twMerge + clsx)
- apps/web/app/globals.css: appended tw-animate-css + shadcn/tailwind.css
  imports + @custom-variant dark + OKLCH :root vars (light + .dark).
  Bespoke @theme radius block + glass surfaces + html/body gradients
  preserved unchanged.

Excluded: @supabase/ssr (incompatible with main's PostgresLedgerStore).

Validation: typecheck + typecheck:tests + test:unit (33/33) + build all green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit lands cleanly. If pre-commit hooks reformat, that's fine; re-run commit if it complains.

---

## Phase 2 — Commit 2 (primitives + Sonner + skip-to-content)

### Task 8: Copy the 18 shadcn primitives from deploy

**Files:** 18 files created in `apps/web/components/ui/`

- [ ] **Step 1: Bulk-copy all primitives in one git checkout**

```bash
git checkout deploy -- \
  apps/web/components/ui/badge.tsx \
  apps/web/components/ui/button.tsx \
  apps/web/components/ui/card.tsx \
  apps/web/components/ui/dialog.tsx \
  apps/web/components/ui/form.tsx \
  apps/web/components/ui/input.tsx \
  apps/web/components/ui/kbd.tsx \
  apps/web/components/ui/label.tsx \
  apps/web/components/ui/select.tsx \
  apps/web/components/ui/separator.tsx \
  apps/web/components/ui/sheet.tsx \
  apps/web/components/ui/sidebar.tsx \
  apps/web/components/ui/sonner.tsx \
  apps/web/components/ui/table.tsx \
  apps/web/components/ui/tabs.tsx \
  apps/web/components/ui/toggle.tsx \
  apps/web/components/ui/toggle-group.tsx \
  apps/web/components/ui/tooltip.tsx
```

Expected: 18 files appear in `apps/web/components/ui/`. Git stages them as `A` (added).

- [ ] **Step 2: Verify they staged**

```bash
git status --short apps/web/components/ui/ | head -20
```

Expected: 18 lines, each starting with `A `.

### Task 9: Replace `apps/web/components/ui/skeleton.tsx`

**Files:**

- Replace: `apps/web/components/ui/skeleton.tsx` (currently bespoke on main; deploy has a merged version)

- [ ] **Step 1: Check the existing skeleton's exports**

```bash
grep -n "export" apps/web/components/ui/skeleton.tsx
```

Expected: at least `export function ScreenSkeleton`. Note this name.

- [ ] **Step 2: Replace with deploy's version**

```bash
git checkout deploy -- apps/web/components/ui/skeleton.tsx
```

Expected: file replaced. Git stages as `M ` (modified).

- [ ] **Step 3: Verify `ScreenSkeleton` is still exported**

```bash
grep -n "export.*ScreenSkeleton\|export.*Skeleton" apps/web/components/ui/skeleton.tsx
```

Expected: BOTH `ScreenSkeleton` and shadcn `Skeleton` exports present. If `ScreenSkeleton` is missing, append it manually to the file by copying it from `git show main:apps/web/components/ui/skeleton.tsx` and pasting into the new file.

### Task 10: Update `apps/web/app/layout.tsx` with Toaster + Skip-to-content

**Files:**

- Modify: `apps/web/app/layout.tsx`

- [ ] **Step 1: Read the current file to confirm imports**

```bash
cat apps/web/app/layout.tsx
```

Confirm: imports from `next/font/google`, `QueryProvider`, `ServiceWorkerRegistrar`, `APP_THEME_COLOR`. Does NOT import `cn`, `Toaster`, `NuqsAdapter`.

- [ ] **Step 2: Update imports**

In `apps/web/app/layout.tsx`, replace the existing import block at the top with:

```tsx
import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Manrope } from "next/font/google";
import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import { QueryProvider } from "../components/providers/query-provider";
import { ServiceWorkerRegistrar } from "../components/pwa/service-worker-registrar";
import { APP_THEME_COLOR } from "../lib/presentation";
import { cn } from "../lib/utils";
import "./globals.css";
```

(Note: `Manrope` and `IBM_Plex_Mono` swapped to alphabetical for parity with deploy. `NuqsAdapter` is **not** added — nuqs has no consumer in D1.)

- [ ] **Step 3: Update `RootLayout` to use `cn()` + mount Toaster + add Skip link**

Replace the existing `export default function RootLayout(...)` block with:

```tsx
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="sv" className={cn(manrope.variable, plexMono.variable, "font-sans")}>
      <body>
        <a
          href="#main-content"
          className="fixed left-2 top-2 z-[100] -translate-y-full rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition focus:translate-y-0"
        >
          Skip to content
        </a>
        <QueryProvider>
          <ServiceWorkerRegistrar />
          {children}
        </QueryProvider>
        <Toaster />
      </body>
    </html>
  );
}
```

The skip-to-content link is hidden off-screen until a keyboard user tabs to it (focus translates it on-screen). The target anchor `#main-content` must exist somewhere in the page tree; if no screen renders an `id="main-content"` element, the link still works as long as future PRs add the anchor.

### Task 11: Validate Commit 2 (without push)

- [ ] **Step 1: Run the full check chain**

```bash
pnpm typecheck 2>&1 | tail -10
```

Expected: green. The 18 new primitives all type-check against their deps installed in Task 2. If a primitive fails (e.g. `@base-ui/react/<sub-path>` not found), check that the install actually pulled `@base-ui/react` (Task 2 Step 3) — sub-paths may need different exports.

```bash
pnpm typecheck:tests 2>&1 | tail -5
```

Expected: green. No test files changed.

```bash
pnpm test:unit 2>&1 | tail -5
```

Expected: 33/33 pass.

```bash
pnpm build 2>&1 | tail -10
```

Expected: build completes for both web + API. Next.js may emit a route-types warning for the new `<Toaster />` mount; ignore unless it's an error.

- [ ] **Step 2: Prettier-format new/changed files**

```bash
npx prettier --write apps/web/components/ui/*.tsx apps/web/app/layout.tsx
```

Expected: ~19 files reformatted.

- [ ] **Step 3: Stage everything**

```bash
git add apps/web/components/ui/ apps/web/app/layout.tsx
git status --short | head -25
```

Expected: 19 files staged (18 added primitives + 1 modified skeleton + 1 modified layout = 20 entries, since skeleton appears as modified not added). If `git status` shows untracked junk under `apps/web/components/ui/`, do not add it.

### Task 12: Visual inspection (user-requested gate)

**Files:** none (runtime inspection only)

> **Goal:** confirm the radius + theme changes harmonize with main's existing visual style. The user specifically asked for this step. If anything regresses, narrow Commit 2's scope before pushing (e.g. revert the layout.tsx change and keep only the primitives if Toaster mount causes a flash).

- [ ] **Step 1: Start the dev server in the background**

```bash
pnpm dev:web
```

(Run with `run_in_background: true` from the Bash tool.) Server boots on port 3002. Wait for "Ready in N ms" in the output.

- [ ] **Step 2: Navigate to / and inspect via Chrome DevTools MCP**

Use the chrome-devtools MCP tools (or open `http://localhost:3002` in a browser if MCP isn't available):

- `new_page` → `http://localhost:3002`
- `take_screenshot` of the rendered page
- `evaluate_script` to check `getComputedStyle(document.documentElement).getPropertyValue('--radius')` returns `0.75rem`
- `evaluate_script` to check `getComputedStyle(document.documentElement).getPropertyValue('--background')` returns an `oklch(...)` value (proves OKLCH `:root` block is live)
- `list_console_messages` — assert no errors (warnings about React 19 are OK)

- [ ] **Step 3: Trigger a programmatic toast**

```js
// In the page console:
import("sonner").then(({ toast }) => toast("PR-D1 toast test"));
```

Or via `evaluate_script`. Expected: a toast renders bottom-right, no console error. This proves the `<Toaster />` mount works.

- [ ] **Step 4: Quick visual check**

Compare the screenshot against what main looked like pre-change. Expected:

- No layout shifts (Skip-to-content is hidden by `-translate-y-full`)
- Radius values look consistent across cards/buttons (main's bespoke `--radius-sm` etc. coexist with the new `--radius`)
- No flash of unstyled content
- Existing screens render normally (home/today/etc.)

- [ ] **Step 5: Stop the dev server**

Use the Bash tool's `KillShell` on the background shell ID, or send a signal to the process.

- [ ] **Step 6: Decision gate**

If visual is clean → proceed to Task 13.

If a regression is visible:

- **Layout shift:** the skip-to-content link may be visible — check the `-translate-y-full` class; revert layout.tsx and ship primitives + Toaster only.
- **Cards look weird:** new `--radius: 0.75rem` may clash with existing radius scale; remove `--radius` from `:root` block (Commit 1 amendment) and re-validate. Update the spec's §3.3 with the deferral note.
- **Toaster errors:** Sonner may not initialize; check `sonner` package install; defer Toaster mount, commit only the primitives + skip-link.

Document the deferral in the PR description before push.

### Task 13: Commit 2

- [ ] **Step 1: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(web): shadcn primitives + Sonner toaster + skip-to-content link

Second commit of PR-D1. Adds the 18 shadcn primitives copied verbatim
from deploy (badge, button, card, dialog, form, input, kbd, label,
select, separator, sheet, sidebar, sonner, table, tabs, toggle,
toggle-group, tooltip), replaces the bespoke skeleton.tsx with
deploy's version (preserves ScreenSkeleton export AND adds shadcn
Skeleton), mounts <Toaster /> in the root layout, and adds the
keyboard-accessible "Skip to content" link.

No existing screens are refactored. The primitives sit dormant in
@/components/ui/ until D2/D3 consumers import them.

apps/web/app/layout.tsx is the only runtime-active change:
- <Toaster /> renders at the body root; toast() calls work app-wide
- Skip-to-content link hidden off-screen via -translate-y-full,
  visible only when keyboard-focused; targets #main-content
- html className composed with cn() helper

Validation:
- typecheck + typecheck:tests + test:unit (33/33) + build all green
- Visual inspection via Chrome DevTools confirmed no layout shift,
  --radius and --background OKLCH vars resolve correctly,
  toast() works without console errors

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit lands. If pre-commit hooks reformat, re-run.

- [ ] **Step 2: Inspect the local commit graph**

```bash
git log --oneline origin/main..HEAD
```

Expected: exactly 2 commits — `feat(web): shadcn/ui foundation — deps, OKLCH theme, @/ alias, cn helper` and `feat(web): shadcn primitives + Sonner toaster + skip-to-content link`.

---

## Phase 3 — Push, PR, CI, Merge

### Task 14: Push the branch

- [ ] **Step 1: Push with upstream tracking**

```bash
git push -u origin port/d1-shadcn-foundation 2>&1 | tail -5
```

Expected: `* [new branch] port/d1-shadcn-foundation -> port/d1-shadcn-foundation`.

### Task 15: Open PR-D1

- [ ] **Step 1: Use `gh pr create`**

```bash
gh pr create --base main --head port/d1-shadcn-foundation \
  --title "Port PR-D1 (web): shadcn/ui foundation — deps, theme, primitives, toaster" \
  --body "$(cat <<'EOF'
## Summary

**PR-D1** of the deferred Track A IA web port. Lands the shadcn/ui design-system foundation on main so future PRs (D2: settings + RHF; D3: today/books/digest IA) can refactor screens to use primitives without per-PR dep churn.

**Approach C** from the spec brainstorm: two commits in one PR. Commit 1 ships the foundation; Commit 2 ships the primitive library + the toaster + the skip-link. Visual inspection at the midpoint per user request.

## Contents

**Commit 1 — `feat(web): shadcn/ui foundation`:**
- 15 runtime deps (@base-ui/react, @radix-ui/react-slot, class-variance-authority, clsx, tailwind-merge, tw-animate-css, lucide-react, sonner, next-themes, nuqs, react-hook-form, @hookform/resolvers, react-hotkeys-hook, @tanstack/react-table) + shadcn CLI as devDep
- @supabase/ssr **excluded** (incompatible with main's PostgresLedgerStore)
- @/ path alias in apps/web/tsconfig.json
- apps/web/components.json (shadcn CLI: base-nova / neutral / lucide)
- apps/web/lib/utils.ts (cn helper)
- apps/web/app/globals.css: appended tw-animate-css + shadcn/tailwind.css imports, @custom-variant dark, OKLCH :root (light + .dark). **Bespoke @theme radius block + glass surfaces + html/body gradients preserved unchanged.**

**Commit 2 — `feat(web): shadcn primitives + Sonner toaster + skip-to-content`:**
- 18 shadcn primitives copied verbatim from deploy (apps/web/components/ui/{badge,button,card,dialog,form,input,kbd,label,select,separator,sheet,sidebar,sonner,table,tabs,toggle,toggle-group,tooltip}.tsx)
- apps/web/components/ui/skeleton.tsx: replaced with deploy's version (preserves ScreenSkeleton export AND adds shadcn Skeleton)
- apps/web/app/layout.tsx: <Toaster /> mount + keyboard-accessible Skip-to-content link, html className via cn()

**Untouched on main (explicitly out of scope per spec §8):**
- The 7 bespoke ui/ files (icons, metric-card, screen-header, section-label, status-badge, unavailable-state) — kept as-is
- All screens (home-screen, app-shell, etc.) — no refactor
- Auth UI, nuqs URL state, RHF consumers, dark-mode toggle, Cmd-K shadcn migration — all D2+

## Spec + plan

- Spec: [docs/superpowers/specs/2026-05-27-pr-d1-shadcn-foundation-design.md](docs/superpowers/specs/2026-05-27-pr-d1-shadcn-foundation-design.md)
- Plan: [docs/superpowers/plans/2026-05-27-pr-d1-shadcn-foundation.md](docs/superpowers/plans/2026-05-27-pr-d1-shadcn-foundation.md)

## Test plan

- [x] pnpm typecheck green (10 workspaces)
- [x] pnpm typecheck:tests green
- [x] pnpm test:unit 33/33
- [x] pnpm build (web + API) green
- [x] Visual inspection via Chrome DevTools: --radius and --background OKLCH resolve; toast() works; no layout shift
- [ ] CI E2E (Playwright) green
- [ ] CodeRabbit pass

## Risks

- 18 primitive files added at once; CodeRabbit may flag many. They are shadcn registry output as deploy ran them in production.
- Bundle size grows by ~150-300 KB; tree-shakable.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: returns the new PR URL (e.g. `https://github.com/JPxWeb/jpx-accounting/pull/19`).

### Task 16: Watch CI

- [ ] **Step 1: Watch checks**

```bash
gh pr checks <PR-URL-NUMBER> --watch --interval 20 2>&1 | tail -10
```

Wait until all checks report `pass`. Typical timing: typecheck/tests ~1m, build ~40s, E2E ~1m20s, CodeRabbit ~30s. Total ~3m.

- [ ] **Step 2: If anything fails, diagnose and fix**

Common failures:

- **Prettier check:** run `npx prettier --write` on the flagged files, commit `style(...)`, push.
- **Typecheck on Linux but not Windows:** likely a case-sensitivity issue. Check imports use exact casing of file paths.
- **E2E:** a screen broke. Check the failure output. If it's selector-based, the Skip-to-content link may have intercepted a click — narrow its CSS.

### Task 17: Merge PR-D1

- [ ] **Step 1: Squash-merge**

```bash
gh pr merge <PR-URL-NUMBER> --squash --delete-branch 2>&1 | tail -3
```

Expected: branch deleted on remote; squashed merge lands on main.

- [ ] **Step 2: Resync local main**

```bash
git checkout main
git fetch origin
git reset origin/main
git log --oneline -3
```

(Note: `git reset` here is the SOFT form — if you accidentally diverged during execution, this re-anchors local main without losing work.)

Expected: local main shows the new PR-D1 squash commit at the tip.

### Task 18: Update DEV_STATUS post-merge

**Files:**

- Modify: `docs/DEV_STATUS.md`

- [ ] **Step 1: Update the "Remaining deploy work" table**

In `docs/DEV_STATUS.md`, find the row labeled **Track A IA web work** in the Remaining-deploy-work table. Replace its `Approx count` and `Disposition` cells to reflect that the shadcn foundation has landed via PR-D1, and the remaining D2/D3 work focuses on screen refactors + IA additions.

Suggested new disposition: "PR-D1 shipped the shadcn foundation (deps + theme + 18 primitives + Toaster). D2/D3 still pending: screen refactors to use primitives, settings layout, Books page, ambient digest, Today per-card actions, axe-core E2E."

- [ ] **Step 2: Commit + push the doc fix to its own tiny branch + PR**

```bash
git checkout -b chore/post-d1-status
git add docs/DEV_STATUS.md
npx prettier --write docs/DEV_STATUS.md
git add docs/DEV_STATUS.md
git commit -m "docs(status): record PR-D1 shadcn foundation landed; D2/D3 still pending"
git push -u origin chore/post-d1-status
gh pr create --base main --head chore/post-d1-status \
  --title "docs(status): PR-D1 shadcn foundation landed" \
  --body "Updates docs/DEV_STATUS.md Track A IA row to reflect PR-D1 ships the foundation. D2/D3 still pending."
```

- [ ] **Step 3: Watch + merge the doc PR**

Same as Tasks 16-17 for the doc PR.

---

## Self-Review

**Spec coverage:**

| Spec section                                                                       | Plan task(s)                                                                           |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| §3.1 deps                                                                          | Task 2                                                                                 |
| §3.2 theme + tokens (components.json, tsconfig paths, globals.css imports + OKLCH) | Task 3, 5, 6                                                                           |
| §3.3 radius (additive — `--radius: 0.75rem` in `:root`)                            | Task 6 (it's in the OKLCH block)                                                       |
| §3.4 utils (`cn` helper)                                                           | Task 4                                                                                 |
| §3.5 primitives (18)                                                               | Task 8                                                                                 |
| §3.5 skeleton merge                                                                | Task 9                                                                                 |
| §3.6 toaster mount + skip-to-content                                               | Task 10                                                                                |
| §3.7 Tailwind config (no JS config; rely on CSS-first)                             | No task needed — confirmed in survey                                                   |
| §6 testing strategy                                                                | Task 7, Task 11 (checks); Task 12 (visual inspection)                                  |
| §7 commit structure                                                                | Task 7 (Commit 1), Task 13 (Commit 2)                                                  |
| §8 deferred items                                                                  | Stated as out-of-scope throughout; no tasks                                            |
| §9 risks (globals.css merge, peer-dep, regression)                                 | Mitigation steps embedded in Task 2 Step 3, Task 6 prose, Task 12 Step 6 decision gate |

**Placeholder scan:** no "TBD", no "similar to Task N", no "implement as appropriate". Concrete file paths, concrete code blocks, concrete commands at every step.

**Type consistency:** `cn` is defined in Task 4 and imported in Task 10. `Toaster` is created in Task 8 (sonner.tsx) and imported in Task 10. `ScreenSkeleton` is preserved in Task 9 (Step 3 verifies). `@/lib/utils` path alias is set in Task 3 and used by primitives in Task 8 and layout in Task 10.

**Risks called out:**

- Task 6 Step 3 hedges on the exact `.dark` block content (says "if deploy's differs, use deploy's exact values" with a `git show` to verify)
- Task 11 Step 1 hedges on `@base-ui/react` sub-path failures
- Task 12 is the decision gate for visual regressions

**Out-of-scope strictly enforced:** no task touches `home-screen.tsx`, `app-shell.tsx`, or any other existing screen. The 7 bespoke `ui/` files (icons, metric-card, screen-header, section-label, status-badge, unavailable-state) are explicitly listed as untouched in the File Structure header.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-27-pr-d1-shadcn-foundation.md`.
