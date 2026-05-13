# Information Architecture Restructure — Design Spec

**Date:** 2026-05-13
**Status:** Draft for review
**Scope:** Replace the current 4-tab IA (`Inbox / Reports / Advisor / Control`) with a 5-tab user-journey IA, surface API capabilities that currently have no UI, and ship a real Settings page. Builds on the shadcn/ui foundation laid in `docs/superpowers/specs/2026-04-01-shadcn-setup-design.md`.

**Linked plan:** `docs/superpowers/plans/2026-05-13-ia-restructure.md`

---

## 1. Purpose

The current IA has four problems documented in the 2026-05-13 audit:

1. **Inbox is overloaded.** It mixes the review queue (core job) with close-copilot, balance pulse, and compliance alerts — four jobs on one page.
2. **Reports is thin.** Only journal summary + trial balance + VAT slices. Missing P&L, Balance Sheet, general ledger drill-through, SIE export, period scope, supplier/customer ledgers.
3. **Advisor is over-promoted.** Chat occupies a primary dock slot, contradicting the audit's stated "ambient > inline > chat" principle (`docs/2026-03-29-tech-stack-audit.md:287-294`).
4. **Settings is a brochure.** Three read-only paragraphs about runtime mode and architecture. No company profile, fiscal year, integrations, team, retention, or AI posture controls.

Additionally, ~10 API capabilities (SIE export/import, simulations, close runs, knowledge query, compliance refresh, general ledger, evidence compose, upload init) are wired but have **no user-facing page**.

This restructure produces a page-per-job IA, a real Settings page, a Books area distinct from Reports, an evidence archive surface, and a global Advisor palette.

## 2. Non-goals

- Re-doing the visual design (Slate+Teal OKLCH, Manrope+IBM Plex Mono, glass-chrome surfaces from prior specs all stay).
- Rebuilding `LedgerStore` or any domain logic.
- Building the Supabase-backed store (separate plan `2026-03-29-auth-and-database.md`).
- Implementing dark mode (separate P2 effort).
- Adding new domain features the API does not already expose.

## 3. Target navigation

### Primary dock / rail — five tabs

| Tab | User job | Maps from | New route |
|---|---|---|---|
| **Today** | "Clear today's review queue." | Inbox (review cards) | `/today` |
| **Capture** | "Add evidence and see what's pending." | Capture sheet + `/share` + new drafts surface | `/capture` |
| **Books** | "Inspect the ledger — accounts, suppliers, journal." | Reports (journal + trial balance halves) | `/books` |
| **Reports** | "Read statutory and management reports; export filings." | Reports (VAT half) + new sections | `/reports` |
| **Settings** | "Configure my company, team, integrations." | Settings (rebuilt; old content moves to `/settings/about`) | `/settings` |

`/` redirects to `/today`. Old `/assistant` redirects to `/today` and opens the global Advisor palette.

### Secondary surfaces — not in the dock

| Surface | Access | Purpose |
|---|---|---|
| **Advisor (Cmd-K)** | Global keyboard shortcut + button | Q&A, knowledge lookup, simulations, navigation jumps |
| **Period Close** | Linked from Books and ambient digest | Multi-day close workspace |
| **Review detail** | Click a card → `/today/review/[id]` (intercepting → modal on desktop) | Full provenance, edit, citations |
| **Evidence detail** | Click in Capture → `/capture/evidence/[id]` | Hash chain, audit trail |
| **Compliance** | Lives under Settings → Compliance Watch + ambient alerts | Alert detail, rule subscriptions |

### Ambient digest (parallel route slot)

A slim digest renders alongside every primary route via Next.js parallel routes (`@digest`). Contents:
- Next 3 review tasks (one-tap to Today)
- Close-ready / blocked counts (one-tap to Period Close)
- Newest compliance alert (one-tap to Settings → Compliance)

On mobile this becomes an expandable bottom sheet behind a "Today's pulse" chip. On desktop it docks below the rail content. This replaces today's overloaded Inbox sidebar.

## 4. Page-by-page specifications

### 4.1 Today (`/today`)

**Purpose:** Single-job page. The user sees pending reviews, accepts/modifies/rejects them. Nothing else.

**Content layout:**
- Top: filter bar — status (all / needs-review / blocked / approved), supplier search (Combobox), date range (Calendar popover), confidence band (≥95% / 80–94% / <80%).
- Middle: review queue. Each card matches today's review card design but adds a per-card action toolbar.
- Right (desktop) / hidden (mobile): the review detail modal opens from a card click via intercepting route.

**Per-card actions:**

| Action | Shortcut | Behavior |
|---|---|---|
| Accept | `y` or `enter` | `POST /api/reviews/:id/approve` — moves to approved, optimistic update |
| Modify | `e` | Opens review detail modal; user edits BAS account / VAT code / amount, then accepts |
| Reject | `n` | `POST /api/reviews/:id/reject` — moves to rejected |
| Book without VAT | `b` | `POST /api/reviews/:id/book-without-vat` — Sweden-specific rule path |
| Snooze | `s` | Local-only flag (does not write to API yet); hides until tomorrow |
| Next / Prev | `j` / `k` | Move focus through cards |

**Keyboard contract:** Focus model is `roving tabindex` on the card list, per WAI-ARIA Listbox pattern. `Escape` returns focus to the filter bar. The keyboard hints live in a `?` cheat-sheet popover (also opens via `?`).

**Empty state:** "Queue is clear. ✓ N receipts booked this week." with a link to Books → Journal.

**Loading:** Skeleton from `components/ui/skeleton.tsx` (already installed).

**Error:** `UnavailableState` component (already installed).

**Components used (shadcn):**
- `command` for supplier Combobox
- `popover` + `calendar` for date range
- `toggle-group` for status filter
- `dropdown-menu` for per-card overflow (View provenance, Copy voucher #, Audit log)
- `dialog` for review detail (desktop intercepting modal)
- `kbd` (custom small component) for shortcut hints
- `sonner` for optimistic-update toasts

**File map:**
- `apps/web/app/(shell)/today/page.tsx` (server component shell)
- `apps/web/components/screens/today-screen.tsx` (client; replaces `home-screen.tsx`)
- `apps/web/components/today/review-card.tsx`
- `apps/web/components/today/review-card-actions.tsx`
- `apps/web/components/today/review-filters.tsx`
- `apps/web/components/today/keyboard-hint-sheet.tsx`
- `apps/web/hooks/use-review-keyboard.ts`
- `apps/web/app/(shell)/today/review/[id]/page.tsx` (full page on mobile)
- `apps/web/app/(shell)/today/@modal/(.)review/[id]/page.tsx` (intercepting modal on desktop)

### 4.2 Capture (`/capture`)

**Purpose:** Single home for all evidence — drafts in progress, freshly captured, fully archived. Adding new evidence happens from here *and* via the global FAB (which stays).

**Top section — Quick add:**
- Four big tiles (camera / upload / paste / share) matching the current capture sheet but laid out as the page's hero.
- "Connect bank feed" CTA (links to Settings → Integrations).
- "Import SIE file" entry (uses `/api/imports/sie`).

**Middle section — Drafts in progress:**
- A table of local-only drafts from IndexedDB (current `draft-queue` already manages this).
- Each draft row: thumbnail, mode (camera/paste/upload/share), created-at, storage tier (indexeddb / session / memory), one-click "Upload to ledger" action that promotes to a real `EvidenceObject`.

**Bottom section — Evidence archive:**
- A paginated `data-table` over all `EvidenceObject` records.
- Columns: thumbnail, title, hash (first 8 chars + copy button), uploaded-at, voucher status, retention state (active / legal-hold / archived).
- Search + filter by mime type, date range, voucher status.
- Drill-through to `/capture/evidence/[id]` for full hash chain, packet composition, and audit timeline.

**Components used (shadcn):**
- `card` for hero tiles
- `data-table` (Tanstack Table) for drafts + archive
- `dialog` for "Upload to ledger" confirmation
- `tooltip` for hash-truncated cells
- `badge` for retention state

**File map:**
- `apps/web/app/(shell)/capture/page.tsx`
- `apps/web/components/screens/capture-screen.tsx`
- `apps/web/components/capture/quick-add-grid.tsx`
- `apps/web/components/capture/drafts-table.tsx`
- `apps/web/components/capture/evidence-archive-table.tsx`
- `apps/web/app/(shell)/capture/evidence/[id]/page.tsx`

### 4.3 Books (`/books`)

**Purpose:** Inspect the ledger. This is where accountants live. It's separate from Reports because Reports are *outputs* (statutory documents), while Books is *exploration* (drill through accounts).

**Sub-routes (tabs at top, URL state via `?view=`):**

| Tab | Route | Content |
|---|---|---|
| Journal | `/books?view=journal` | Full journal entries table with date, voucher #, account, debit, credit, description |
| General ledger | `/books?view=general-ledger` | Account-by-account view; expand a row to see all transactions for that account |
| Trial balance | `/books?view=trial-balance` | Current trial balance table (lifts from today's Reports page) |
| Suppliers | `/books?view=suppliers` | Per-supplier ledger; grouped by `voucherFields.supplierName` |
| Period close | `/books?view=close` | Close-run checklist (lifts from today's Inbox sidebar) |

**Period scope (persistent across tabs):**
- Top-right control: period selector (Month / Quarter / Fiscal Year / Custom range).
- Defaults to current month.
- Selector state stored in URL search param `?period=2026-05` so links are shareable.

**Drill-through model:**
- Click an account in Trial Balance → opens General Ledger filtered to that account, period preserved.
- Click a row in General Ledger → opens Journal filtered to that voucher.
- Click a voucher → opens review detail (if still in review) or read-only voucher detail.

**Components used:**
- `tabs` for sub-navigation (URL-driven, not local state)
- `data-table` with sticky header + column sort
- `select` for period selector
- `popover` + `calendar` for custom range
- `breadcrumb` for drill-through context

**File map:**
- `apps/web/app/(shell)/books/page.tsx` (reads `?view=` and dispatches)
- `apps/web/components/screens/books-screen.tsx`
- `apps/web/components/books/period-selector.tsx`
- `apps/web/components/books/journal-view.tsx`
- `apps/web/components/books/general-ledger-view.tsx`
- `apps/web/components/books/trial-balance-view.tsx`
- `apps/web/components/books/suppliers-view.tsx`
- `apps/web/components/books/close-view.tsx`
- `apps/web/hooks/use-period-scope.ts`

### 4.4 Reports (`/reports`)

**Purpose:** Statutory and management *outputs*. Reports are read for filing, board meetings, and accountant handoff — not for daily exploration (that's Books).

**Sub-routes (tabs at top, URL state):**

| Tab | Route | Content |
|---|---|---|
| Profit & Loss | `/reports?view=pl` | Resultaträkning, period-scoped, with prior-period comparison column |
| Balance Sheet | `/reports?view=bs` | Balansräkning at period end, with prior-period comparison |
| VAT return | `/reports?view=vat` | Skatteverket-format VAT return draft with row-by-row reconciliation to journal |
| Exports | `/reports?view=exports` | SIE 4 export, CSV journal, PDF P&L / BS |

**Chart on every report:**
- P&L: stacked bar by category, monthly trend line — `chart-bar-stacked` + `chart-line` from shadcn/ui Charts.
- BS: assets vs liabilities + equity area chart over time.
- VAT: bar chart of VAT collected vs deductible per period.

**Filing state for VAT:**
- The VAT return tab has a "Mark period as filed" button. State stored as a `LedgerEvent` (new event type `vat-period-filed`). Once filed, the period becomes read-only in this tab and the next period auto-advances.
- Audit trail of who filed when is shown inline.

**Exports:**
- **SIE 4** — `/api/exports/sie` (already exists). Button triggers download.
- **CSV** — client-side serialize from current view.
- **PDF** — server-rendered React-PDF (lib choice: `@react-pdf/renderer`, ~250KB, fully ESM).

**Components used:**
- `tabs` (URL-driven)
- `chart` primitives from shadcn/ui Charts (Recharts under the hood)
- `data-table` for VAT row reconciliation
- `button` with `download` attribute for exports

**File map:**
- `apps/web/app/(shell)/reports/page.tsx`
- `apps/web/components/screens/reports-screen.tsx` (rewritten)
- `apps/web/components/reports/profit-loss-view.tsx`
- `apps/web/components/reports/balance-sheet-view.tsx`
- `apps/web/components/reports/vat-return-view.tsx`
- `apps/web/components/reports/exports-view.tsx`
- `apps/web/components/reports/charts/pl-stacked-bar.tsx`
- `apps/web/components/reports/charts/bs-area.tsx`
- `apps/web/components/reports/charts/vat-bar.tsx`
- `packages/reporting/src/profit-loss.ts` (new derived projection)
- `packages/reporting/src/balance-sheet.ts` (new derived projection)
- `packages/reporting/src/vat-return.ts` (new derived projection — Skatteverket schema)

### 4.5 Settings (`/settings`)

**Purpose:** Real settings. The old "Control" content (runtime posture, deployment posture, audit spine) moves to `/settings/about` as a read-only platform-posture panel.

**Sub-routes (left-side sub-nav on desktop, sheet on mobile):**

| Route | Section | Content |
|---|---|---|
| `/settings` | Index | Redirects to first sub-route |
| `/settings/company` | Company | Org name, org number, address, contact, bank details, logo |
| `/settings/fiscal-year` | Fiscal year & VAT | FY start month, VAT reporting period (monthly/quarterly/annually), reporting deadlines |
| `/settings/integrations` | Integrations | Bank feeds, Skatteverket, accountant access, OAuth connections (placeholder rows where APIs don't exist yet) |
| `/settings/team` | Team & roles | Member list, invite flow, role matrix (Owner / Bookkeeper / Read-only) |
| `/settings/ai-posture` | AI posture | Confidence threshold for auto-approval (Phase 2), enabled AI surfaces, kill-switch |
| `/settings/retention` | Retention & legal hold | 7-year baseline, legal-hold toggle per voucher class, retention audit log |
| `/settings/compliance` | Compliance watch | Rule sources subscribed (Skatteverket, BFN, BAS), alert history |
| `/settings/about` | About this build | Runtime mode, region, build hash, audit-spine summary (the OLD settings content) |

**Form pattern:**
- All forms use React Hook Form + Zod resolvers (Zod schemas live in `packages/contracts/` so server and client agree).
- Server actions for submission where possible (Next.js 16 native).
- Optimistic UI for status changes; pessimistic for destructive actions (role removal, retention overrides).
- `sonner` for success/error toasts.

**Components used:**
- `form` (shadcn/ui form wrapper) + `react-hook-form` + `@hookform/resolvers/zod`
- `tabs` or `sidebar` sub-nav (chosen per device)
- `switch` for toggles
- `radio-group` for fiscal-year start month
- `alert-dialog` for destructive confirmations
- `avatar` for team members
- `table` for integration list and team list

**File map:**
- `apps/web/app/(shell)/settings/layout.tsx` (sub-nav shell)
- `apps/web/app/(shell)/settings/page.tsx` (redirect)
- `apps/web/app/(shell)/settings/company/page.tsx`
- `apps/web/app/(shell)/settings/fiscal-year/page.tsx`
- `apps/web/app/(shell)/settings/integrations/page.tsx`
- `apps/web/app/(shell)/settings/team/page.tsx`
- `apps/web/app/(shell)/settings/ai-posture/page.tsx`
- `apps/web/app/(shell)/settings/retention/page.tsx`
- `apps/web/app/(shell)/settings/compliance/page.tsx`
- `apps/web/app/(shell)/settings/about/page.tsx`
- `apps/web/components/settings/*` (one component per section)
- `packages/contracts/src/settings.ts` (Zod schemas for org, fiscal-year, ai-posture, retention)

## 5. Cross-cutting

### 5.1 Global Advisor palette (Cmd-K)

A `command` palette (cmdk via shadcn) opens with `⌘K` / `Ctrl+K` from any page. Modes:

| Mode | Activated by | Behavior |
|---|---|---|
| Navigation | Default on open | Fuzzy search across all routes + key actions ("Approve next review", "Open journal", "Mark VAT filed") |
| Ask the advisor | Type `?` prefix or click "Ask" pill | Routes to `/api/assistant/sessions`; renders streaming response in the palette with citations |
| Lookup | Type `/policy`, `/vat`, `/supplier` | Calls the corresponding MCP tool from `/mcp` (`lookup_policy`, `lookup_vat_rule`, `lookup_supplier_history`) |
| Simulate | Type `sim:` | Routes to `/api/simulations/run`; renders result |

The current `/assistant` route stays (deep-linkable) but the dock slot is repurposed for **Capture**. `/assistant` page becomes "Advisor history" — a list of prior sessions with citations.

### 5.2 Ambient digest (parallel route)

Defined as a Next.js parallel route `@digest` in the `(shell)` segment. Renders the close-copilot summary, top alert, and balance pulse. On mobile collapses to a chip. Implementation pattern:

```
apps/web/app/(shell)/
├── layout.tsx          (renders children + @digest slot)
├── @digest/
│   ├── default.tsx     (fallback when no segment match)
│   └── page.tsx        (the digest content)
└── today/page.tsx      (etc.)
```

This is plain Next.js 16 and requires no extra dependency. It moves three concerns off the Today page without making them a tab.

### 5.3 URL/state model

Every multi-state page uses search params as the source of truth (`?view=`, `?period=`, `?supplier=`, `?status=`). Three reasons:

1. **Shareable links** — accountants paste URLs in email.
2. **Back-button works** — history navigation matches user expectation.
3. **Server components stay possible** — search params are passed to the server.

Use `nuqs` (3.x, ~6KB, type-safe search-param state) to manage this. Already a well-known pattern; no need to hand-roll.

### 5.4 Keyboard model

| Key | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Open Advisor palette |
| `g t` | Go to Today |
| `g c` | Go to Capture |
| `g b` | Go to Books |
| `g r` | Go to Reports |
| `g s` | Go to Settings |
| `c` | Open Capture sheet (anywhere) |
| `?` | Open keyboard cheat sheet |
| `j` / `k` | Next / Prev in lists |
| `y` / `n` / `e` / `b` | Accept / Reject / Edit / Book-without-VAT on focused review |
| `Esc` | Close modal / palette / sheet |

Implemented with `react-hotkeys-hook` (5KB) for a single global handler. Honors `prefers-reduced-motion` and disables in input fields.

### 5.5 Loading, empty, error states

Every page must define all three:
- **Loading** — `Skeleton` matching the final layout's shape.
- **Empty** — illustration-free, one sentence, one CTA.
- **Error** — `UnavailableState` already in `components/ui/`.

Loading and error states are mandatory in E2E tests (axe-core checked).

### 5.6 i18n posture

All page copy stays English in this restructure. Swedish translation is a separate effort. But all currency, date, and number formatting must already use `sv-SE` locale via `apps/web/lib/presentation.ts` (existing).

## 6. Technical choices

### 6.1 Frameworks already locked

- Next.js 16 App Router, React 19, Tailwind 4, Motion 12, TanStack Query 5
- shadcn/ui w/ Base UI primitives, Slate+Teal OKLCH, Lucide icons (from prior spec)
- Zod 4 contracts, Hono API, sv-SE locale

### 6.2 New dependencies (justified additions)

| Package | Purpose | Size | Why this one |
|---|---|---|---|
| `cmdk` | Command palette base for shadcn `command` | ~9KB | shadcn default; works with Base UI |
| `nuqs` | Type-safe URL search-param state | ~6KB | Next.js 16 + App Router native, far less than building it ourselves |
| `react-hotkeys-hook` | Global keyboard shortcuts | ~5KB | Tiny, hook-based, supports scope (input fields) |
| `@tanstack/react-table` | Data tables (drafts, evidence, journal, GL, suppliers) | ~14KB | shadcn `data-table` pairs with it; we'll use it in 5+ places |
| `recharts` | Charting primitives | ~95KB | Powers shadcn `chart`; mature, accessible, SVG-based |
| `@react-pdf/renderer` | PDF report exports | ~250KB | Lazy-loaded only on Reports → Exports |
| `react-hook-form@^7` + `@hookform/resolvers@^5` | Form state and Zod validation | ~25KB combined | Industry standard, pairs natively with Zod |

Total added bundle (excluding lazy PDF): ~154 KB gzipped. The PDF renderer is dynamically imported only when the user clicks "Export PDF."

### 6.3 Dependencies *deferred*

- **Tremor** — initially considered for KPI cards but shadcn `card` + a few utility components cover our needs. Skip unless dashboard density needs grow.
- **DnD-kit** — not needed; no drag-and-drop in this IA.
- **TanStack Router** — Next.js routing is fine.

### 6.4 Composition pattern

- **Server components** by default for everything except client interactivity (review actions, filters, charts, forms).
- **Data fetching:** TanStack Query for client-side mutations (review actions) and live workspaces; server components fetch initial data via the same `apiClient` running on the server.
- **Suspense boundaries** on each parallel route slot so the digest doesn't block the main page.
- **View Transitions API** for in-shell navigation (Next.js 16 supports it natively via `experimental.viewTransitions`). Gracefully degrades.

## 7. Migration & redirects

Old routes redirect (308 permanent in production, 302 in development):

| Old | New |
|---|---|
| `/` | `/today` |
| `/assistant` | `/today?advisor=open` (opens cmd-K with last session) |
| `/settings` | `/settings/company` |

Implementation: `apps/web/proxy.ts` (new — Next.js 16 renamed `middleware.ts` to `proxy.ts`), ~20 lines.

**E2E impact:** Every test in `tests/e2e/` that visits `/` or `/assistant` must be updated. `tests/e2e/home.spec.ts` → `tests/e2e/today.spec.ts` (rename + assertion updates).

**API contracts unchanged.** No ledger or contract schema breaks.

**LedgerEvent additions:**
- `vat-period-filed` (new event type, additive)
- `evidence-promoted` (new event type for draft → ledger transition)

Both stay backward-compatible because the projection layer ignores unknown event kinds.

## 8. Acceptance criteria

A reviewer should be able to verify the restructure shipped by running through these:

1. Cold-load `/` → lands on `/today` with review queue and ambient digest visible.
2. Press `⌘K` from any page → palette opens, types "vat" → can run advisor query.
3. From Today, press `j` then `y` on a card → next review accepts, toast confirms.
4. Navigate Books → select an account in Trial Balance → drill to General Ledger filtered.
5. Navigate Reports → P&L → see chart; change period → see chart update; download SIE.
6. Navigate Settings → Company → edit org name → save → reload → persisted.
7. Navigate Settings → About → see the old runtime / deployment / audit-spine copy.
8. Capture page shows drafts + evidence archive with hashes.
9. All E2E tests pass (renamed + updated).
10. axe-core reports zero serious WCAG 2.2 AA violations on each new route.

## 9. Out of scope (separate efforts)

- Supabase-backed `LedgerStore` (plan exists)
- Dark mode (separate P2)
- Swedish translation
- Real bank/Skatteverket OAuth integrations (UI only here)
- Phase 2 graduated AI autonomy (the AI-posture *page* exists, but actual auto-approve logic is later)
- Mobile camera capture wiring (the *page* exists; OCR pipeline is separate)

## 10. Open questions for review

1. Is `/today` the right label, or should the dock keep saying **"Inbox"** for familiarity? (Recommendation: **Today** — clearer job framing, "Inbox" implies messages.)
2. Should **Period Close** be a top-level tab or stay under Books? (Recommendation: under Books for now; promote if monthly close becomes the dominant workflow.)
3. Should the Advisor palette also handle **navigation** (cmd-K jump-to-page) or only AI Q&A? (Recommendation: both, like Linear / Raycast.)
4. Do we want the **digest** on mobile at all, or hide it on small screens? (Recommendation: collapsed chip on mobile.)
