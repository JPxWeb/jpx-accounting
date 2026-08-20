# Kapitas full-replacement — design (2026-08-20)

**Decision context**: Kapitas is EOL for us (free tier sunsetting, attachment cap already hit). JPx Advisory AB's FY1 (2025-10-15 → 2026-08-31) migration, all bookkeeping, receipt attachments, VAT reporting, and year-end close must run **in this product**. Statutory _filing_ stays manual (Skatteverket/Bolagsverket e-tjänster) or via API later — the product must hold correct, complete, attachable books that filings are read off. Capability evidence: [`2026-08-20-kapitas-replacement-readiness.md`](2026-08-20-kapitas-replacement-readiness.md) (G1–G12).

**User decisions (2026-08-20)**: system of record runs **locally now, Azure later** (Postgres via `pnpm db:up`; migrate to the hosted deployment once its migration/RBAC issues are fixed). Manual journal entries get a **web UI + API** (not API-only, not MCP-first).

## Architecture decisions

### D1 — Local normal mode with a new `LocalDiskBlobUploader`

Runtime mode `normal` against local Compose Postgres. Auth: a Supabase project supplies `SUPABASE_JWKS_URL` + web build-time pair (mandatory in normal mode — no bypass exists, by design). Azure OpenAI/DocIntel keys are reused from the existing deployment env so extraction + advisor work locally. Evidence storage gets a third `BlobUploader` implementation (alongside Azure/Stub): `LocalDiskBlobUploader`, enabled by `ACCOUNTING_BLOB_DIR`, storing bytes under that directory with the **same blobPath convention as Azure** so a later bulk-upload migrates evidence without rewriting event history. Upload/read URLs are same-origin API routes guarded by short-lived HMAC tokens (mirrors the SAS shape; the existing demo `PUT /api/uploads/:uploadId` route pattern is the anchor, but persisted and normal-mode-eligible). Path-traversal-safe (blobPath is server-generated, never client input). Backup = `pnpm db:backup` (pg_dump custom format) + the blob dir; restore runbook documented.

### D2 — Manual journal entries go THROUGH the review gate

`POST /api/vouchers/manual` accepts `{description, bookedAt, lines[] (account, debit/credit, vatCode?), evidenceIds?}`; validation = balanced posting (existing `assertBalancedPosting`/`postingImbalanceOre`), valid dates, account resolution via CoA with `classifyAccountNumber` first-digit fallback (same permissiveness as SIE import — imports already post anything). It creates a Voucher + ReviewTask (`needs-review`) whose suggestion carries the **verbatim lines**; approval posts them unchanged. This preserves the core invariant — _the review queue stays the only path to a posted voucher_ — and keeps actor attribution server-derived. `voucherSchema.evidencePacketId` becomes nullable (manual entries may have no evidence; migration 0009). Web UI: an N-line entry form on the Books screen (new `manual-entry` view), rows = account select (searchable, full CoA + free BAS-number entry), debit/credit amount, optional VAT code; live balance indicator; submit lands in the normal review queue.

### D3 — Posting-shape generalization for the capture flow

`buildPostingLines` gains: (a) **settlement account** — `ReviewDecisionEdit.settlementAccountNumber` (default 1930 bank; pickable 2899 utlägg / 1630 skattekonto) replacing the hardcoded bank credit; (b) **reverse-charge shape** — new vat code `RC25` producing 4 lines (cost debit, 2645 debit, 2614 credit, settlement credit) for EU service purchases (Google/Microsoft/Anthropic pattern — JPx's dominant recurring cost); (c) **revenue direction** — when the resolved account class is `revenue`, emit debit settlement / credit revenue with no VAT line for VAT0/export (sufficient for JPx's Norway invoices; domestic rated sales inherit the existing output-VAT handling later if needed — YAGNI). Review-edit sheet grows the settlement select and RC25 in the VAT select. Store parity Memory/Postgres per CONVENTIONS.

### D4 — VAT return completeness

`bas-2026.ts` adds the year-end + reverse-charge accounts (1229, 1259, 2126, 2518, 2614, 2645, 2647, 2899, 3305 export services non-EU, 8811, 8910; 2091/2099/1630/2510/7832/7835 already exist). `vat/regime.ts` gains reverse-charge account maps; `vat/boxes.ts` gets real accumulators for boxes 21 (base = RC output VAT ÷ rate, per-rate), 30–32 (own rate-keyed map — stop sharing `consumedRates` with 10–12), 39 (3308) and 40 (3305) as new box defs, and box 05/06 basis fixed to account-classification so imported (`vatCode:"NA"`) lines stay consistent. Golden-fixture unit test pins a full return incl. RC + export revenue. This makes the in-product momsrapport transcribable 1:1 into Skatteverket's e-tjänst.

### D5 — Migration: imported vouchers become first-class + evidence attach

`importSie` materializes a lightweight Voucher row per accepted voucher (id = existing `sie_<series>_<number>` aggregateId, `origin:"import"`, `status:"posted"` — provenance lives in `origin`, state in `status` (revised in Fable plan review 2026-08-20; an earlier draft said a third `"imported"` status), display number `“<series> <number>”`, `evidencePacketId` null) — no review rows, already-booked semantics unchanged. `evidenceComposeInputSchema` gains optional `targetVoucherId`; `composeEvidence` attaches the packet to that voucher (works for imported AND native vouchers). UI: an "Attach to voucher" action on evidence detail + a picker (voucher number/date/text search). Journal displays `A 42` instead of `sie_A_42`. SIE parse warnings surface in the import result/toast; CP437 map extended (æ/Æ; ø/Ø → explicit warning). Client capture gets a concurrency cap (~4 in flight) + 429 retry-with-backoff so the ~70-receipt backlog can be bulk-dropped.

### D6 — Fiscal-year truth for an irregular first year

`WorkspaceProfile.firstFiscalYearStart` (optional ISO date, settings UI on `/settings/fiscal-year`): floors the earliest `fy-`/`ytd` window and the SIE export `#RAR 0` so FY1 reports/export state 2025-10-15, while the recurring `09-01` anchor drives every later year. SIE export additionally becomes period-scoped (`?period=fy-2025`) and emits `#IB`/`#UB`/`#RES` blocks — needed for revisor/tool handoff and the later Azure move.

### D7 — Books/compliance essentials

Journal + huvudbok get the print treatment (PrintHeader + `window.print()`, matching reports-screen). Voucher numbering moves to posting time (rejected drafts no longer burn `V-` numbers; existing posted numbering preserved). Tax calendar gains the INK2 deadline kind and an `euTrade` workspace flag selecting the correct helårsmoms branch (26th-of-2nd-month vs income-declaration-coupled table); the two corpus articles with wrong/stale statutory facts are corrected and the knowledge corpus rebuilt.

### Explicitly deferred (not in this build)

Period lock + `CorrectionPosted` correction flow (manual reversal entries via D2 cover rättelse for now), close-checklist engine (close runs off a runbook + manual entries this season), K2 sub-grouped balance sheet (huvudbok + flat BS totals suffice to fill a micro-K2 manually; revisit before the årsredovisning is drafted), MCP server (API suffices; revisit after go-live), Azure blob WORM/immutability (applies to the Azure phase), automated iXBRL/INK2 filing.

## Error handling & testing

Every domain change lands with unit tests beside the existing suites (`tests/unit/`), store-parity coverage for Memory+Postgres (CONVENTIONS rules on store parity), a golden SIE fixture round-trip incl. `#IB/#UB/#RES`, a golden VAT-return fixture, and E2E specs for the manual-entry form, attach-to-voucher flow, and the RC25 review path. Validation errors keep the contract-pinned `{code:"validation_error", issues[]}` shape via `jsonValidated`. Final acceptance = the FY1 rehearsal: import the real Kapitas SIE, attach receipts, book a test manual entry, produce the FY1 VAT return, and reconcile 1930/balances against Kapitas's balansrapport to the öre.

## Success criteria

1. Local normal-mode instance survives restart with zero data loss; receipts stored on disk, backed up by script.
2. FY1 fully migrated: all Kapitas vouchers visible with proper numbers, receipts attached, balances match Kapitas to the öre.
3. Every JPx transaction shape bookable through UI (no SIE-snippet workarounds).
4. FY1 helårsmoms return produced by the product with correct boxes 05/21/30/39-40/48/49.
5. FY1 close entries (accrual conversion, avskrivningar, skatt, periodiseringsfond, resultatdisposition) bookable and reflected in statements; SIE export of FY1 acceptable to an external tool/revisor.
6. `pnpm check` green; new tests pin all of the above.
