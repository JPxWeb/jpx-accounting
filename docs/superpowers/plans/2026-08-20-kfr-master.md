# Kapitas Full Replacement (KFR) — Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** JPx Advisory AB runs FY1 migration (with receipt attachments), all bookkeeping shapes, a complete VAT return, and year-end close entries entirely in this product on a durable local normal-mode instance.

**Architecture:** Seven decisions in [`docs/superpowers/specs/2026-08-20-kapitas-full-replacement-design.md`](../specs/2026-08-20-kapitas-full-replacement-design.md) (D1–D7), executed as six phase plans below. All posting paths keep the review-gate invariant; all store changes land in BOTH `MemoryLedgerStore` and `PostgresLedgerStore` (CONVENTIONS store parity); all schema changes follow contracts-first (CONVENTIONS rule 1).

**Tech stack:** existing monorepo (Zod v4 contracts, Hono API + `jsonValidated`, postgres-js, Next.js 16 + React 19, `tsx --test` unit tests, Playwright E2E).

## Phase plans (execution order)

| Phase | Plan file                                                                    | Delivers                                                                                                                                                                                |
| ----- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A     | [`2026-08-20-kfr-a-local-ops.md`](2026-08-20-kfr-a-local-ops.md)             | `LocalDiskBlobUploader` + local upload/read routes, normal-mode local config, `pnpm db:backup`, self-host runbook                                                                       |
| B     | [`2026-08-20-kfr-b-posting-engine.md`](2026-08-20-kfr-b-posting-engine.md)   | Manual vouchers through the review gate (contracts + stores + API), settlement account, `RC25` reverse-charge shape, revenue direction, CoA additions, migration 0009                   |
| C     | [`2026-08-20-kfr-c-vat-return.md`](2026-08-20-kfr-c-vat-return.md)           | VAT boxes 21/30–32/39/40 real computation, box 05 account-basis fix, golden-return test                                                                                                 |
| D     | [`2026-08-20-kfr-d-sie-migration.md`](2026-08-20-kfr-d-sie-migration.md)     | Voucher rows for SIE imports, evidence attach (`targetVoucherId`), parse warnings, CP437 æ/ø, first-FY floor, period-scoped export with `#IB/#UB/#RES`, capture concurrency + 429 retry |
| E     | [`2026-08-20-kfr-e-books-ui.md`](2026-08-20-kfr-e-books-ui.md)               | Manual-entry form (Books), attach-to-voucher picker, journal/huvudbok print, posting-time voucher numbering                                                                             |
| F     | [`2026-08-20-kfr-f-calendar-corpus.md`](2026-08-20-kfr-f-calendar-corpus.md) | INK2 deadline kind, `euTrade` helårsmoms branch, corpus statutory fixes + rebuild                                                                                                       |

Dependency notes (corrected in Fable review 2026-08-20): execution order is **A → B → C → D → E → F**. B before C (RC accounts feed box computation). **D hard-depends on B** (migration 0009's `origin` column + nullable `evidence_packet_id`, and the contracts `origin`/nullable fields — D's Postgres voucher materialization breaks without them; D's plan opens with a verification checklist for this). E after B and D (form posts to B's API; E edits the same `voucher-link.tsx` D touches; E.1 converts B's intake numbering — see numbering seam below). F is independent and can run any time after B's contracts land (defensive check-then-add for `euTrade`). A is independent; do it first (go-live gate).

## Global constraints

- Node ≥24, pnpm 10.29.2; run everything via `corepack pnpm`.
- Zod v4 semantics; body validation only via `jsonValidated(schema)` (`services/api/src/validation.ts`) — 400s keep `{code:"validation_error", issues[]}`.
- Append-only events; never rewrite history; hash chain untouched (`sha256_` canonical JSON).
- Actor attribution server-derived; request schemas never carry `actorId`.
- The review queue stays the ONLY path to a posted voucher (manual vouchers create reviews; SIE import remains the sole already-booked path).
- Store parity: every `LedgerStore` change implemented in `packages/domain/src/store.ts` (Memory) AND `packages/persistence-postgres/src/store.ts`, with shared logic in `store-shared.ts`/`store-planning.ts` where both can import it.
- Migrations: next number `0009`, idempotent (`if not exists` / DO-block guards), applied via `pnpm db:migrate`.
- Unit tests: `tsx --test tests/unit/<file>.test.ts`; keep `pnpm check` green per task; commits per task with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- UI: Swedish-first copy via `apps/web/messages/{sv,en}.json` (next-intl); reuse `useDialogFocusTrap` for modals; nuqs for URL state; no new deps without justification.

## Cross-phase interface contract (authoritative — phases MUST use these exact names)

**Contracts (`packages/contracts/src/index.ts`):**

- `vatCodeSchema`: add literal `"RC25"` (reverse-charge services 25%).
- `reviewDecisionEditSchema`: add `settlementAccountNumber: z.string().regex(/^\d{4}$/).optional()` (default behavior = `coa.roles.bank`).
- `accountingSuggestionSchema`: add `direction: z.enum(["expense","revenue"]).optional()` (absent = expense).
- New `manualVoucherLineSchema`: `{ accountNumber: /^\d{4}$/, debit: number ≥ 0, credit: number ≥ 0, vatCode: vatCodeSchema.default("NA") }` + refine: exactly one of debit/credit > 0.
- New `manualVoucherInputSchema`: `{ description: string 1–200, bookedAt: YYYY-MM-DD, lines: manualVoucherLineSchema[] (min 2, max 100), evidenceIds: string[] optional }` + refine: balanced (Σdebit≈Σcredit within 0.005).
- New `manualVoucherResultSchema`: `{ voucherId: string, reviewId: string }`.
- `voucherSchema`: `evidencePacketId` → `.nullable()`; add `origin: z.enum(["capture","manual","import"]).default("capture")`.
- `evidenceComposeInputSchema`: add `targetVoucherId: z.string().optional()`.
- `workspaceProfileSchema`: add `firstFiscalYearStart: YYYY-MM-DD string optional`, `euTrade: z.boolean().default(false)`.
- `taxDeadlineKindSchema`: add `"income-tax-return"`.
- `sieImportResultSchema`: add `warnings: z.array(z.string()).default([])`.

**Domain:**

- `LedgerStore` gains `createManualVoucher(input: ManualVoucherInput & {actorId: string}): Promise<ManualVoucherResult>` — creates Voucher (`origin:"manual"`, `evidencePacketId:null`) + ReviewTask (`needs-review`) whose suggestion carries the verbatim lines; approval posts those lines unchanged (`PostedToLedger`).
- `buildPostingLines` (in `store-shared.ts`) generalizes to shapes: `expense` (3-line, credit = settlement), `rc25` (4-line: cost debit, `2645` debit, `2614` credit, settlement credit), `revenue` (2-line: settlement debit, revenue credit, no VAT line); settlement account = `edit.settlementAccountNumber ?? coa.roles.bank`. Manual vouchers bypass it (verbatim lines).
- CoA additions (`coa/bas-2026.ts`) — **net-new only** (Fable review: `8910` and `3308` already exist on main): `1229, 1259, 2126, 2518, 2614, 2645, 2647, 2899, 3305, 8811` with real BAS Swedish names; `2126` is the year-suffixed periodiseringsfond convention — name it **"Periodiseringsfond 2026"**. `coa/types.ts` `CoaRoleMap` gains `reverseChargeOutput: "2614"`, `reverseChargeInput: "2645"`, `ownerSettlement: "2899"`.
- `importSie` additionally materializes a Voucher row per accepted voucher: `id = aggregateId (sie_<series>_<number>)`, `voucherNumber = "<series> <number>"`, `origin:"import"`, **`status:"posted"`** (the design doc's earlier `"imported"` status is superseded — provenance lives in `origin`, state in `status`; the `"posted"` literal is added to the status schema in Phase D), `evidencePacketId:null`. Idempotent on re-import.
- `resolvePeriodToken(token, {fiscalYearStart, firstFiscalYearStart?, today})`: earliest fy window's `from` clamps to `firstFiscalYearStart` when set; same clamp feeds SIE export `#RAR 0`.
- `buildSieExport(journal, opts)` gains `{range?, openingBalances?, closingBalances?, results?}` and emits `#IB 0`, `#UB 0`, `#RES 0` per account when provided; API `GET /api/exports/sie?period=<token>` (absent = full history, unchanged).
- VAT (`vat/regime.ts` + `vat/boxes.ts`): boxes 30–32 get their own rate-keyed reverse-charge map (accounts `2614` at 25% initially); box 21 base = per-rate `RC output VAT ÷ rate` (i.e. box30/0.25); box 48 input accounts = `[2641, 2640, 2645, 2647]`; new box defs `39` (accounts `3308`) and `40` (accounts `3305`) computed account-based; boxes 05/06 switch to account-classification basis (revenue-class accounts with domestic rated VAT codes OR matching output-VAT in voucher) so `vatCode:"NA"` imports stay consistent.
- Calendar (`tax/calendar.ts`): `"income-tax-return"` deadlines (digital INK2 by FYE month: sep–dec→1 Aug, jan–apr→1 Dec, maj–jun→15 Jan, jul–aug→1 Apr, weekend-shifted); yearly VAT branches on `euTrade`: true → existing 26th-of-2nd-month rule; false → income-declaration-coupled table (digital: sep–dec→17 Aug, jan–apr→12 Dec, maj–jun→17 Jan, jul–aug→12 Apr), each with cited source strings in `TAX_DEADLINE_SOURCES`.

**API (`services/api/src/app.ts`):**

- `POST /api/vouchers/manual` → `jsonValidated(manualVoucherInputSchema)` → `store.createManualVoucher` → 201 `manualVoucherResultSchema`.
- Local blob routes (normal mode with `ACCOUNTING_BLOB_DIR` set): `PUT /api/blobs/local/:token` (write-once, 16 MiB cap) and `GET /api/blobs/local/:token`; tokens are HMAC-signed `{blobPath, exp, method}` minted by `LocalDiskBlobUploader` (per-boot random secret; TTL 10 min) — mirrors the SAS shape; blobPath always server-generated.
- `createBlobUploader` precedence in normal mode: Azure env → Azure; else `ACCOUNTING_BLOB_DIR` → LocalDisk; else Unavailable (fail closed).

**Numbering (Phase E) — the one deliberate cross-phase seam:** `voucherNumber` is assigned at `PostedToLedger` time (`V-<n>`, per-workspace count of POSTED vouchers + 1000), not at intake; unposted vouchers carry the `DRAFT_VOUCHER_NUMBER` sentinel (`"Utkast"`); `planReviewDecision`'s trailing param becomes `ctx: { now?: string; postedVoucherCount?: number }`; `planEvidenceCreate`'s `ctx.voucherIndex` is deleted. **Phase B intentionally ships intake numbering for manual vouchers as an intermediate state** (`planManualVoucher` uses `ctx.voucherIndex`); **Phase E Task E.1 MUST convert `planManualVoucher` to the sentinel too** (named explicitly, not just "grep") and update B's Task-5 test pins (`V-1004` → `"Utkast"` at plan time, real number at approval). SIE-imported vouchers keep `"<series> <number>"` forever.

**Fable-review contract deltas (2026-08-20, binding):**

- `vatCodeSchema` is NEW (no such export exists on main); it excludes the legacy `"VAT-REVIEW"` string which stays on `accountingSuggestionSchema.vatCode` as loose `z.string()`.
- `accountingSuggestionSchema` additionally gains `lines: manualVoucherLineSchema[] optional` — the carrier for manual vouchers' verbatim lines (Phase B).
- New `InvalidManualVoucherError` → HTTP 422, distinct from the invariant-guard `UnbalancedPostingError` (500).
- `simulateApprovals` (`packages/domain/src/simulation.ts`) must honor manual-origin verbatim lines (Phase B Task 6 — silent-wrong-numbers bug otherwise).
- Local blob routes `PUT|GET /api/blobs/local/:token` are **JWKS-exempt** (the HMAC token IS the auth — a browser `<img>`/fetch can't attach a bearer; mirrors Azure SAS semantics); exemption implemented as an explicit path pattern alongside `/api/runtime-info`.
- `packages/api-client` `getEvidenceFileUrl` must resolve API-relative URLs against the API base (same pattern `uploadBlob` already uses) or local read URLs 404 on the web origin (Phase A).
- `ACCOUNTING_BLOB_DIR` activates `LocalDiskBlobUploader` in demo mode too; config field is flat `ApiRuntimeConfig.localBlobDir`.
- `apiClient.composeEvidence` does not exist today and is built in Phase E (E.2) alongside `createManualVoucher`.

## Verification (after all phases — the user asked for explicit post-completion verification)

1. `corepack pnpm check` (lint, format, typecheck ×2, unit, build) and `corepack pnpm db:test`.
2. E2E: `corepack pnpm build:e2e && corepack pnpm test:e2e` (new specs: manual entry, attach-to-voucher, RC25 review path).
3. **FY1 rehearsal** (manual, with the real Kapitas file): import SIE → voucher count & 1930 balance match Kapitas balansrapport to the öre → attach 3 sample receipts → book one manual utlägg (2899) + one RC25 review → produce `fy-2025` VAT return and eyeball boxes 05/21/30/40/48/49 against Kapitas momsrapport → SIE re-export opens in an external tool without errors.
4. Visual baselines: Phase C adds VAT-box rows and Phase E adds books-print chrome — run `corepack pnpm test:e2e:visual`, review every diff, then `test:e2e:visual:update` once (per `scripts/visual-baselines.md`).
5. Adversarial review workflow (fresh agents) over the diff: correctness, store parity, hash-chain safety, contract-schema sync — findings fixed before done.
