# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

```bash
pnpm install                  # Install all workspace dependencies
pnpm dev:web                  # Start Next.js dev server
pnpm dev:api                  # Start Hono API with tsx watch
pnpm typecheck                # TypeScript check across all packages
pnpm build                    # Build web + API
pnpm check                    # Typecheck + build

# Testing
pnpm test:unit                # Unit tests: tsx --test tests/unit/*.test.ts
pnpm test:e2e                 # Playwright E2E (builds first, starts both servers)
pnpm test:e2e:headed          # E2E with visible browser
pnpm test:e2e:install          # Install Chromium for Playwright

# Run a single E2E test
pnpm build && npx playwright test tests/e2e/home.spec.ts

# Run a single unit test
tsx --test tests/unit/some-file.test.ts
```

## Architecture

pnpm monorepo (Node >=24, pnpm 10.29.2) — mobile-first Swedish accounting PWA with AI assistance.

### Workspace layout

- **apps/web** — Next.js 16 PWA (React 19, TailwindCSS 4, React Query 5, Motion 12). Swedish locale throughout.
- **services/api** — Hono HTTP server (port 3001). Routes in `src/app.ts`, runtime wiring in `src/runtime.ts`.
- **packages/contracts** — Zod v4 schemas: the single source of truth for all API shapes and domain types.
- **packages/domain** — Core accounting logic: `LedgerStore` interface, append-only event sourcing, BAS accounts, Swedish rules, projections.
- **packages/ai-core** — Provider-agnostic AI abstraction. Factory selects `LocalAiRuntime` (demo), `ResponsesAiRuntime` (Azure OpenAI), or `UnavailableAiRuntime` based on runtime mode + config.
- **packages/api-client** — TypeScript client with demo-mode fallback to in-memory store.
- **packages/reporting** — Report summarization helpers (journal, balances, VAT).
- **packages/ui-tokens** — Design tokens (colors, fonts, formatters) + CSS custom properties. Theme: Manrope + IBM Plex Mono, teal accent (#0f766e), glass-morphism surfaces, WCAG AA/AAA colors.

### Key design rules

- **Append-only events** are the source of truth; never overwrite evidence or ledger history.
- **AI suggests, never mutates** — AI outputs require human review before affecting ledger state.
- **Runtime mode is explicit**: `demo` uses scaffold fallbacks (MemoryLedgerStore, LocalAiRuntime); `normal` fails closed if config is missing.
- **Projections are derived** — journal, balances, VAT reports are calculated from events via `packages/domain/src/projections.ts`.
- **Swedish compliance first** — BAS chart of accounts, Bokföringslagen citations, VAT deductibility rules.

### Data flow: evidence → ledger

The core domain pipeline (wired in `MemoryLedgerStore`) works as follows:

1. **Evidence received** → `createEvidence()` stores an `EvidenceObject` (immutable file record with hash)
2. **Packet created** → Evidence is grouped into an `EvidencePacket` (supports multi-file compositions)
3. **Voucher extracted** → A `Voucher` with `extractedFields` and `voucherFields` is created from the packet
4. **Rules evaluated** → `evaluateVoucherRules()` checks Swedish compliance (missing VAT number, supplier, etc.) returning `RuleHit[]` with severity `blocking` | `warning` | `info`
5. **Suggestion generated** → `buildDeterministicSuggestion()` maps supplier/description keywords to BAS accounts (6540, 6071, etc.) with confidence scores
6. **Review created** → A `ReviewTask` enters the feed with status `needs-review`
7. **Human decides** → `applyReviewDecision()` posts ledger lines (approve/book-without-vat) or rejects. Single-use: replayed requests are idempotent.
8. **Projections derived** → `buildJournal`, `buildBalances`, `buildVat` recalculate from all ledger lines on each read

Each step appends a `LedgerEvent` to the hash chain. Events are never mutated.

### Runtime mode wiring

`services/api/src/runtime.ts` is the composition root. It produces `{ store, aiRuntime }`:
- **demo**: `MemoryLedgerStore` (seeded with sample data) + `LocalAiRuntime` (deterministic rules, no network)
- **normal** (Supabase configured): per-request `SupabaseLedgerStore` + `ResponsesAiRuntime` — full ledger loop (evidence → review → approve → reports) backed by Postgres; auth via `getClaims()` + `app_metadata` tenant
- **normal** (no Supabase): `UnavailableLedgerStore` (fails closed) + `ResponsesAiRuntime` when Azure config is present

The web `api-client` has a parallel fallback: in demo mode without a `baseUrl`, it instantiates `MemoryLedgerStore` directly in the browser — no API server needed.

### API structure

`services/api/src/app.ts` defines ~20 routes. Key patterns:
- Review actions are separate endpoints: `POST /api/reviews/:id/approve`, `/reject`, `/book-without-vat`
- `POST /api/testing/reset` recreates the in-memory store (demo mode only, gated by `ALLOW_TEST_RESET`)
- `POST /mcp` exposes an MCP endpoint with tools: `lookup_policy`, `lookup_vat_rule`, `lookup_supplier_history`, `query_reports`, `run_simulation`
- SIE import/export endpoints handle the Swedish standard accounting file format

### Web app routing

The web app uses Next.js App Router with a `(shell)` route group for the 5-tab layout: **Today** (review feed), **Capture**, **Books**, **Reports**, **Settings** (sub-routes for company, fiscal year, team, etc.). `/` redirects to `/today` via `apps/web/proxy.ts`. `/assistant` remains session history until the Cmd-K advisor palette (IA Phase 6) ships. API calls proxy through `app/api-proxy/[...path]/route.ts` to the Hono API. A `/share` page outside the shell handles Web Share Target intake.

**Development status:** see `docs/DEV_STATUS.md` for phase completion, code TODOs, and next-phase recommendations.

### Database (Supabase)

`supabase/migrations/20260324000000_schema_v2.sql` defines two schemas:
- **`ledger`** — source-of-truth tables: `events` (append-only, trigger prevents UPDATE/DELETE), `evidence_objects`, `evidence_packets`, `vouchers`, `review_tasks`, `suggestions`, `assistant_sessions`, `compliance_alerts`
- **`projections`** — read models: `journal_entries`, `account_balances`, `vat_summary`

RLS is enabled on all tables, isolating by `current_setting('app.organization_id')`. `SupabaseLedgerStore` uses `supabase.schema('ledger'|'projections').from(table)` with mandatory org/workspace filters on every query. Local dev: expose schemas in `supabase/config.toml`, run migrations, `supabase gen signing-key` → `signing_keys.json`, `node scripts/create-dev-user.mjs`.

### E2E test setup

Playwright runs sequentially (1 worker) against dedicated test servers: API on port 3201 (demo mode, test reset enabled), web on port 3200. Both desktop and mobile (Pixel 7) projects. Tests must `pnpm build` first since the web server uses `next start`.

### Deployment

Azure Bicep (`infra/azure/main.bicep`) provisions 2 App Services + Storage Account. GitHub Actions: `ci.yml` (typecheck → build → E2E on PRs) and `deploy.yml` (manual trigger, builds + deploys to Azure, smoke tests `/health`).

## Tooling

- **Linter/Formatter**: Biome (planned — see `docs/2026-03-29-tech-stack-audit.md`)
- **Build caching**: Turborepo (planned — add on top of pnpm workspaces)
- **Unit tests**: Node `node:test` + tsx (migration to Vitest 4.x planned)
- **E2E tests**: Playwright 1.58.2
- **TypeScript**: 5.9.3 (upgrade to 6.0 planned — breaking default changes in strict/module/target)
- **Pre-commit hooks**: Husky + lint-staged (planned)
- **Code review**: CodeRabbit (AI PR review, linting, code graph analysis)
- **Security scanning**: Aikido (SAST, SCA, secrets, DAST, container scanning, license compliance)
- **AI dev tools**: Claude Code (primary) + Cursor IDE. Serena MCP for semantic code analysis. Context7 for library docs.

## Environment

Key env vars (see `.env.example` for full list):
- `ACCOUNTING_RUNTIME_MODE`: `demo` | `normal` (default: demo)
- `ACCOUNTING_API_BASE_URL`: Internal API URL for server-side proxy (e.g., http://localhost:3001)
- `NEXT_PUBLIC_ACCOUNTING_RUNTIME_MODE`: Must match API's runtime mode
- `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_MODEL`: Required for normal mode AI
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`: Database (normal mode)

## Product Context

Swedish-market AI-native accounting SaaS targeting SMEs. Competing against Fortnox (~60% market share), Bokio, and Visma. Key differentiator: AI-first architecture with event-sourced compliance (vs incumbents retrofitting AI onto CRUD).

Regulatory: Bokforingslagen requires 7-year retention, append-only audit trails, and Sweden/EU data residency. The event-sourcing architecture satisfies these by design.

AI evolution roadmap: Phase 1 (current) = AI suggests, human reviews. Phase 2 = graduated autonomy (auto-approve >99% confidence, low-risk). Phase 3 = agent-first workflows.

See `docs/2026-03-29-tech-stack-audit.md` for full tech audit, startup sponsorship strategy, competitive analysis, and UX/UI design audit.

## Design System

The UI follows a Nordic-minimalist aesthetic with a custom design token system (`packages/ui-tokens`):

- **Visual language**: Subtle glass-morphism (`.glass-chrome`, `.glass-panel`), not heavy blur. Strategic minimalism — every element earns its place.
- **Typography**: Manrope (headings/body) + IBM Plex Mono (financial data). Tabular figures (`tnum`) enabled for number alignment.
- **Colors**: Teal accent + cool neutrals. Semantic colors for status (success/danger/warning/info). All WCAG AA/AAA compliant.
- **Layout**: Mobile-first with bottom dock nav (4 tabs). Desktop gets a 292px sidebar rail. Container queries for responsive cards.
- **Motion**: Motion 12 for spring physics and layout animations. CSS transitions for micro-interactions. Budget: under 300ms, always respect `prefers-reduced-motion`.
- **Components**: Currently all custom. Migration to shadcn/ui planned for consistency and velocity.
- **Accessibility**: EAA (European Accessibility Act) compliance required as Swedish company. Target WCAG 2.2 Level AA.
- **Dark mode**: Not yet implemented. Planned via design token extension (both themes designed together).
