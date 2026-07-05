# Copilot review instructions — jpx-accounting

This is an AI advisory accounting app with compliance-critical invariants. When reviewing,
prioritize flagging these over style:

1. **Review-gate bypasses** — any path that posts a voucher or mutates ledger state without
   going through `applyReviewDecision` / the review queue, or any AI/tool output that
   executes without an explicit human approval step.
2. **Append-only violations** — updates or deletes to ledger events or evidence, or code
   that recomputes/rewrites `previousHash`/`eventHash` chains.
3. **Store divergence** — behavior added to `MemoryLedgerStore` but not
   `PostgresLedgerStore` (or vice versa); ledger logic that belongs in `packages/domain`
   duplicated in a store.
4. **Contract drift** — API request/response shapes changed without updating
   `packages/contracts` Zod schemas (the single source of truth), or validation removed.
5. **Fail-open config** — `normal` runtime mode silently falling back to demo/stub behavior
   when Azure/Supabase config is missing (it must fail closed via `Unavailable*`).
6. **i18n parity breaks** — `messages/en.json` keys without `sv.json` twins or wholesale
   rewrites of the message catalogs.
7. **Seam leaks** — `@dnd-kit` imported outside `sortable-grid.tsx`; `ai`/`@ai-sdk` imported
   outside `components/advisor/` + `services/api/src/advisor/`; recharts imported into the
   dashboard.
8. **Visual-baseline hazards** — new UI rendering clock-derived values (dates, seed hashes)
   without `data-visual-mask`; blind snapshot updates.
9. **AI transparency** — new AI-generated surfaces missing Article 50 labeling, provenance,
   or honest disabled/empty states.

Conventions doc: `docs/CONVENTIONS.md` (28 rules). Cross-tool contract: `AGENTS.md`.
