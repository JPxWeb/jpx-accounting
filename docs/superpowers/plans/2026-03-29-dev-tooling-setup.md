# Dev Tooling Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up local development guardrails, AI coding environment, and deployment security improvements — everything not already covered by CodeRabbit (code review) and Aikido (security scanning).

**Architecture:** Layer 1 = Claude Code hooks (instant AI feedback), Layer 2 = Cursor config (AI context quality), Layer 3 = pre-commit hooks (deterministic local gates), Layer 4 = CI/deployment hardening.

**Tech Stack:** Biome (lint/format), Husky + lint-staged (pre-commit), Cursor MDC rules, Claude Code hooks, Azure OIDC.

---

## Task 1: Create `.editorconfig`

**Files:**
- Create: `.editorconfig`

- [ ] **Step 1: Create the file**

Create `.editorconfig`:

```ini
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 2: Commit**

```bash
git add .editorconfig
git commit -m "chore: add .editorconfig for consistent formatting"
```

---

## Task 2: Create `.cursorignore`

**Files:**
- Create: `.cursorignore`

- [ ] **Step 1: Create the file**

Create `.cursorignore`:

```gitignore
# Dependencies and build outputs
node_modules/
.next/
dist/
out/

# Large/binary files
*.zip
*.log
pnpm-lock.yaml
docker_default.log
api-logs*.zip

# Secrets
.env
.env.*

# Infrastructure (rarely edited, complex Bicep)
infra/

# Test artifacts
test-results/
playwright-report/

# Supabase local temp
supabase/.temp/

# Serena cache
.serena/
```

- [ ] **Step 2: Commit**

```bash
git add .cursorignore
git commit -m "chore: add .cursorignore to exclude noise from AI context"
```

---

## Task 3: Create `.cursor/rules/` for monorepo

**Files:**
- Create: `.cursor/rules/general.mdc`
- Create: `.cursor/rules/nextjs.mdc`
- Create: `.cursor/rules/api-hono.mdc`
- Create: `.cursor/rules/domain.mdc`
- Create: `.cursor/rules/contracts.mdc`
- Create: `.cursor/rules/testing.mdc`

- [ ] **Step 1: Create general rules (always applied)**

Create `.cursor/rules/general.mdc`:

```
---
description: "Project-wide conventions for JPX Accounting monorepo"
alwaysApply: true
---

# JPX Accounting Conventions

- Swedish locale throughout (sv-SE formatting, Swedish UI labels)
- Append-only events are the source of truth — never overwrite evidence or ledger history
- AI suggests, never mutates — AI outputs require human review before affecting ledger state
- Runtime mode is explicit: `demo` uses in-memory scaffolds, `normal` fails closed if config missing
- All types live in `@jpx-accounting/contracts` (Zod v4 schemas) — import types from there, not local definitions
- Use `createId(prefix)` and `nowIso()` from `@jpx-accounting/domain` for IDs and timestamps
- Financial amounts: always use tabular figures, IBM Plex Mono for display, `numeric(18,2)` in database
- No decorative UI — Nordic restraint, functional minimalism, data density over decoration
```

- [ ] **Step 2: Create Next.js rules**

Create `.cursor/rules/nextjs.mdc`:

```
---
description: "Next.js App Router patterns for the web app"
globs: "apps/web/**"
---

# Next.js Conventions

- App Router with (shell) route group for main tab layout
- Server Components by default — add "use client" only for interactivity (useState, useEffect, event handlers)
- API calls go through the proxy at `app/api-proxy/[...path]/route.ts` — never call the Hono API directly from client code
- Use React Query (TanStack Query v5) for server state
- Tailwind CSS v4 for styling — use design tokens from `@jpx-accounting/ui-tokens`
- Glass morphism: use `.glass-chrome`, `.glass-panel`, `.glass-panel-soft` utilities from globals.css
- Mobile-first: design for bottom dock nav, then enhance for desktop sidebar
- Motion 12 for animations — spring physics, keep under 300ms, respect prefers-reduced-motion
```

- [ ] **Step 3: Create API rules**

Create `.cursor/rules/api-hono.mdc`:

```
---
description: "Hono API server patterns and route conventions"
globs: "services/api/**"
---

# Hono API Conventions

- Routes defined in `src/app.ts`, runtime wiring in `src/runtime.ts`
- Store accessed via `currentStore` closure variable — all methods may be async (return `T | Promise<T>`)
- Body parsing: use `parseBody(request, zodSchema)` helper for validation
- Error handling: throw `HTTPException` for 400/404/503. Global `onError` catches and returns `{ error, runtimeMode }`
- Review actions are separate endpoints: POST `/api/reviews/:id/approve`, `/reject`, `/book-without-vat`
- `POST /api/testing/reset` is demo-only, gated by `allowTestReset` config
- Auth middleware applies to `/api/*` routes — extracts userId, organizationId from JWT in normal mode, uses defaults in demo mode
```

- [ ] **Step 4: Create domain rules**

Create `.cursor/rules/domain.mdc`:

```
---
description: "Event sourcing and accounting domain logic rules"
globs: "packages/domain/**"
---

# Domain Package Rules

- LedgerStore interface is the contract — MemoryLedgerStore (demo) and SupabaseLedgerStore (normal) implement it
- Events are NEVER mutated after creation — append-only with hash chain integrity
- Projections (journal, balances, VAT) are derived from ledger lines — never treat them as source of truth
- BAS accounts defined in `bas.ts` — Swedish chart of accounts (Balansräkning och Resultaträkning Schema)
- Rules in `rules.ts` evaluate vouchers against Swedish compliance (Bokföringslagen, Skatteverket SKV 552B)
- Suggestions are deterministic (rule-based), not AI-generated — `buildDeterministicSuggestion()` maps keywords to BAS accounts
- Review decisions are single-use (idempotent) — replayed requests must not post duplicate ledger lines
- Hash chain uses DJB2 (non-cryptographic) — adequate for demo, upgrade to SHA-256 for production
```

- [ ] **Step 5: Create contracts rules**

Create `.cursor/rules/contracts.mdc`:

```
---
description: "Zod v4 schema conventions for the contracts package"
globs: "packages/contracts/**"
---

# Contracts Package Rules

- This package is the SINGLE source of truth for all API shapes and domain types
- Every schema exports both the Zod schema AND the inferred TypeScript type: `export type Foo = z.infer<typeof fooSchema>`
- Use Zod v4 syntax (z.object, z.enum, z.string, etc.)
- Schema names: camelCase ending in "Schema" (e.g., `voucherSchema`, `reviewTaskSchema`)
- Type names: PascalCase matching the schema without "Schema" suffix (e.g., `Voucher`, `ReviewTask`)
- Enum schemas for constrained values — never use string unions in other packages, import the enum schema
- All monetary amounts are numbers (not strings) — validation happens at API boundary
```

- [ ] **Step 6: Create testing rules**

Create `.cursor/rules/testing.mdc`:

```
---
description: "Test patterns for unit and E2E tests"
globs: "tests/**"
---

# Testing Conventions

- Unit tests: Node.js native `test()` from `node:test` + `assert` from `node:assert/strict`
- Run single unit test: `tsx --test tests/unit/some-file.test.ts`
- E2E tests: Playwright with `@playwright/test` — `expect()` assertions
- E2E runs against dedicated test servers: API on port 3201 (demo mode, ALLOW_TEST_RESET=true), web on port 3200
- E2E tests MUST call `resetApiState(request)` in `beforeEach` to start clean
- E2E requires build first: `pnpm build && npx playwright test`
- Both desktop and mobile (Pixel 7) projects run sequentially (1 worker)
- Test file naming: `*.test.ts` for unit, `*.spec.ts` for E2E
```

- [ ] **Step 7: Commit**

```bash
git add .cursor/
git commit -m "chore: add Cursor rules for monorepo workspace targeting"
```

---

## Task 4: Create `.vscode/settings.json` and `extensions.json`

**Files:**
- Create: `.vscode/settings.json`
- Create: `.vscode/extensions.json`

- [ ] **Step 1: Create extensions recommendations**

Create `.vscode/extensions.json`:

```json
{
  "recommendations": [
    "anthropic.claude-code",
    "bradlc.vscode-tailwindcss",
    "biomejs.biome",
    "ms-playwright.playwright",
    "usernamehw.errorlens",
    "eamodio.gitlens"
  ]
}
```

- [ ] **Step 2: Create editor settings**

Create `.vscode/settings.json`:

```json
{
  "editor.defaultFormatter": "biomejs.biome",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "quickfix.biome": "explicit",
    "source.organizeImports.biome": "explicit"
  },
  "typescript.tsdk": "node_modules/typescript/lib",
  "files.associations": {
    "*.css": "tailwindcss"
  },
  "files.eol": "\n",
  "search.exclude": {
    "**/node_modules": true,
    "**/.next": true,
    "**/dist": true,
    "pnpm-lock.yaml": true
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add .vscode/
git commit -m "chore: add VS Code/Cursor settings and extension recommendations"
```

---

## Task 5: Install and configure Biome

**Files:**
- Create: `biome.json`
- Modify: `package.json` (root)

- [ ] **Step 1: Install Biome**

Run: `pnpm add -Dw @biomejs/biome`

- [ ] **Step 2: Create Biome config**

Create `biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "organizeImports": {
    "enabled": true
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": {
        "noUnusedImports": "error",
        "noUnusedVariables": "warn"
      },
      "style": {
        "noNonNullAssertion": "warn",
        "useConst": "error"
      },
      "suspicious": {
        "noExplicitAny": "warn"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 120
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "trailingCommas": "all",
      "semicolons": "always"
    }
  },
  "files": {
    "ignore": [
      "node_modules",
      ".next",
      "dist",
      "pnpm-lock.yaml",
      "*.d.ts"
    ]
  }
}
```

- [ ] **Step 3: Add scripts to root package.json**

Add to `scripts` in `package.json`:

```json
"lint": "biome check .",
"lint:fix": "biome check --fix .",
"format": "biome format --write ."
```

- [ ] **Step 4: Run Biome to check current state**

Run: `pnpm lint`
Expected: Some warnings/errors on existing code. Note the count but don't fix everything now.

- [ ] **Step 5: Fix auto-fixable issues**

Run: `pnpm lint:fix && pnpm format`

- [ ] **Step 6: Run typecheck to ensure nothing broke**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add biome.json package.json pnpm-lock.yaml
git add -u  # staged formatted files
git commit -m "chore: add Biome linter/formatter with project configuration"
```

---

## Task 6: Install Husky + lint-staged pre-commit hooks

**Files:**
- Modify: `package.json` (root)
- Create: `.husky/pre-commit`

- [ ] **Step 1: Install dependencies**

Run: `pnpm add -Dw husky lint-staged`

- [ ] **Step 2: Initialize Husky**

Run: `npx husky init`

- [ ] **Step 3: Configure lint-staged**

Add to root `package.json`:

```json
"lint-staged": {
  "*.{ts,tsx}": [
    "biome check --fix --no-errors-on-unmatched",
    "biome format --write --no-errors-on-unmatched"
  ],
  "*.{json,css,md}": [
    "biome format --write --no-errors-on-unmatched"
  ]
}
```

- [ ] **Step 4: Update pre-commit hook**

Replace contents of `.husky/pre-commit`:

```bash
pnpm lint-staged
```

- [ ] **Step 5: Test the hook**

Run: `echo "test" >> .editorconfig && git add .editorconfig && git commit -m "test hook" --dry-run`

The hook should run lint-staged. Then reset: `git checkout .editorconfig`

- [ ] **Step 6: Commit**

```bash
git add .husky/ package.json pnpm-lock.yaml
git commit -m "chore: add Husky + lint-staged pre-commit hooks"
```

---

## Task 7: Add Claude Code hooks

**Files:**
- Modify: `.claude/settings.json`

- [ ] **Step 1: Read current settings**

Read `.claude/settings.json` to understand current structure.

- [ ] **Step 2: Add hooks configuration**

Add a `"hooks"` key to `.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "cd /c/git/jpx-accounting && pnpm typecheck 2>&1 | tail -30",
            "timeout": 60000
          }
        ]
      }
    ]
  }
}
```

Note: We use `Stop` instead of `PostToolUse` on every edit because running `pnpm typecheck` after every single file edit would be too slow in a monorepo. Running it when Claude finishes a task catches errors before the user reviews.

- [ ] **Step 3: Commit**

```bash
git add .claude/settings.json
git commit -m "chore: add Claude Code Stop hook for auto-typecheck"
```

---

## Task 8: Pin GitHub Actions to commit SHAs

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/deploy.yml`

This prevents supply chain attacks where a malicious actor pushes a new commit to a tag you reference.

- [ ] **Step 1: Look up current SHA for each action**

Run:
```bash
gh api repos/actions/checkout/git/ref/tags/v4 --jq '.object.sha' && \
gh api repos/actions/setup-node/git/ref/tags/v4 --jq '.object.sha' && \
gh api repos/pnpm/action-setup/git/ref/tags/v4 --jq '.object.sha' && \
gh api repos/actions/upload-artifact/git/ref/tags/v4 --jq '.object.sha' && \
gh api repos/actions/download-artifact/git/ref/tags/v4 --jq '.object.sha' && \
gh api repos/azure/login/git/ref/tags/v2 --jq '.object.sha' && \
gh api repos/azure/arm-deploy/git/ref/tags/v2 --jq '.object.sha' && \
gh api repos/azure/webapps-deploy/git/ref/tags/v3 --jq '.object.sha'
```

- [ ] **Step 2: Replace tag references with SHA + comment**

In both CI and deploy workflows, replace patterns like:
```yaml
uses: actions/checkout@v4
```
with:
```yaml
uses: actions/checkout@<full-sha> # v4
```

- [ ] **Step 3: Run CI to verify**

Push to a test branch and verify CI passes.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/
git commit -m "security: pin GitHub Actions to commit SHAs"
```

---

## Task 9: Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 2: Run unit tests**

Run: `pnpm test:unit`
Expected: PASS

- [ ] **Step 3: Run Biome lint**

Run: `pnpm lint`
Expected: PASS (or only pre-existing warnings)

- [ ] **Step 4: Test pre-commit hook**

Make a small change to any `.ts` file, stage it, and commit. Verify Husky runs lint-staged.

- [ ] **Step 5: Build**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 6: Verify Cursor loads rules**

Open Cursor, check that `.cursor/rules/` files appear in the rules panel. Edit a file in `apps/web/` and verify the `nextjs.mdc` rule context is loaded.
