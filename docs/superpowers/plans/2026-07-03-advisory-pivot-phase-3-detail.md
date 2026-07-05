# Phase 3 — Real capture: detailed execution plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Checkbox syntax for tracking. Verification vocabulary: `CHECK` = `pnpm check`; `E2E` = `pnpm test:e2e`; `E2E:file <f>` = `pnpm build:e2e && npx playwright test tests/e2e/<f>`; `INTEG` = `pnpm test:integration` with `SUPABASE_DB_URL` set (or documented manual SQL smoke, Rules 2/14).

**Baseline verified against branch `feat/advisory-pivot` on 2026-07-04** (HEAD `2c4db6e`, Phases 0–2 landed: dark mode + visual baselines light/dark for 5 screens, workspace profile on `companySettingsSchema`, `Money`/`useWorkspaceProfile`, next-intl en+sv with `shell`/`capture`/`today` namespaces migrated, CoA registry `defaultCoaTemplate`+`roles`, `swedishVatRegime`, migrations 0001–0004).

## Findings that correct the scope description (read before executing)

1. **`ImportedVoucher` does NOT exist in contracts.** `eventTypeSchema` (`packages/contracts/src/index.ts:31–47`) has no import-related member at all. This phase adds two new event types. Per the existing naming convention (`EvidenceReceived`, `VoucherCreated`, `SuggestionGenerated`), the import event is named **`VoucherImported`**, not `ImportedVoucher`; the extraction event is **`ExtractionRefreshed`** as scoped.
2. **Migration `0005_extraction.sql` is NOT needed.** Extracted fields live on **vouchers**, not evidence: `ledger.vouchers.extracted_fields jsonb` + `voucher_fields jsonb` (0001:67–68) absorb refreshed extraction with no schema change. Evidence-level additions (`sizeBytes`, sha256 provenance) go into the existing `ledger.evidence_objects.metadata jsonb` (0001:41, currently always written as `{}` at `packages/persistence-postgres/src/store.ts:393`). `ledger.events.event_type` is unconstrained `text` (no CHECK), so new event types need no migration. Rule 1 satisfied by inspection; the plan therefore ships **no migration** and 0005 stays free for Phase 4.
3. **The hardcoded 1249 SEK lives in THREE places** that must change coherently: `MemoryLedgerStore.createEvidenceSync` voucherFields literal (`packages/domain/src/store.ts:252–256`), the identical literal in `PostgresLedgerStore.createEvidence` (`packages/persistence-postgres/src/store.ts:456–460`), `buildExtractedFields` (`packages/domain/src/evidence-defaults.ts:32`) — plus the fourth cousin `StubDocumentIntelligenceClient` (`packages/document-intelligence/src/index.ts:64`). Seed stability strategy (locked): **deterministic fields are derived only when `sizeBytes` is provided on the create input.** The seeded demo evidence (`openai-march-2026.pdf`, `store.ts:159`) and the E2E `createEvidencePayload` (`tests/e2e/test-helpers.ts:5`) pass no `sizeBytes`, so they keep today's exact canned values (1249/999.2/249.8/25) → the seeded review card, `simulation.test.ts` pins, api.spec journal counts, and the today-light/dark visual baselines all survive untouched. Promoted files always carry `sizeBytes` → always deterministic-from-file.
4. **`evidenceCreateInputSchema` has no `uploadId`/`blobPath`/`size`/`hash` fields**, despite `services/api/src/blob.ts:14–16` claiming "the client must call /api/evidence with the same uploadId". Both stores synthesize `blobPath: evidence/${id}/${filename}` and a fake `hash` (`buildEventHash("file", ...)`). The extract route's real-blob gate is `blobPath.startsWith("evidence-uploads/")` (`services/api/src/app.ts:322`) — today **no evidence ever passes it**. Fixed in Task 3.1 by returning `blobPath` from `initUpload` and passing `uploadId/blobPath/sizeBytes/sha256` through create.
5. **Demo mode is TWO code paths, not one.** (a) Demo-with-API (E2E: `NEXT_PUBLIC_API_BASE_URL=/api-proxy`, API on :3201 with `StubBlobUploader`) — the browser really PUTs bytes; (b) offline demo fallback (`AccountingApiClient.fallbackStore`, in-browser `MemoryLedgerStore`) — `uploadBlob` is a no-op. Both must run the same client pipeline. The stub `uploadUrl` (`/api/uploads/<id>`) is currently relative and would 404 against the web origin; `uploadBlob` must resolve it against `baseUrl`, and the API needs a real `PUT /api/uploads/:uploadId` accept-and-discard route (path (a)). Note: the api-proxy forwards only `accept/authorization/content-type/x-request-id` headers — `x-ms-blob-type` is stripped; the stub PUT route must not require it (Azure PUTs go direct to the SAS URL, not through the proxy).
6. **Extraction results are discarded today**: `/api/evidence/:id/extract` computes `liveExtraction` and returns it without persisting (`app.ts:315–359`); the response shape `{extracted, evidence, packet?, voucher?, liveExtraction?}` is asserted by `tests/e2e/api.spec.ts:80–85` — keep it backward-compatible, add `review`.
7. **Review "Edit" is already fully wired as a dead end**: `ReviewCardActions` emits `"edit"` (button `review-edit`, hotkey E) and `TodayScreen.handleAction` shows `t("editToast")` (`today-screen.tsx:168`). Only the editor sheet + contract mechanism are new.
8. **Current SIE surfaces are placeholders, not just incomplete.** Export (`app.ts:93–103`) emits one `#VER` per journal _line_ with no `{}` braces, no `#SIETYP/#GEN/#KONTO/#ORGNR/#RAR` — not spec-valid. Import (`app.ts:374–380`) counts `#TRANS` lines without touching the store. `tests/e2e/api.spec.ts:181–191` posts bare `#TRANS` lines _outside_ any `#VER` — a real parser rejects those, so that fixture and its assertions MUST change with Task 3.4 (Rule 5).
9. **IndexedDB can hold Blobs** — `idb`'s `put` structured-clones `Blob` fine, and `idb@8.0.3` is already a web dep. The **sessionStorage fallback adapter cannot** (`JSON.stringify` drops blobs) — fallback saves strip the `file` field and degrade to metadata-only drafts (documented, surfaced via the existing "session/memory" capture-status messages).
10. **`/share` files cannot be stored to IndexedDB without a service worker** — the POST is handled server-side in `apps/web/app/share/route.ts`; there is no client context. Feasible SW-free mechanism (chosen): the route already receives `File` objects, and `ACCOUNTING_API_BASE_URL` is available server-side (`getWebServerRuntimeConfig()`), so the route **forwards files through the real pipeline server-side** (initUpload → PUT → createEvidence with node-side SHA-256) and redirects with `promoted=<n>`; when the API is unreachable it falls back to today's `shared=1&pending=<n>` params (limitation documented). Param-only shares (title/text/url) become a client-side draft in `CaptureScreen`.
11. **E2E specs click quick-add tiles and expect instant drafts** (`capture.spec.ts:18–24`, `home.spec.ts:34–44, 54–57`). Real `<input type=file>` opens an OS dialog Playwright can't drive — those specs switch to `setInputFiles` on the hidden inputs. All existing `data-testid`s are preserved; only interaction changes.
12. **Evidence detail has no data source for voucher/review**: `WorkspaceSnapshot` carries no packets, so the screen (`evidence-detail-screen.tsx`) can't join evidence→voucher client-side. Task 3.2 adds `GET /api/evidence/:id` (context + review, no extraction side-effect). Its copy is also still literal English — migrate to next-intl (`evidence` namespace) while rebuilding it (was deliberately deferred from Phase 2).
13. **Memory/Postgres `PostedToLedger` payload parity gap**: Postgres includes `lines` in the payload (`persistence-postgres/store.ts:963–968`); Memory does not (`domain/store.ts:488`). The edited-approve feature makes event-payload lines the replay truth (Rule 13), so Memory must add `lines` — a pre-existing parity bug fixed in Task 3.3.
14. **`fetchSieExport` returns `response.text()`** (`packages/api-client/src/index.ts:234–253`) and throws 503 in offline demo. Spec-valid PC8 (CP437) export is bytes, not UTF-8 text — the client method switches to bytes, and the offline demo path becomes honest by calling the domain serializer directly (api-client already depends on `@jpx-accounting/domain`).
15. **`packages/document-intelligence` gains a dependency on `@jpx-accounting/domain`** (for the shared deterministic derivation). Verified acyclic: domain does not import document-intelligence (only `services/api` does).

## Invariants honored throughout

- **Append-only inviolable**: events are never rewritten; voucher/review rows are read models. Extraction refresh appends `ExtractionRefreshed` (+ `SuggestionGenerated`) and updates read models; it never touches evidence rows' `hash`/`blobPath`/file bytes, and never mutates a voucher whose review is already decided. Edited approvals post _new_ lines derived at decision time; nothing historical changes. Import appends `VoucherImported`; re-import skips duplicates instead of rewriting.
- **Store parity (Rules 6, 11)**: every `LedgerStore` interface change lands in `MemoryLedgerStore` + `PostgresLedgerStore` + `UnavailableLedgerStore` (`services/api/src/runtime.ts`) in the same commit, with Memory-vs-Postgres parity assertions in `tests/integration/postgres-ledger.test.ts`.
- **Rule 16**: new domain errors (`InvalidReviewEditError`, `SieImportError`) get explicit `app.onError` branches (422).
- No existing `data-testid` renamed or removed. Seed review and all non-capture visual baselines stay byte-stable; only `capture-{light,dark}` re-baselines (deliberate, reviewed).
- Demo works fully offline: every new surface has a `fallbackStore` path in `packages/api-client`.
- Every task ends `CHECK` green; E2E after each web-facing task and at the exit gate.

## Task dependency graph

```
Track S (shared files: contracts + both stores + runtime.ts — SEQUENTIAL, each atomic):
  3.1 (upload/create truth) → 3.2 (extraction persisted) → 3.3 (edited decisions) → 3.4 (SIE real)

Track W (web-only):
  3.5 (draft queue v2: blobs)        — parallel with 3.1–3.4 (touches only apps/web/lib)
  3.6 (real intake + promotion)      — after 3.1 AND 3.5
  3.7 (evidence detail)              — after 3.2 AND 3.6
  3.8 (share_target)                 — after 3.6 (server-forward path needs 3.1)
  3.9 (review edit sheet)            — after 3.3 (independent of 3.6–3.8)
  3.10 (SIE web: import/export UX)   — after 3.4 (independent of 3.6–3.9)

3.11 (exit gate) joins everything.
```

3.6/3.7/3.8 all touch capture components — keep sequential within Track W. 3.9 and 3.10 touch disjoint files and can run parallel to 3.6–3.8.

---

## Task 3.1 — Honest upload + evidence creation (contracts + uploader + both stores, atomic)

**Files — Modify:** `packages/contracts/src/index.ts`, `services/api/src/blob.ts`, `services/api/src/app.ts`, `packages/domain/src/evidence-defaults.ts`, `packages/domain/src/store.ts`, `packages/persistence-postgres/src/store.ts`, `packages/api-client/src/index.ts`, `packages/domain/src/index.ts`, `tests/unit/ledger-store.test.ts`, `tests/integration/postgres-ledger.test.ts`, `tests/e2e/api.spec.ts`. **Create:** `packages/domain/src/deterministic-extraction.ts`, `tests/unit/deterministic-extraction.test.ts`.

- [ ] Contracts:
  - `uploadInitResultSchema` += `blobPath: z.string()` — the server-minted canonical path `evidence-uploads/{uploadId}/{sanitizedFilename}` the client echoes back at create time.
  - `evidenceCreateInputSchema` += four optional fields:
    ```ts
    sizeBytes: z.number().int().nonnegative().optional(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),   // client-computed, Web Crypto
    uploadId: z.string().optional(),
    blobPath: z.string().regex(/^evidence-uploads\/[A-Za-z0-9-]+\/[^/]{1,200}$/).optional(), // schema-level guard: clients cannot point at arbitrary paths
    ```
  - `evidenceObjectSchema` += `sizeBytes: z.number().int().nonnegative().optional()` (old rows/payloads parse unchanged).
  - Rule 5 sweep for the three schemas (verified at plan time): `services/api/src/app.ts` (`parseBody` sites — no change needed, optionals absorb), `packages/api-client/src/index.ts:164–178` (demo `initUpload` literal — must add `blobPath`), `services/api/src/blob.ts` (both uploaders), `tests/e2e/api.spec.ts:51–66` (`toMatchObject` — unaffected; extend to assert `blobPath`), `tests/e2e/test-helpers.ts` `createEvidencePayload` (unchanged on purpose — keeps the legacy/seed path exercised).
- [ ] `services/api/src/blob.ts`:
  - `BlobUploader` interface += `readonly kind: "stub" | "azure"` (used by Task 3.2's file-url route and the stub PUT mount).
  - `StubBlobUploader.initUpload`: compute `blobPath = evidence-uploads/${uploadId}/${sanitizeFilename(input.filename)}` and return it (plus existing fields). `AzureBlobUploader.initUpload`: return the `blobName` it already computes as `blobPath`.
- [ ] `services/api/src/app.ts`: when `blobUploader.kind === "stub"`, mount `app.put("/api/uploads/:uploadId", ...)` → `await c.req.arrayBuffer()` (accept-and-discard, honestly commented: bytes travel, storage is out of scope for stub mode; previews come from the client-side blob cache in 3.5), respond `201`. Exempt this path from `defaultJsonBodyLimit` (like the SIE route) and give it its own `bodyLimit({ maxSize: 16 * 1024 * 1024 })` matching `MAX_UPLOAD_BYTES`.
- [ ] `packages/domain/src/deterministic-extraction.ts` (new, pure):
  ```ts
  export type DeterministicSeed = { filename: string; sizeBytes: number };
  export function fnv1a(input: string): number; // 32-bit FNV-1a
  export function deriveDeterministicExtraction(seed: DeterministicSeed, dateIso: string): ExtractedField[];
  ```
  Derivation pinned: `h = fnv1a(`${filename}:${sizeBytes}`)`; supplier from a 5-entry Swedish-plausible list (`h % 5`); `vatRate` from `[25,25,25,12,6][h % 5]`; `grossAmount` = `round2(100 + (h % 490000)/100)`; `netAmount = round2(gross/(1+rate/100))`, `vatAmount = round2(gross - net)`; `invoiceNumber = INV-${10000 + (h % 90000)}`; `supplierVatNumber = SE${(h % 1e10).toString().padStart(10,"0")}01`; `receiptDate`/`transactionDate` = `dateIso`. Emits keys `supplierName, receiptDate, transactionDate, grossAmount, netAmount, vatAmount, vatRate, invoiceNumber, supplierVatNumber` (all required rule-gate fields present → promoted evidence is approvable, exercising the un-blocked path end-to-end). Export from `packages/domain/src/index.ts`.
- [ ] `packages/domain/src/evidence-defaults.ts`:
  - `buildExtractedFields(input)`: if `input.sizeBytes !== undefined` → `deriveDeterministicExtraction({filename: input.originalFilename, sizeBytes: input.sizeBytes}, today())`; else the current canned array **byte-identical** (seed/legacy compatibility — do not touch values or confidences).
  - New `deriveVoucherFields(extractedFields: ExtractedField[], input: EvidenceCreateInput): VoucherField` — parses `grossAmount`/`netAmount`/`vatAmount`/`vatRate` from fields (fallback: rate 25, `net = round2(gross/1.25)`, `vat = round2(gross-net)`), strings from matching keys, `description: input.title`, `currency: "SEK"` (known literal, Phase-2 finding 6). Unit-test pins the legacy path reproduces `{grossAmount: 1249, netAmount: 999.2, vatAmount: 249.8, vatRate: 25}` exactly.
- [ ] Both stores' `createEvidence` (Memory `store.ts:203–338`, Postgres `store.ts:342–616`), identically:
  - `blobPath: input.blobPath ?? \`evidence/${evidenceId}/${input.originalFilename}\`` (legacy synthetic path preserved when no upload happened);
  - `hash: input.sha256 ?? buildEventHash("file", ...)` (existing fallback);
  - `sizeBytes: input.sizeBytes` onto the evidence object; Postgres persists it inside the existing `metadata` jsonb and **adds `metadata` to every evidence SELECT** (`getEvidenceContext`, `getSnapshot`) + maps it in `rowToEvidence` (extend `EvidenceRow` with `metadata: { sizeBytes?: number }`);
  - voucherFields literal replaced by `deriveVoucherFields(extractedFields, input)` in both stores (kills the duplicated 1249 literal).
- [ ] `packages/api-client/src/index.ts`:
  - demo `initUpload` literal += `blobPath: \`evidence-uploads/${uploadId}/${input.filename}\``;
  - `uploadBlob`: resolve relative stub URLs — `const target = uploadResult.uploadUrl.startsWith("/") && this.baseUrl ? \`${this.baseUrl}${uploadResult.uploadUrl}\` : uploadResult.uploadUrl;` (fallbackStore path stays a no-op).
- [ ] Tests: `tests/unit/deterministic-extraction.test.ts` (stability: same seed → same fields across calls; different size → different amounts; legacy `buildExtractedFields` output pinned; `deriveVoucherFields` legacy pin above). `tests/unit/ledger-store.test.ts`: createEvidence with `{sizeBytes: 48211, sha256: "ab…", uploadId, blobPath}` → evidence `hash === sha256`, `blobPath` echoed, `sizeBytes` round-trips, voucherFields.grossAmount ≠ 1249 and equals the derived value. `INTEG`: same round-trip on Postgres incl. `metadata` jsonb read-back + Memory/Postgres field-parity assertion (Rule 11). `tests/e2e/api.spec.ts`: uploads/init asserts `blobPath` present; add a second create with `sizeBytes` asserting non-1249 gross.
- [ ] `CHECK` + `INTEG`. Commit: `feat(capture): honest upload metadata — blobPath/sha256/sizeBytes through init→create; deterministic file-seeded fields (seed path pinned)`.

## Task 3.2 — Extraction persisted: `ExtractionRefreshed` + `updateEvidenceExtraction` (atomic)

**Depends on 3.1.** **Files — Modify:** `packages/contracts/src/index.ts`, `packages/domain/src/store.ts`, `packages/persistence-postgres/src/store.ts`, `services/api/src/runtime.ts` (UnavailableLedgerStore), `services/api/src/app.ts`, `packages/document-intelligence/src/index.ts` + `packages/document-intelligence/package.json` (add `"@jpx-accounting/domain": "workspace:*"`), `packages/api-client/src/index.ts`, `tests/unit/ledger-store.test.ts`, `tests/integration/postgres-ledger.test.ts`, `tests/e2e/api.spec.ts`. **Create:** `tests/unit/evidence-extraction.test.ts`.

- [ ] Contracts:
  - `eventTypeSchema` += `"ExtractionRefreshed"`.
  - New:
    ```ts
    export const extractionResultSchema = z.object({
      modelId: z.string(),
      fields: z.array(extractedFieldSchema).min(1),
      extractedAt: z.string(),
    });
    export type ExtractionResult = z.infer<typeof extractionResultSchema>;
    export const evidenceContextSchema = z.object({
      evidence: evidenceObjectSchema,
      packet: evidencePacketSchema.optional(),
      voucher: voucherSchema.optional(),
      review: reviewTaskSchema.optional(),
    });
    export type EvidenceContext = z.infer<typeof evidenceContextSchema>;
    ```
- [ ] `LedgerStore` interface:
  ```ts
  updateEvidenceExtraction(evidenceId: string, extraction: ExtractionResult): Promise<EvidenceContext | undefined>;
  ```
  Semantics (identical both stores; parity-tested):
  1. Resolve evidence→packet→voucher (existing `getEvidenceContext` join). No evidence → `undefined`. No voucher → return `{evidence, packet}` unchanged.
  2. **Decided-voucher guard (append-only):** if `voucher.status !== "needs-review"` → return current context WITHOUT any mutation or event.
  3. Merge fields **by key**: refreshed values win; existing keys absent from the refresh are retained.
  4. `voucherFields` recomputed via `deriveVoucherFields(mergedFields, …)` preserving `description`/`currency` from the current voucher.
  5. Update the voucher read model (Memory: immutable replace per Rule 17; Postgres: `UPDATE ledger.vouchers SET extracted_fields = …, voucher_fields = …`).
  6. Re-run `evaluateVoucherRules` + `buildDeterministicSuggestion`; update the review's `suggestion`, `blockedReason`, `suggestedAction` (same ternaries as create) and append provenance steps `"Fields re-extracted"` (actor `system-extractor`) + `"Suggestion regenerated"` (actor `system-ai`).
  7. Append TWO events, hash-chained (Postgres: inside one `client.begin` with `lockWorkspaceTail`): `ExtractionRefreshed` (aggregate `voucher`, actor `"system-extractor"`, payload `{ evidenceId, voucherId, modelId, extractedAt, fields: mergedFields, voucherFields }` — full snapshot, Rule 13) and `SuggestionGenerated` (aggregate `review`, actor `"system-ai"`, payload = the new suggestion).
  8. Return `{evidence, packet, voucher, review}` (fresh copies).
  - `UnavailableLedgerStore` += failing `updateEvidenceExtraction` (same commit, Rule 6).
- [ ] `StubDocumentIntelligenceClient`: `ExtractInput` += optional `hints?: { filename: string; sizeBytes?: number | undefined }`. Stub returns `deriveDeterministicExtraction({filename: hints?.filename ?? "unknown", sizeBytes: hints?.sizeBytes ?? 0}, today's date)` — kills the 1249 stub; create (3.1) and extract share the same seed → refresh is a stable no-op on values (idempotent). Azure client ignores `hints`.
- [ ] `services/api/src/app.ts` extract route:
  - pass `hints: { filename: extraction.evidence.originalFilename, sizeBytes: extraction.evidence.sizeBytes }` into `documentIntelligence.extract`;
  - on success: `const updated = await currentStore.updateEvidenceExtraction(id, { modelId, fields: liveExtraction.fields, extractedAt: nowIso() })` and respond `{ extracted: Boolean(updated?.voucher), ...updated, liveExtraction }` — persisting instead of discarding, superset-compatible with `api.spec.ts:80–85` (now also carries `review`);
  - fail-soft branch unchanged.
  - New route `GET /api/evidence/:id` → `getEvidenceContext` + `findReviewByVoucher`, validated shape `evidenceContextSchema` (404 when missing). New route `GET /api/evidence/:id/file-url` → if `blobUploader.kind === "azure"` and `blobPath` starts with `evidence-uploads/` → `mintReadSas` → `{url, expiresInSeconds}`; else `404 {code: "preview_unavailable"}`.
- [ ] `packages/api-client/src/index.ts` new methods:
  ```ts
  async getEvidenceContext(evidenceId: string): Promise<EvidenceContext | undefined>;   // fallback: store.getEvidenceContext + findReviewByVoucher
  async extractEvidence(evidenceId: string): Promise<EvidenceContext | undefined>;      // fallback: deriveDeterministicExtraction → store.updateEvidenceExtraction
  async getEvidenceFileUrl(evidenceId: string): Promise<{ url: string } | null>;        // null on 404/fallback
  ```
- [ ] Tests: `tests/unit/evidence-extraction.test.ts` — Memory: refresh merges by key, regenerates suggestion, appends exactly 2 events with correct types/actors and chained hashes, decided voucher → zero mutations/events, unknown id → undefined. `INTEG`: same on Postgres + parity assertion vs Memory. `tests/e2e/api.spec.ts`: after extract, `GET /api/evidence/:id` shows voucher.extractedFields containing the stub supplier and `review` present.
- [ ] `CHECK` + `INTEG`. Commit: `feat(extraction): ExtractionRefreshed event + LedgerStore.updateEvidenceExtraction (both stores); extract route persists; deterministic DI stub`.

## Task 3.3 — Edited review decisions honoring append-only (atomic)

**Depends on 3.2 (sequential shared files only).** **Files — Modify:** `packages/contracts/src/index.ts`, `packages/domain/src/store.ts`, `packages/persistence-postgres/src/store.ts`, `services/api/src/app.ts` (onError branch only), `tests/unit/ledger-store.test.ts`, `tests/integration/postgres-ledger.test.ts`.

- [ ] Contract:
  ```ts
  export const reviewDecisionEditSchema = z.object({
    accountNumber: z.string().min(1),
    accountName: z.string().min(1),
    vatCode: z.string().min(1),
    grossAmount: z.number().positive().optional(),
    netAmount: z.number().nonnegative().optional(),
    vatAmount: z.number().nonnegative().optional(),
  });
  export const reviewDecisionInputSchema = z.object({
    actorId: z.string(),
    notes: z.string().optional(),
    edited: reviewDecisionEditSchema.optional(),
  });
  ```
- [ ] Mechanism (both stores, in `applyReviewDecision`): when `action !== "reject"` and `input.edited` present —
  - validate: if any amount given, all of gross/net/vat must be present and `|net + vat − gross| ≤ 0.01`, else throw `class InvalidReviewEditError extends Error { readonly issues: string[] }` (exported from domain; `app.onError` → 422, Rule 16);
  - `effectiveSuggestion = { ...review.suggestion, accountNumber, accountName, vatCode }`; `effectiveVoucher = { ...voucher, voucherFields: { ...voucher.voucherFields, ...amountOverrides } }` — decision-time derivation only; the stored voucher row is NOT rewritten;
  - `buildPostingLines(effectiveVoucher, effectiveSuggestion, action, occurredAt)` (signature unchanged);
  - review read model: `suggestion` replaced by `effectiveSuggestion`, provenance step `"Approved with edits"` (or `"Booked without VAT deduction (edited)"`);
  - events: `ReviewApproved` payload += `edited: input.edited` when present; `PostedToLedger` payload includes `lines` **in BOTH stores** (fixes Memory parity gap, finding 13).
- [ ] Out of scope, noted in commit body: `runSimulation` stays non-edit-aware.
- [ ] Tests: Memory — approve with edits posts 3 lines using edited account/amounts, review returns edited suggestion, inconsistent amounts throw, reject ignores `edited`. `INTEG` — same on Postgres + parity + `PostedToLedger.payload.lines` present in both stores.
- [ ] `CHECK` + `INTEG`. Commit: `feat(review): edited approvals — reviewDecisionInput.edited posts corrected lines append-only; PostedToLedger payload parity`.

## Task 3.4 — SIE 4 real: domain parser/serializer + `importSie` + spec-valid export (atomic)

**Depends on 3.3 (shared-file sequencing).** **Files — Create:** `packages/domain/src/sie/parse.ts`, `packages/domain/src/sie/serialize.ts`, `packages/domain/src/sie/pc8.ts`, `tests/unit/sie.test.ts`, `tests/fixtures/sie/minimal-4i.se` (CP437 bytes, åäö in names), `tests/fixtures/sie/golden-export.se`. **Modify:** `packages/contracts/src/index.ts`, `packages/domain/src/index.ts`, `packages/domain/src/store.ts`, `packages/persistence-postgres/src/store.ts`, `services/api/src/runtime.ts`, `services/api/src/app.ts`, `packages/api-client/src/index.ts`, `tests/unit/ledger-store.test.ts`, `tests/integration/postgres-ledger.test.ts`, `tests/e2e/api.spec.ts`.

- [ ] Contracts: `eventTypeSchema` += `"VoucherImported"`; new
  ```ts
  export const sieImportResultSchema = z.object({
    accepted: z.boolean(),
    importedVouchers: z.number().int().nonnegative(),
    importedTransactions: z.number().int().nonnegative(),
    skipped: z.array(z.object({ reference: z.string(), reason: z.string() })).default([]),
  });
  ```
- [ ] `sie/pc8.ts`: `encodePc8` / `decodePc8` — ASCII passthrough + CP437 Swedish subset map (`å→0x86 ä→0x84 ö→0x94 Å→0x8F Ä→0x8E Ö→0x99 é→0x82 É→0x90 ü→0x81 Ü→0x9A`), unmappable → `?` / U+FFFD. `decodeSieBuffer(bytes)`: UTF-8 (fatal) first, CP437 map on failure.
- [ ] `sie/parse.ts` (SIE 4E/4I subset): quoted-string tokenizer with `\"` escapes; `#KONTO`, `#ORGNR`, `#FNAMN`, `#SIETYP`; `#VER series [number] date [text]` + `{ … }` block of `#TRANS account {objects-ignored} amount [transdate] [text]`; dates `YYYYMMDD → YYYY-MM-DD`; unknown labels skipped; bare `#TRANS` outside `#VER` ignored with warning.
- [ ] `sie/serialize.ts`: `buildSieExport({journal, settings, generatedAt, coa = defaultCoaTemplate})` emitting `#FLAGGA 0` · `#PROGRAM "JPX Accounting" "0.1.0"` (byte-identical — api.spec pins it) · `#FORMAT PC8` · `#GEN` · `#SIETYP 4` · `#ORGNR`/`#FNAMN` when present · `#RAR 0` from `profile.fiscalYearStart` · `#KONTO` per distinct account · vouchers grouped by voucherId first-seen, `#VER A <n> <date> "<escaped>"` with `{ }`-wrapped `#TRANS`, amount = debit − credit, dot-decimal 2dp.
- [ ] `LedgerStore` += `importSie(input: { actorId: string; file: ParsedSieFile }): Promise<SieImportResult>` — Memory + Postgres + Unavailable:
  - Bounds: >500 vouchers or >100 lines/voucher → `SieImportError` (→ 422).
  - Per-voucher isolation (Rule 21): unbalanced (|Σ| > 0.005) or bad date → `skipped`, continue.
  - Idempotency via aggregate id `sie_<series>_<number>` checked against existing `VoucherImported` events; duplicates → skipped `"duplicate"`.
  - Per voucher: `LedgerLine[]` (accountName from `#KONTO` → registry → `Konto <nr>`, debit/credit by sign, `vatCode: "NA"`, `deductible: false` — documented v1 limitation), ONE `VoucherImported` event (payload `{ source: "sie", series, number, date, text, lines }`). Memory pushes lines to `this.ledgerLines`; **Postgres `getReports` replay widens to `event_type IN ('PostedToLedger','VoucherImported')`**.
  - No voucher/review rows created (imported vouchers are already booked — documented).
- [ ] Routes: `POST /api/imports/sie` → decode → parse → `importSie` → result JSON. `GET /api/exports/sie` → `buildSieExport(...)` → `encodePc8` bytes, `content-type: text/plain; charset=ibm437`, attachment filename. Delete old `buildSIEExport`.
- [ ] `packages/api-client`: `fetchSieExport(): Promise<Uint8Array>` (offline fallback calls domain serializer — kills the 503); new `importSie(bytes)` (fallback: decode → parse → store.importSie).
- [ ] Tests: golden files both directions; round-trip; escaping; unbalanced skip; PC8 inverse; Memory importSie (journal grows, events appended, re-import all-duplicate); INTEG parity. `tests/e2e/api.spec.ts:181–191` REWRITTEN: valid `#VER` fixture → `{accepted: true, importedVouchers: 1, importedTransactions: 2}`; re-post → duplicates; export keeps `#PROGRAM` pin + `#SIETYP 4`.
- [ ] `CHECK` + `INTEG`. Commit: `feat(sie): real SIE 4 subset — parser, PC8, VoucherImported events + replay, spec-valid export; golden-file tests`.

## Task 3.5 — Draft queue v2: real blobs in IndexedDB + evidence blob cache (web-only; parallel with Track S)

**Files — Modify:** `apps/web/lib/draft-queue-core.ts`, `apps/web/lib/draft-queue.ts`, `tests/unit/draft-queue-core.test.ts`. **Create:** `apps/web/lib/evidence-blob-cache.ts`, `apps/web/hooks/use-object-url.ts`.

- [ ] `CaptureDraft` extends: `filename? mimeType? sizeBytes? text? sourceUrl? file?: Blob`.
- [ ] `draft-queue.ts`: `openDB(databaseName, 2, {upgrade})` — v2 adds store `evidence-blobs` (keyPath `evidenceId`); `capture-drafts` untouched. Session fallback strips `file` before JSON (degrades to metadata-only via existing status messaging).
- [ ] `evidence-blob-cache.ts`: `putEvidenceBlob`, `getEvidenceBlob`, `pruneEvidenceBlobs(max = 50)` — LRU by `storedAt` (Rule 25), pruned on every put.
- [ ] `use-object-url.ts`: `useObjectUrl(blob)` — create/revoke object URLs.
- [ ] `tests/unit/draft-queue-core.test.ts`: merge/sort with new fields; fallback shape unchanged.
- [ ] `CHECK`. Commit: `feat(capture): drafts carry real Blobs (IndexedDB v2) + bounded evidence blob cache`.

## Task 3.6 — Real intake (drop-zone / file / camera / paste) + fire-and-forget promotion

**Depends on 3.1 + 3.5.** **Files — Create:** `apps/web/lib/promotion.ts`, `apps/web/lib/workspace-identity.ts`, `apps/web/lib/hash.ts`, `apps/web/components/capture/drop-zone.tsx`, `tests/fixtures/receipt.jpg`, `tests/fixtures/invoice.pdf`. **Modify:** `apps/web/components/capture/quick-add-grid.tsx`, `apps/web/components/capture/drafts-table.tsx`, `apps/web/components/screens/capture-screen.tsx`, `apps/web/components/app-shell.tsx` (capture sheet), `apps/web/messages/en.json` + `sv.json`, `tests/e2e/capture.spec.ts`, `tests/e2e/home.spec.ts`.

- [ ] `workspace-identity.ts`: `WORKSPACE_IDENTITY = { organizationId: "org_jpx", workspaceId: "workspace_main", actorId: "user_founder" }` — single home for the deferred-auth identity.
- [ ] `hash.ts`: `sha256Hex(data: ArrayBuffer): Promise<string | undefined>` — Web Crypto, undefined when unavailable. Isomorphic.
- [ ] `promotion.ts` — THE pipeline for tiles/sheet/drop/paste/retry: `promoteDraft(draft)` file branch: sha256 → initUpload → uploadBlob → createEvidence (real filename/MIME/sizeBytes/sha256/uploadId/blobPath) → putEvidenceBlob → removeCaptureDraft → fire-and-forget extractEvidence + invalidate. Metadata branch: honest text evidence — the `${id}.bin`/octet-stream placeholder is DELETED. `captureFiles(files, mode)`: save draft(s) → fire-and-forget promote. ≤3-tap audit holds.
- [ ] `drop-zone.tsx`: dragover/drop (image/\* + pdf, 16 MB cap), click/Enter opens hidden input `capture-file-input`; focus ring + aria-label; testid `capture-dropzone`.
- [ ] `quick-add-grid.tsx`: keep all four tile testids. camera → hidden input with `capture="environment"` (`capture-camera-input`); upload → drop-zone's input; paste → `navigator.clipboard.read()` else hint toast; share → OS-share hint. DropZone mounted above tiles. Document-level paste listener in CaptureScreen.
- [ ] `app-shell.tsx` capture sheet: camera/upload → hidden inputs (`capture-sheet-camera-input`, `capture-sheet-file-input`) → saveCaptureDraft → existing status messages → fire-and-forget promote; paste/share → hints. Metadata-only createDraft path removed.
- [ ] `drafts-table.tsx`: thumbnail column via `useObjectUrl` (img for image/\*, FileText icon for PDF, dash otherwise; testid `draft-thumb`); promote button = retry path via `promoteDraft`.
- [ ] E2E: capture.spec switches to `setInputFiles` on `capture-file-input` with `tests/fixtures/receipt.jpg` → draft w/ thumb → auto-promote → evidence-row; a11y kept. home.spec sheet flow via `setInputFiles` on `capture-sheet-camera-input` → draft-notice "Camera draft saved". Clipboard E2E intentionally skipped (noted).
- [ ] `CHECK` + both spec files. Visual `/capture` diff deferred to 3.11. Commit: `feat(capture): real intake — drop-zone, file/camera inputs, paste; fire-and-forget promotion with real blobs, hash, honest metadata`.

## Task 3.7 — Evidence detail: preview, extracted fields, review link

**Depends on 3.2 + 3.6.** **Files — Modify:** `apps/web/components/screens/evidence-detail-screen.tsx`, `apps/web/messages/en.json` + `sv.json` (new `evidence` namespace).

- [ ] Data source → `useQuery(["evidence", id], apiClient.getEvidenceContext)`.
- [ ] Preview (testid `evidence-preview`): (1) local blob cache → object URL; (2) `getEvidenceFileUrl` (SAS); (3) honest empty state (testid `evidence-preview-unavailable`). img for image/\*, iframe for pdf.
- [ ] Extracted-fields table (testid `evidence-extracted-fields`) from `context.voucher?.extractedFields`; confidence via formatPercent; amounts via Money.
- [ ] Links: `evidence-open-review` → `/today?review=<id>`; voucher number; `evidence-extract` re-run button → extractEvidence → invalidate; disabled with hint when review decided. Keep `evidence-hash`/`evidence-back`/`evidence-not-found`; add sizeBytes display.
- [ ] `CHECK` + capture spec. Commit: `feat(evidence): detail screen — file preview (local blob / read-SAS), extracted fields, review link, re-extract`.

## Task 3.8 — share_target consumed

**Depends on 3.6.** **Files — Modify:** `apps/web/app/share/route.ts`, `apps/web/components/screens/capture-screen.tsx`, `apps/web/messages/en.json` + `sv.json`, `tests/e2e/navigation-and-share.spec.ts`.

- [ ] Params: CaptureScreen reads title/text/url/shared/pending/promoted via nuqs; title||text||url → ONE share-mode draft (ref-guarded, params cleared after); `promoted=<n>` → success toast; `shared/pending` fallback → info banner.
- [ ] Files (server-side, SW-free): share route forwards ≤5 validated files through initUpload → PUT → createEvidence (node sha256) with WORKSPACE_IDENTITY, fire-and-forget extract; redirect `303 /capture?promoted=<n>`; API unreachable → legacy `shared/pending` params (limitation comment). Shared-file evidence has no local blob → preview falls back honestly.
- [ ] navigation-and-share.spec: param test asserts draft-row appears; new desktop test POSTs multipart with receipt.jpg → follow redirect → promoted=1 → evidence-row present.
- [ ] `CHECK` + spec file. Commit: `feat(share): share_target params create drafts; shared files promoted server-side through the real pipeline`.

## Task 3.9 — Review Edit becomes real (editor sheet)

**Depends on 3.3. Parallel with 3.6–3.8.** **Files — Create:** `apps/web/components/today/review-edit-sheet.tsx`. **Modify:** `apps/web/components/screens/today-screen.tsx`, `apps/web/messages/en.json` + `sv.json` (`today.editSheet.*`; `today.editToast` deleted), `tests/e2e/review-edit.spec.ts` (new).

- [ ] Sheet uses `useDialogFocusTrap`; account select over `defaultCoaTemplate.accounts` (`edit-account`), VAT select (`edit-vat-code`), gross/net/vat inputs (`edit-gross`/`edit-net`/`edit-vat`) prefilled, client-side `net + vat = gross ± 0.01` mirror; submit (`edit-submit`) → `approveReview(id, {actorId, edited})`. Footer: append-only statement.
- [ ] today-screen: `"edit"` opens the sheet (state `editingReviewId`); success reuses onMutationSuccess; hotkey E works via existing wiring.
- [ ] E2E: edit account → 6110 → submit → approved → /books journal shows 6110 line. Axe on open sheet.
- [ ] `CHECK` + spec. Commit: `feat(today): real review editor — approve with corrected account/VAT/amounts (append-only)`.

## Task 3.10 — SIE web surfaces on the real endpoints

**Depends on 3.4. Parallel with 3.6–3.9.** **Files — Modify:** `apps/web/components/capture/quick-add-grid.tsx` (importSie via apiClient, toast with importedVouchers + skipped), `apps/web/components/screens/reports-screen.tsx` (bytes → Blob download, `jpx-export-<day>.se`), `apps/web/messages/en.json` + `sv.json`.

- [ ] `CHECK` + `E2E:file api.spec.ts` + `E2E:file reports.spec.ts`. Commit: `feat(web): SIE import/export ride the real parser/serializer (bytes, result summary, offline demo support)`.

## Task 3.11 — Phase-3 exit gate

**Files — Create:** `tests/e2e/capture-loop.spec.ts`. **Modify:** `docs/DEV_STATUS.md`, capture visual baselines only, `docs/CONVENTIONS.md` if warranted.

- [ ] `capture-loop.spec.ts` — THE real loop, both projects: reset → setInputFiles receipt.jpg → auto-promote → evidence-row → detail (preview + deterministic supplier + non-1249 gross, cross-checked via `GET /api/evidence/:id`) → open review (same gross via Money) → approve → /books journal 3 new lines (expense = derived net) → seed still shows 1249 amounts (pin).
- [ ] Full `CHECK` + full `E2E` (both projects/themes). Re-baseline ONLY `capture-{light,dark}.png` after diff review; any other diff is a bug.
- [ ] Grep gates: `1249` only in the legacy-compat branch of evidence-defaults; `\.bin|application/octet-stream` zero in apps/web/components; extract route persists before returning.
- [ ] Parity proof inventory per plan; INTEG run or documented manual smoke (explicitly noting NO migration shipped).
- [ ] Update DEV_STATUS (limitations: shared-file staging needs API reachability; imported vouchers have no voucher rows; imports carry `vatCode: "NA"`). Commit: `chore: phase 3 exit — real capture loop, persisted extraction, edited approvals, real SIE; regression-locked`.

---

### Critical Files for Implementation

- `packages/contracts/src/index.ts` — every schema/event-type addition (four tasks touch it; sequential atomic commits)
- `packages/domain/src/store.ts` — `LedgerStore` interface + Memory implementations
- `packages/persistence-postgres/src/store.ts` — Postgres parity + `getReports` replay widening + evidence `metadata` jsonb
- `services/api/src/app.ts` — extract persistence, context/file-url routes, stub PUT, SIE routes, onError branches
- `apps/web/lib/promotion.ts` (new) — the single client pipeline every intake surface funnels through
