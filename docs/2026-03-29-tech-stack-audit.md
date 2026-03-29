# Tech Stack Audit — March 2026

## Executive Summary

The JPX Accounting tech stack is **well-aligned with 2026-2027 best practices**. Every major framework choice (Next.js, Hono, Zod, React, Tailwind, Supabase) is current-generation and matches what YC W26 startups are shipping. The architecture (event-sourced append-only ledger, AI-suggests-human-reviews, typed contracts) is exactly what VCs and regulators expect from AI-native fintech.

**No architectural rewrites needed.** The gaps are in tooling and one version upgrade.

---

## Stack Scorecard

| Component | Current | Latest | Verdict |
|-----------|---------|--------|---------|
| Next.js | 16 | 16.2.1 | Current. Patch upgrade only. |
| React | 19 | 19.2.4 | Current. Add React Compiler for free perf. |
| TailwindCSS | 4 | 4.2.2 | Current. Patch upgrade only. |
| TanStack Query | 5 | 5.95.2 | Current. Patch upgrade only. |
| Motion | 12 | 12.38.0 | Current. Ensure imports use `motion/react`. |
| Hono | 4.12.8 | 4.12.9 | Current. One patch behind. |
| Zod | 4.3.6 | 4.x stable | Current. Best-in-class for contracts. |
| OpenAI SDK | 6.32.0 | 6.33.0 | Current. One minor behind. |
| Node.js | >=24 | 24 LTS (24.14.1) | Current LTS. Node 25 is current/unstable. |
| pnpm | 10.29.2 | 10.33.0 | Current. Minor patches only. |
| TypeScript | 5.9.3 | **6.0.2** | **ACTION REQUIRED.** Major release with breaking defaults. |
| Playwright | 1.58.2 | 1.58.2 | Latest stable. |
| Supabase JS | (to be added) | 2.100.1 | Will be current once auth task lands. |

---

## Required Actions (Priority Order)

### P0 — TypeScript 5.9 to 6.0 Upgrade

TS 6.0 shipped March 2026 with breaking default changes:
- `strict: true` is now the **default** (we already set this — no impact)
- Default `module` changed to `esnext`, default `target` to `ES2025`
- Deprecated: ES5 targets, AMD/UMD, `baseUrl` resolution, `outFile` bundling
- **TS 7.0** (the Go rewrite, 10x faster) is next — TS 6.0 is the bridge release

Our tsconfig already sets `strict: true`, `module: ESNext`, and `target: ES2022` explicitly, so breakage risk is low. But we should upgrade to stay on the supported version and prepare for TS 7.

### P0 — Add Biome (Linter + Formatter)

The project has **no linter or formatter**. This is a gap for code quality, contributor onboarding, and startup credibility.

Biome v2.3.11 replaces both ESLint and Prettier:
- Single binary, 10-25x faster than ESLint+Prettier
- One `biome.json` config file
- 423+ lint rules including type-aware linting
- 97% Prettier-compatible formatting

Add: `biome.json` at root, `pnpm lint` and `pnpm format` scripts, CI check.

### P1 — Add Turborepo for Build Caching

pnpm workspaces handle linking but not task caching. With 8 packages, `pnpm typecheck` and `pnpm build` re-run everything every time.

Turborepo adds:
- Local + remote build caching (skip unchanged packages)
- Dependency-aware parallel task execution
- ~20 lines of config in `turbo.json`

This will significantly speed up CI and local dev.

### P1 — Migrate Unit Tests to Vitest

`node:test` with `tsx` works but lacks watch mode, snapshot testing, rich matchers, and mocking utilities. Vitest 4.x is now the de facto standard:
- Native TypeScript/ESM support
- Jest-compatible API (easy migration)
- Watch mode, code coverage, snapshot testing
- Recommended by Next.js docs

### P2 — Add React Compiler

React Compiler v1.0 shipped October 2025. Battle-tested at Meta (Quest Store):
- Up to 12% faster loads, 2.5x faster interactions
- Automatic memoization — eliminates manual `useMemo`/`useCallback`/`React.memo`
- Compatible with React 17+
- Zero runtime overhead (build-time only)

### P2 — Add Drizzle ORM for Type-Safe Database Access

Raw Supabase client queries lack type safety. Drizzle ORM:
- SQL-like DSL with full TypeScript inference
- Tiny bundle (~50KB), near-raw-SQL performance
- Official Supabase integration documented
- `drizzle-kit generate` produces SQL migrations compatible with Supabase CLI
- Keeps the explicit, no-magic philosophy of the codebase

### P3 — Evaluate Deployment Split (Vercel + Railway)

Current Azure App Service works but is complex and expensive for a startup. The 2026 pattern:
- **Vercel** for Next.js frontend (first-class support, preview deploys per PR, edge optimization)
- **Railway** or keep Azure for the Hono API backend

This is lower priority if Azure credits are available via Microsoft for Startups.

---

## Validated Choices (No Change Needed)

| Choice | Why It's Right |
|--------|---------------|
| **Next.js 16 + App Router** | Dominant React meta-framework. App Router is stable, Pages Router in maintenance mode. TanStack Start is growing but less mature. |
| **Hono** | Best lightweight TypeScript API framework. Multi-runtime portability (Node, Cloudflare, Deno). Production-ready. |
| **Zod v4** | Ecosystem leader for schema validation. Deep integration with Hono, React Hook Form, tRPC. ArkType/Valibot are alternatives but smaller ecosystems. |
| **Supabase** | Best all-in-one BaaS for startups (auth + Postgres + storage + realtime). Market share grew from 12% to 28% in Q1 2026. |
| **pnpm workspaces** | Best monorepo package manager. Content-addressable store, strict dependency resolution. |
| **Playwright** | Definitive E2E testing framework. Surpassed Cypress in downloads mid-2024. Faster, lower RAM, better cross-browser. |
| **PWA approach** | Very viable. Gartner projects 50%+ consumer apps will be PWAs by 2027. 36% higher conversion than native, 75% lower dev cost. |
| **MCP endpoint** | MCP has won as the industry standard for AI-to-tool integration. Donated to Linux Foundation. Adopted by OpenAI, Google, Microsoft. Forward-looking differentiator. |
| **Event sourcing** | Gold standard for fintech. Natural fit for accounting ledgers. Provides immutable audit trail required by Bokforingslagen. |
| **"AI suggests, human reviews"** | Correct for regulated accounting. Evolve toward graduated autonomy (auto-approve high-confidence, low-risk items) in Phase 2. |
| **Node.js runtime** | Still the production standard. Bun/Deno are competitive in benchmarks but Node's ecosystem maturity and operational tooling are unmatched. |
| **ESM** | Fully standard. Ecosystem transition is complete. |

---

## Startup Sponsorship Opportunities

### Apply Immediately

| Program | Credits | Why |
|---------|---------|-----|
| **Microsoft for Startups Founders Hub** | Up to $150K Azure credits | Already using Azure OpenAI. Direct fit. |
| **Vinnova Innovativa Startups** | Up to SEK 500K (~$47K) non-dilutive | Swedish government grants for innovative startups. <10 employees, <SEK 10M turnover. |
| **Vercel for Startups** | ~$2,400 platform credits | Using Next.js. First-class hosting. |
| **Cloudflare for Startups** | $5K-$250K | CDN, DDoS protection, edge workers. Founded <5 years, raised $50K-$5M. |

### Apply After Initial Traction

| Program | Credits | Why |
|---------|---------|-----|
| **AWS Activate** | $100K (Portfolio tier) | Useful for specific services even if not primary cloud. |
| **Google Cloud for Startups (AI Tier)** | Up to $350K over 2 years | If evaluating Vertex AI/Gemini as alternative to Azure OpenAI. |
| **Almi Invest** | SEK 1-10M initial investment | One of Sweden's most active early-stage investors. |

### Credit Stacking Strategy

Apply to multiple programs simultaneously. Realistic total: **$500K+ in cloud credits** across providers plus SEK 500K non-dilutive from Vinnova. Best practice: apply before scaling so credits cover real growth.

---

## Competitive Positioning

### Swedish Accounting Market

- **Fortnox**: ~60% market share, SEK 563M revenue Q1 2025 (+21% YoY). Retrofitting AI onto legacy CRUD.
- **Bokio**: Free tier, AI bookkeeping. Strong with sole proprietors.
- **Visma**: Enterprise-focused, Nordic-wide.
- **Spiris**: AI-driven newcomer, 149 kr/month.

### JPX Differentiators

1. **AI-native architecture** — Built with AI as the foundation, not bolted on. Event-sourced ledger with append-only guarantees.
2. **Compliance by design** — BAS chart of accounts, Bokforingslagen citations, VAT deductibility rules in the domain layer, not as afterthoughts.
3. **MCP-enabled** — Any AI assistant (Claude, ChatGPT, Copilot) can interact with the accounting system. No competitor offers this.
4. **Modern tech stack** — TypeScript monorepo, typed contracts, edge-ready API. Hiring signal + AI-development productivity.
5. **Graduated autonomy roadmap** — Start with human-in-the-loop, evolve to auto-approve high-confidence actions. Builds trust incrementally.

### Regulatory Compliance Checklist

- [x] Append-only event log (Bokforingslagen audit trail requirement)
- [x] 7-year retention compatible (never-delete architecture)
- [ ] Data residency in Sweden/EU (ensure Supabase region is `eu-north-1` Stockholm or `eu-central-1`)
- [ ] Skatteverket notification if EU-but-non-Swedish storage
- [ ] GDPR data processing documentation

---

## AI Architecture Evolution Path

### Phase 1 (Current): AI Suggests, Human Reviews
Every AI output requires explicit human approval. Builds training data and trust.

### Phase 2 (Next): Graduated Autonomy
- Auto-approve high-confidence (>99%), low-risk actions (recurring invoice coding, bank reconciliation)
- Human reviews exceptions and edge cases
- Confidence scores visible on every suggestion
- Clear audit trail of autonomous vs. human-reviewed decisions

### Phase 3 (Future): Agent-First Workflows
- AI handles full month-end close with human oversight at checkpoints
- Dashboard shows what the agent did, not what the human needs to do
- Multi-agent collaboration: categorization agent, reconciliation agent, VAT agent
- "Vertical agent that owns the full workflow" — the YC W26 winning pattern

---

## UX/UI & Design Audit

### Current Design System Assessment

| Aspect | Current State | Verdict |
|--------|--------------|---------|
| **Typography** | Manrope + IBM Plex Mono | Excellent. Recognized pairing for fintech. Keep. |
| **Color system** | Teal accent (#0f766e) + cool neutrals | Strong. On-trend for 2026 fintech. All WCAG AA/AAA compliant. |
| **Glass morphism** | Custom `.glass-chrome`, `.glass-panel` utilities | On-trend but refined — "subtle glass" not heavy blur. Good. |
| **Component library** | All custom, no shadcn/ui or headless library | Gap. Should adopt shadcn/ui for consistency and velocity. |
| **Icons** | 6 custom SVG icons | Insufficient. Needs a full icon library. |
| **Charts** | None | Gap. Accounting app needs financial data visualization. |
| **Dark mode** | Light only (`color-scheme: light`) | Gap. 82% of users expect dark mode in 2027. |
| **Accessibility** | Good foundations (ARIA, semantic HTML, WCAG colors) | Needs: axe-core testing, `prefers-reduced-motion`, EAA compliance audit. |
| **Animations** | Motion 12, spring physics, staggered lists | Good quality. Keep motion budget focused. |
| **Mobile UX** | Bottom dock, capture sheet, safe area handling | Strong mobile-first approach. |

### P0 — Adopt shadcn/ui as Component Foundation

The project builds every component from scratch. This is slowing velocity and creating inconsistency risk. shadcn/ui is the dominant choice in 2026:

- Copy-paste components you own (not a dependency — code lives in your repo)
- Built on Radix UI or Base UI headless primitives (a11y built-in)
- Tailwind v4 native, CLI v4 supports AI-agent integration
- Customizable to your existing teal/glass design language
- Includes pre-built: buttons, forms, dialogs, sheets, dropdowns, data tables, command palette, toast, tabs

**Migration path**: Install shadcn/ui CLI, configure to match existing design tokens (teal accent, Manrope font, radius scale). Gradually replace custom components — no big-bang rewrite needed.

**Headless primitive choice**: Start with Radix UI (shadcn default). Monitor Base UI (MUI team, v1.0 stable Dec 2025) as a long-term migration target — better maintained, full-time team.

### P0 — Add Icon Library

6 custom icons is insufficient for an accounting app. Recommended: **Lucide** (1,450+ icons, default in shadcn/ui, tree-shakeable). Alternative: **Phosphor** (9,000+ icons, 6 weight variants including duotone — more visual personality).

### P1 — Add Charts (shadcn/ui Charts + Tremor)

An accounting app without charts is incomplete. Two complementary options:

- **shadcn/ui Charts** (built on Recharts): Matches your design system, copy-paste components for bar/line/area/pie charts
- **Tremor** (acquired by Vercel, now free): 35+ dashboard-specific components — KPI cards, sparklines, filter controls. Purpose-built for data-heavy SaaS dashboards

Start with shadcn Charts for journal/balance visualizations. Add Tremor KPI cards for the dashboard.

### P1 — European Accessibility Act (EAA) Compliance

The EAA became enforceable **June 28, 2025**. As a Swedish company serving EU businesses, this is mandatory:

- **Target**: WCAG 2.2 Level AA (via EN 301 549)
- **Current gaps**:
  - No automated a11y testing (add axe-core to Playwright E2E suite)
  - No `prefers-reduced-motion` support (users who disable motion see no adaptation)
  - No skip-to-content link
  - Focus management in custom capture sheet needs audit
- **Add**: `@axe-core/playwright` to E2E tests, `prefers-reduced-motion` media query respecting, structured heading hierarchy audit

### P2 — Dark Mode

Dark mode is a baseline expectation for 2027 SaaS (82% of mobile users prefer it). Implementation approach:

- Extend `packages/ui-tokens/styles.css` with dark-mode CSS custom properties
- Use `prefers-color-scheme` as default, with manual toggle in settings
- The teal accent needs luminance adjustment for dark backgrounds
- Glass morphism effects need dark-mode variants (invert opacity directions)
- Test all chart colors in both modes (common failure point)
- Design both themes simultaneously in the token system — do not bolt on later

### P2 — Semantic Color Layer for AI States

Current colors are defined by appearance (accent, success, danger). Add a semantic layer for AI-specific states:

```
--color-ai-suggestion: teal at full opacity (high confidence)
--color-ai-uncertain: teal at 60% opacity or amber outline (low confidence)
--color-ai-confirmed: green (human-approved)
--color-needs-review: amber (requires attention)
--color-amount-positive: green (credits/income)
--color-amount-negative: red (debits/expenses)
```

These semantic tokens map to different concrete colors in light vs dark mode.

---

## UX Design Principles (Derived from Research)

### 1. The Accept/Reject Loop is the Product

The AI suggestion → human review → accept/modify/reject flow is the core UX moment. Puzzle.io's biggest complaint is that when AI gets it wrong, **manual correction is difficult**. This is the design opportunity.

**Implementation**: Side-by-side receipt image + extracted fields. Amber highlight on low-confidence fields. Keyboard-driven approval (j/k navigate, y accept, n reject, e edit). For ambiguous "last 5%" transactions, show top 2-3 BAS category suggestions as tappable cards with Bokforingslagen references.

### 2. Nordic Restraint

Swedish/Nordic design language: generous whitespace, one accent color, functional minimalism. Klarna's system is the gold standard — bold brand expression within structured grids. Avoid "playful" UI — Swedish accounting professionals expect professional sobriety with modern polish.

### 3. Ambient Intelligence Over Chatbot

Three-layer AI interaction:
1. **Ambient**: Proactive alerts and insights on dashboard (silent, background)
2. **Inline**: Suggestions embedded in transaction review flow (contextual, not separate)
3. **Chat**: Only for complex exploratory questions about Swedish accounting rules (the assistant page)

Never make chat the primary AI surface. AI should mostly work silently.

### 4. Motion = Trust

73% of users associate smooth animations with trust. Budget:
- Number/currency value transitions on dashboards (counting up/down)
- Smooth list reordering when AI categorizes transactions
- Satisfying accept/reject feedback (subtle green flash, smooth slide-out)
- Keep everything under 300ms. Respect `prefers-reduced-motion`.

### 5. Data Density Over Decoration

Fintech users expect information-dense layouts with clear visual hierarchy. Mercury's "Financial OS" dashboard is the reference. No decorative illustrations. Every pixel earns its place.

---

## Competitive UX References

| App | What to Study |
|-----|--------------|
| **Mercury** | Best-in-class startup banking UX. Dashboard layout, instant onboarding. |
| **Ramp/Brex** | Expense approval flows, embedded AI categorization, spending controls. |
| **Puzzle.io** | AI-native accounting. Study their strengths (auto-categorization) and weaknesses (manual override UX). |
| **Klarna** | Swedish fintech design language. Custom typeface, 200+ icons, bold brand. |
| **Linear** | SaaS motion design reference. Minimal, keyboard-driven, premium feel. |
| **Fortnox** | The incumbent to beat. Study what's dated — traditional forms, retrofitted AI. |

---

## Full UX/UI Action Items

| Priority | Action | Effort |
|----------|--------|--------|
| **P0** | Adopt shadcn/ui (incremental, not big-bang) | Medium |
| **P0** | Add Lucide icons (via shadcn CLI) | Small |
| **P1** | Add shadcn Charts + Tremor for financial dashboards | Medium |
| **P1** | EAA compliance: axe-core testing, reduced-motion, skip-nav | Small |
| **P2** | Dark mode via design tokens (both themes designed together) | Medium |
| **P2** | Semantic color layer for AI states | Small |
| **P2** | Keyboard-driven approval flow (j/k/y/n/e) | Small |
| **P3** | Receipt review split-view (image + extracted data side-by-side) | Medium |
| **P3** | Animated number transitions on financial dashboards | Small |

---

## AI Development Tooling Audit

Development is fully AI-driven through Claude Code and Cursor. This section audits the current setup and recommends improvements.

### External Tooling Already In Place

**CodeRabbit** (AI code review on PRs):
- Line-by-line AI review, PR summaries, release note drafts
- Integrated linting (40+ tools including ESLint, Biome)
- Basic security detection via AI pass
- Code graph analysis for cross-file dependency understanding

**Aikido Security** (comprehensive application security):
- SAST (forked Semgrep engine with AI reachability analysis)
- SCA / dependency vulnerability scanning
- Secret detection with live validation (checks if exposed secrets are still active)
- Container scanning, DAST, IaC scanning
- License compliance and SBOM generation
- PR gating via GitHub Actions (blocks on severity threshold)

**Together, CodeRabbit + Aikido cover:** Code quality review, SAST, SCA, secret detection, container scanning, DAST, IaC scanning, license compliance. This eliminates the need for separate Semgrep, Gitleaks, Snyk, or CodeQL in CI.

**What they do NOT cover:**
- Pre-commit hooks (both are PR/CI-triggered, not local)
- AI development environment config (Cursor rules, Claude hooks)
- IDE settings and extension recommendations
- Domain-specific AI coding skills
- TypeScript typecheck as CI gate (must be configured separately)

### Deployment Pipeline (Current)

```
Commit → Push/PR to main
    ↓
[CI] Typecheck → Unit tests → Build → E2E tests (PR only)
    ↓
[CodeRabbit] AI code review on PR (line-by-line comments)
    ↓
[Aikido] Security scan on PR (SAST, SCA, secrets, blocks on severity)
    ↓
[Deploy] Azure Login → Bicep infra → Deploy API + Web → Smoke test /health
    ↓
[Azure] API: jpxacct-{env}-api (Node 24, tsx/esm, port 8080)
         Web: jpxacct-{env}-web (Next.js standalone, port 8080)
         Storage: swedencentral (evidence blobs, TLS 1.2, no public access)
```

**Pipeline strengths:** Sequential CI gates, Bicep IaC, health check smoke tests, artifact-based deployment.

**Pipeline gaps:** Azure auth uses static `AZURE_CREDENTIALS` secret (should be OIDC), GitHub Actions not pinned to SHAs, no environment approval gates configured, `AlwaysOn: false` means cold starts.

### Current AI Dev Environment Assessment

| Aspect | Current State | Verdict |
|--------|--------------|---------|
| **Claude Code plugins** | 9 plugins (superpowers, frontend-design, context7, github, playwright, supabase, etc.) | Strong. |
| **MCP servers** | Serena in `.mcp.json`. Playwright, Context7, GitHub, Chrome DevTools via plugins. | Good. Add Supabase MCP. |
| **Claude Code hooks** | None configured | Gap. Auto-typecheck on edit. |
| **Cursor rules** | No `.cursor/rules/` | Gap. Monorepo needs targeted rules. |
| **Cursor ignore** | No `.cursorignore` | Gap. AI indexes noise. |
| **VS Code / Cursor settings** | No `.vscode/` directory | Gap. No format-on-save, no extensions. |
| **Editor config** | No `.editorconfig` | Gap. No consistent indent/encoding. |
| **Pre-commit hooks** | None | Gap. Local guardrails before PR. |
| **CI security scanning** | Aikido handles via PR gating | Covered. |
| **Code review** | CodeRabbit handles on PR | Covered. |
| **Supabase token** | Hardcoded in `.claude/settings.local.json` | Risk. Move to env var. |
| **Custom Claude skills** | None in `.claude/skills/` | Opportunity. |
| **GitHub Actions security** | Static `AZURE_CREDENTIALS`, actions not SHA-pinned | Improvement needed. |

### Remaining Action Items

| Priority | Action | Effort |
|----------|--------|--------|
| **P0** | Add Claude Code hooks (auto-typecheck PostToolUse) | Small |
| **P0** | Create `.cursorignore` | Small |
| **P0** | Create `.cursor/rules/` with workspace-targeted MDC files | Small |
| **P0** | Add Husky + lint-staged pre-commit hooks (Biome format + typecheck) | Small |
| **P1** | Configure Supabase MCP server, remove hardcoded token from settings | Small |
| **P1** | Create `.vscode/settings.json` + `extensions.json` | Small |
| **P1** | Add `.editorconfig` | Small |
| **P1** | Create domain-specific Claude skills (BAS lookup, migration, compliance) | Medium |
| **P1** | Switch Azure GitHub Actions auth to OIDC (replace static credentials) | Small |
| **P1** | Pin GitHub Actions to commit SHAs (not mutable tags) | Small |
| **P2** | Add fast-check property-based testing for domain invariants | Medium |
| **P2** | Add subdirectory CLAUDE.md files for domain and ai-core | Small |
| **P2** | Add GitHub Environment protection rules for deploy approvals | Small |
