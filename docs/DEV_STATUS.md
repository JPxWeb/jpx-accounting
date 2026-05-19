# Development Status

**Last reviewed:** 2026-05-19  
**Purpose:** Single source of truth for what is done, what is open, and what to build next. Update this file at the end of each dev phase.

## Verification baseline

Run before starting a new phase or opening a PR:

```bash
pnpm typecheck    # all 9 workspace packages
pnpm test:unit    # 15 tests (domain, runtime, PWA, auth middleware, formatters)
pnpm lint         # Biome
pnpm build        # web + API
pnpm test:e2e     # Playwright (builds first; demo API on 3201, web on 3200)
```

| Check | Status (2026-05-19) |
|-------|---------------------|
| `pnpm typecheck` | Pass |
| `pnpm test:unit` | 22/22 pass |
| `pnpm lint` | Run locally before merge |
| Demo runtime E2E | `today`, `books`, `reports`, `settings`, `navigation-and-share`, `pwa-service-worker` specs exist |

---

## Completed: pilot-ready stabilization

The sweep in [`PLAN.md`](./PLAN.md) is **largely complete**. Demo vs normal runtime is explicit, the web app fails closed in normal mode, and scaffold behavior is visible.

| Area | Done |
|------|------|
| `ACCOUNTING_RUNTIME_MODE` / `NEXT_PUBLIC_*` | Yes — `services/api/src/config.ts`, `apps/web/lib/runtime-config.ts` |
| `LedgerStore` interface + `MemoryLedgerStore` | Yes — `packages/domain/src/store.ts` |
| API dependency injection | Yes — `createApp({ store, aiRuntime, runtimeMode })` |
| Draft queue (IndexedDB + fallbacks) | Yes — `apps/web/lib/draft-queue*` + unit tests |
| Service worker safe caching | Yes — unit tests in `tests/unit/service-worker-cache.test.ts` |
| Money/date formatters (2 dp, sv-SE) | Yes — `packages/ui-tokens` + unit tests |
| Capture sheet a11y (dialog, focus trap) | Yes — `apps/web/components/app-shell.tsx` |
| Repo hygiene (`pnpm-lock.yaml`, `*.tsbuildinfo`, artifacts) | Yes — `.gitignore` |
| Biome + Husky + lint-staged | Yes — root `biome.json`, `package.json` scripts |

**Out of scope for that sweep (still open):** Supabase-backed production store, blob upload, OCR, Azure AI Search.

---

## In progress: IA restructure (5-tab shell)

**Spec:** [`superpowers/specs/2026-05-13-ia-restructure-design.md`](./superpowers/specs/2026-05-13-ia-restructure-design.md)  
**Plan:** [`superpowers/plans/2026-05-13-ia-restructure.md`](./superpowers/plans/2026-05-13-ia-restructure.md)

| Phase | Focus | Status |
|-------|--------|--------|
| **1** | 5-tab nav, redirects, `@digest`, route skeletons | **Done** — `/today`, `/capture`, `/books`, `/reports`, `/settings/*`, `proxy.ts` |
| **2** | Settings + company form | **Partial** — `CompanyForm` on `/settings/company`; fiscal year, team, integrations, compliance, retention, AI posture are roadmap stubs |
| **3** | Books tabs, period drill-through | **Done** — journal, GL, trial balance, suppliers, close (`nuqs` view state) |
| **4** | Today keyboard flow, filters | **Done** — `use-review-keyboard`, status/confidence filters, optimistic review mutations |
| **5** | Capture page (drafts + archive) | **Not started** — page is header-only; capture still via shell FAB |
| **6** | Global Cmd-K Advisor palette | **Not started** — no `cmdk` / command dialog; `/assistant` remains session history |
| **7** | P&L, balance sheet, charts, exports | **Not started** — VAT tab works; P&L/BS show "Coming in Phase 7"; reporting package has summarize helpers only |
| **8** | Remaining settings, simulations, integrations | **Not started** — stub settings pages; Books close view shows "Coming soon" |

**Open product question (from plan):** Tab label "Today" vs "Inbox" — still unresolved; tests grep "Today".

---

## Track B — Supabase & backend (runs parallel to Track A)

**Active plan:** [`superpowers/plans/2026-05-19-supabase-backend-track.md`](./superpowers/plans/2026-05-19-supabase-backend-track.md)  
**Superseded detail:** [`superpowers/plans/2026-03-29-auth-and-database.md`](./superpowers/plans/2026-03-29-auth-and-database.md) (reference only)

| Phase | Focus | Status |
|-------|--------|--------|
| **0** | Async `LedgerStore`, per-request store factory, await writes, org ID alignment | **Done** |
| **1** | Read path: feed, snapshot, evidence context, events | **Done** |
| **2** | `applyReviewDecision` + `projections.journal_entries` + `getReports` | **Done** |
| **3** | `organization_settings` migration + company save/load | **Done** |
| **4** | Web Supabase Auth + proxy Bearer token | **Done** (Next.js 16 `proxy.ts` + `@supabase/ssr`) |
| **5** | Azure Blob upload (`/api/uploads/init` SAS) | **Done** (stub without `AZURE_STORAGE_ACCOUNT`; user-delegation SAS when configured) |
| **6** | Seed, integration tests, normal-mode E2E, hosted eu-north-1 | **Done** (seed + `pnpm test:integration`; hosted checklist manual) |
| **7** | Hardening (JWT-claim RLS, assistant/compliance DB, supa_audit) | Partial — JWT-claim RLS migration landed; rest optional |

| Area | Status |
|------|--------|
| `packages/supabase-client` | Service + scoped (publishable key) clients |
| `SupabaseLedgerStore` | Full read/write path for core ledger loop + company settings |
| API `authMiddleware` | `getClaims()` + `app_metadata` tenant → per-request store |
| Web Supabase Auth | Login, callback, session in `proxy.ts`, API proxy Bearer injection |
| Schema + migrations | `ledger`/`projections` exposed; hash-chain unique index; org settings |

**Normal-mode today:** Configure `SUPABASE_URL` + secret key + JWT signing keys → evidence → review → approve → reports/SIE. Run `node scripts/create-dev-user.mjs` for local auth. Demo mode unchanged.

**Infrastructure stance:** Supabase Postgres + Auth for beta; Azure for web/API, Blob (swedencentral), OpenAI; Azure Postgres migration documented in plan Phase 7.6 only.

---

## Recommended next dev phase

Pick **one** primary track per sprint; the rows below are ordered for pilot readiness.

### Track A — Finish IA (product-visible, demo-safe)

Best when the goal is a cohesive demo/PWA without production database yet.

1. **Phase 5 — Capture page** — drafts list, archive, wire to existing draft queue and evidence APIs  
2. **Phase 6 — Cmd-K Advisor** — `cmdk` palette; move Q&A out of dedicated assistant flow  
3. **Phase 7 — Reports** — `profit-loss.ts`, `balance-sheet.ts`, `vat-return.ts` in `packages/reporting`; replace placeholders in `reports-screen.tsx`  
4. **Phase 8 — Settings depth** — fiscal year, team invite stub, integrations placeholders, compliance watch UI  

**Exit criteria:** No "Coming in Phase N" copy on primary routes; E2E covers capture + advisor palette; axe on Today after keyboard work (per IA plan).

### Track B — Supabase & backend (normal mode)

Runs **in parallel** with Track A. Follow phases 0→6 in [`superpowers/plans/2026-05-19-supabase-backend-track.md`](./superpowers/plans/2026-05-19-supabase-backend-track.md).

**Exit criteria:** `ACCOUNTING_RUNTIME_MODE=normal` + Supabase → capture → review → approve → Books/Reports/SIE without `MemoryLedgerStore`; optional login + blob upload per phases 4–5.

### Track C — Tooling and CI velocity (parallel, small slices)

From [`2026-03-29-tech-stack-audit.md`](./2026-03-29-tech-stack-audit.md) — update priorities:

| Priority | Item | Notes |
|----------|------|--------|
| P0 | TypeScript 5.9 → 6.0 | Low risk; explicit tsconfig already |
| P1 | Turborepo | No `turbo.json` yet; speeds CI |
| P1 | Vitest migration | Replace `tsx --test` when touching tests heavily |
| P2 | React Compiler | Optional perf win |
| P2 | Drizzle ORM | When Supabase queries multiply |

**Already landed since audit:** Biome, Husky, lint-staged, `@axe-core/playwright`, `.cursorignore`, `.cursor/rules/`.

### Deferred (do not block next phase)

- shadcn full migration plan (`superpowers/plans/2026-04-01-shadcn-setup.md`) — partial adoption (tabs, forms on company settings)  
- Unified radius / dev-tooling plans — polish  
- `PLAN1.md` stack strategy — reference only, not an implementation checklist  
- Deep research PDFs in `docs/deep-research-report*.md` — background market research  

---

## Documentation index

| Document | Role |
|----------|------|
| **This file** (`DEV_STATUS.md`) | Current state + next phase |
| [`architecture.md`](./architecture.md) | System boundaries and constraints |
| [`PLAN.md`](./PLAN.md) | Completed stabilization sweep (historical spec) |
| [`PLAN1.md`](./PLAN1.md) | AI/stack strategy reference (March 2026) |
| [`2026-03-29-tech-stack-audit.md`](./2026-03-29-tech-stack-audit.md) | Stack scorecard, sponsorship, UX audit |
| [`compliance-playbook.md`](./compliance-playbook.md) | Swedish regulatory context |
| [`superpowers/plans/2026-05-19-supabase-backend-track.md`](./superpowers/plans/2026-05-19-supabase-backend-track.md) | **Track B** — Supabase store, auth, blob, normal-mode E2E |
| [`superpowers/plans/`](./superpowers/plans/) | All implementation plans (checkbox tracking) |
| [`superpowers/specs/`](./superpowers/specs/) | Design specs for UI/IA changes |
| [`../CLAUDE.md`](../CLAUDE.md) | Agent-oriented repo guide (commands, architecture) |
| [`../README.md`](../README.md) | Quick start |

When a plan phase ships, update **this file** and the plan checkboxes; avoid duplicating status across multiple top-level PLAN files.

---

## Agent handoff checklist

Before marking a phase complete:

- [ ] `pnpm check` (typecheck + build) passes  
- [ ] Unit and relevant E2E specs updated  
- [ ] `docs/DEV_STATUS.md` phase table updated  
- [ ] `CLAUDE.md` / `architecture.md` updated if runtime or routing changed  
- [ ] No new silent demo fallbacks in `normal` mode  
- [ ] Swedish UI copy for user-facing strings  
