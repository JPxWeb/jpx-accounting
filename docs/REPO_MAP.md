# Repo Navigation Map

**Purpose:** the WHERE-IS-WHAT index for this monorepo — route inventories, module export maps, event-append sites, journey→files traces, and the gotchas that mislead newcomers (human or AI). Complements [CLAUDE.md](../CLAUDE.md) / [AGENTS.md](../AGENTS.md) (conventions + commands) and [architecture.md](architecture.md) (runtime shape); supersedes the short "Repo map" table in [CONTRIBUTING.md](CONTRIBUTING.md) for navigation purposes.

**Verified against code:** 2026-08-06 (commit `1da068f` + working tree). Line numbers drift — treat them as anchors, not gospel. Update this file when adding routes, events, packages, or storage keys.

---

## 1. Workspace inventory

`pnpm-workspace.yaml` globs: `apps/*`, `services/*`, `packages/*`. Root: `jpx-accounting` (private, pnpm 10.29.2, Node ≥24).

| Path                             | Package                 | Responsibility                                                                         | Internal deps (`@jpx-accounting/*`)                                                         |
| -------------------------------- | ----------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `apps/web`                       | `web`                   | Next 16 App Router PWA — all screens, client persistence, api-proxy                    | advisor, api-client, contracts, domain, reporting, ui-tokens                                |
| `services/api`                   | `api`                   | Hono 4 HTTP API — routing, auth, rate limits, blob/DocIntel/advisor wiring             | advisor, ai-core, contracts, document-intelligence, domain, persistence-postgres, reporting |
| `packages/contracts`             | `contracts`             | Zod v4 schema + type source of truth (the only leaf)                                   | —                                                                                           |
| `packages/domain`                | `domain`                | Event-sourced ledger core: store, projections, hash chain, SIE, VAT, CoA, tax calendar | contracts                                                                                   |
| `packages/reporting`             | `reporting`             | KPIs, narrative facts, six observation detectors over a `ReportPack`                   | contracts                                                                                   |
| `packages/advisor`               | `advisor`               | Retrieval (BM25-lite), corpus, grounding, injection sanitizing, demo turn              | contracts, reporting                                                                        |
| `packages/ai-core`               | `ai-core`               | `AiRuntime` factory + embeddings (OpenAI SDK against Azure)                            | contracts, domain                                                                           |
| `packages/api-client`            | `api-client`            | Typed fetch client with Zod response validation + demo fallback store                  | contracts, domain                                                                           |
| `packages/document-intelligence` | `document-intelligence` | Azure Document Intelligence OCR client + field→contract mapping                        | contracts, domain                                                                           |
| `packages/persistence-postgres`  | `persistence-postgres`  | `PostgresLedgerStore` + pgvector knowledge tables + pool client                        | advisor, contracts, domain                                                                  |
| `packages/ui-tokens`             | `ui-tokens`             | Brand/theme token constants + `styles.css`                                             | —                                                                                           |

**Dependency direction** (strict, no cycles):

```
contracts ← domain ← ai-core, api-client, document-intelligence, persistence-postgres
contracts ← reporting ← advisor ← persistence-postgres, services/api, apps/web
ui-tokens (leaf)
services/api → everything except api-client, ui-tokens
apps/web    → advisor, api-client, contracts, domain, reporting, ui-tokens
              (NOT persistence-postgres, ai-core, document-intelligence)
```

Note: `persistence-postgres → advisor` (corpus chunk types in `knowledge.ts`) is the only edge that isn't obviously downhill.

⚠ `packages/supabase-client/` is a **dead ghost directory** — only a stale `node_modules/`, no `package.json`, no tracked files. Safe deletion candidate.

---

## 2. API route inventory — `services/api/src/app.ts`

Entry: [services/api/src/index.ts](../services/api/src/index.ts) (telemetry → `readApiRuntimeConfig()` → `createApiRuntimeDependencies()` → `createApp()` → `@hono/node-server`).

### Middleware stack (registration order matters)

1. `*` request-id (accept `x-request-id` or mint uuid; echoed on response)
2. `/api/*` CORS — wildcard in demo, allowlist from `ACCOUNTING_CORS_ORIGINS` in normal
3. Body limits: `/api/imports/sie` **32 MiB**; stub `PUT /api/uploads/:id` **16 MiB** (`MAX_UPLOAD_BYTES`); all other `/api/*` POST/PUT/PATCH **512 KiB**
4. `/api/*` **JWT** via `hono/jwk` when `jwksUrl` set — TTL-cached single-flight JWKS fetcher `createCachedJwksFetcher` (10 min). Sole exemption: `GET /api/runtime-info`
5. Rate limits: mutations **60/min**, reads (`/api/reports/*` + `/api/exports/*`) **120/min**. Key = `sub:<jwt sub>` else `ip:<clientIpKey>`. Bypassed only when `allowTestReset && demo`
6. `secureHeaders` — CSP `default-src 'none'`, `frame-ancestors 'none'`
7. `app.onError` — the single error→HTTP mapping (`ApiValidationError`→400; advisor/review-edit/SIE/period errors→422; `AdvisorDisabledError`→403; `ReviewNotFoundError`→404; store/AI-unavailable + JWKS-fetch→503; PG `23505`→409; PG `08*`/`57*`→503)

### Routes

| Method | Path                                | Purpose                                                                 | Backing dep                                                 |
| ------ | ----------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------- |
| GET    | `/health`                           | Liveness `{ok, runtimeMode}` (public, outside `/api`)                   | none                                                        |
| GET    | `/ready`                            | Readiness — `pingLedgerStore` + `isAiRuntimeOperational` (public)       | store + aiRuntime                                           |
| GET    | `/api/runtime-info`                 | AI Act Art. 50 transparency — **public even with auth on**              | `aiMetadata`                                                |
| GET    | `/api/workspace`                    | Full `WorkspaceSnapshot`                                                | `store.getSnapshot()`                                       |
| GET    | `/api/reviews/feed`                 | Review queue                                                            | `store.getReviewFeed()`                                     |
| GET    | `/api/reports/journal`              | Journal lines, optional `?from=&to=`                                    | `store.getReports()`                                        |
| GET    | `/api/reports/general-ledger`       | Balances                                                                | `store.getReports()`                                        |
| GET    | `/api/reports/trial-balance`        | ⚠ **identical handler** to general-ledger (`reportBalances`)            | `store.getReports()`                                        |
| GET    | `/api/reports/vat-prep`             | VAT projection rows                                                     | `store.getReports()`                                        |
| GET    | `/api/reports/pack`                 | ONE `ReportPack` per `?period=` token                                   | `store.getReportPack()`                                     |
| GET    | `/api/integrity`                    | Hash-chain summary (`verifyPayloads: true`)                             | `summarizeEventIntegrity(store.getEvents())`                |
| POST   | `/api/evidence`                     | Create evidence (201); actor server-derived                             | `store.createEvidence()`                                    |
| POST   | `/api/evidence/compose`             | Compose multi-part evidence packet (201)                                | `store.composeEvidence()`                                   |
| POST   | `/api/uploads/init`                 | Mint upload URL (Azure SAS or stub)                                     | `blobUploader.initUpload()`                                 |
| PUT    | `/api/uploads/:uploadId`            | **Stub uploader only** — accept-and-discard bytes                       | `blobUploader.kind === "stub"`                              |
| POST   | `/api/evidence/:id/extract`         | DocIntel on real blobs, persist refreshed extraction, fail-soft         | DocIntel + `mintReadSas` + `store.updateEvidenceExtraction` |
| GET    | `/api/evidence/:id`                 | Evidence context + review join                                          | `store.getEvidenceContext`                                  |
| GET    | `/api/evidence/:id/file-url`        | Short-lived read SAS; 404 `preview_unavailable` unless azure uploader   | `blobUploader.mintReadSas`                                  |
| POST   | `/api/vouchers/:id/suggest`         | Deterministic accounting suggestion                                     | `store.suggestVoucher()`                                    |
| POST   | `/api/reviews/:id/approve`          | Approve → posts to ledger                                               | `postReviewDecision(..., "approve")`                        |
| POST   | `/api/reviews/:id/reject`           | Reject                                                                  | `postReviewDecision(..., "reject")`                         |
| POST   | `/api/reviews/:id/book-without-vat` | Book without VAT deduction                                              | `postReviewDecision(..., "book-without-vat")`               |
| POST   | `/api/imports/sie`                  | Raw SIE 4 bytes → parse → import                                        | `decodeSieBuffer` + `parseSie` + `store.importSie`          |
| GET    | `/api/exports/sie`                  | PC8/CP437 `.se` download (`charset=ibm437`)                             | `buildSieExport` + `encodePc8`                              |
| POST   | `/api/advisor/chat`                 | AI SDK 7 UI-message SSE stream                                          | `advisorChat` handler                                       |
| POST   | `/api/knowledge/query`              | BM25-lite (or pgvector) retrieval                                       | `queryKnowledge()`                                          |
| POST   | `/api/simulations/run`              | What-if approval simulation (201)                                       | `store.runSimulation()`                                     |
| POST   | `/api/close-runs`                   | Returns current close run (201)                                         | `store.getCloseRun()`                                       |
| GET    | `/api/close-runs/:id`               | Only current close-run id valid; else 404                               | `store.getCloseRun()`                                       |
| POST   | `/api/compliance-watch/refresh`     | Re-run detectors; `?includeResolved=true`                               | `store.refreshComplianceAlerts()`                           |
| GET    | `/api/settings/company`             | Company settings or `null`                                              | `store.getCompanySettings()`                                |
| PUT    | `/api/settings/company`             | Save company settings                                                   | `store.putCompanySettings()`                                |
| POST   | `/api/testing/reset`                | Swap in fresh `MemoryLedgerStore` — 404 unless `allowTestReset && demo` | in-proc                                                     |
| POST   | `/mcp`                              | **Demo mode only** — echo stub listing tool names (no real MCP server)  | none                                                        |

⚠ Retired: `POST /api/assistant/sessions` (removed Phase 6, superseded by `/api/advisor/chat`) — but `store.answerAssistantQuestion()` + `packages/domain/src/assistant.ts` still exist with no live route (see §12).

### Handler locations

- **`app.ts`** — all route handlers are inline arrows inside `createApp()`. Exported: `createCachedJwksFetcher`, `clientIpKey`, `createApp`.
- **`advisor/chat.ts`** — `createAdvisorChatHandler`, `validateProposalAgainstStore`, `executeReviewApproval`, `buildSystemPrompt`, `selectChatPassages`, `truncateAdvisorHistory`, `resolveAdvisorStreamLimits`; bounds: `MAX_ADVISOR_MESSAGES` 40, `MAX_ADVISOR_MESSAGE_BYTES` 8 KiB, model history 20 msgs / 96 KiB, `ADVISOR_VECTOR_MIN_SIMILARITY` 0.25.
- **`advisor/model.ts`** — `createAdvisorModel(config)` (Azure via `@ai-sdk/azure`).
- **`knowledge.ts`** — `queryKnowledge()`, `configureKnowledgeDatabaseClient()`, `VectorKnowledgeRetriever`; vector failures fail-soft to keyword.
- **`blob.ts`** — `BlobUploader`, `StubBlobUploader`, `AzureBlobUploader`, `createBlobUploader`, `MAX_UPLOAD_BYTES`, `UploadValidationError`.
- **`runtime.ts`** — `createApiRuntimeDependencies` (DI composition root), `UnavailableLedgerStore`, `pingLedgerStore`, `LedgerStoreUnavailableError`.
- **`validation.ts`** — `jsonValidated(schema)`, `ApiValidationError`.
- **`config.ts`** — `readApiRuntimeConfig`, `describeBootPosture` (all env parsing).
- **`telemetry.ts`** — `initTelemetry` (Azure Monitor OTel; strict no-op without connection string).

---

## 3. Web route inventory — `apps/web/app/`

Route groups: `(shell)` = app chrome; `/login` and `/share` sit outside it.

| Route                    | Screen component                                                                                                                                                                          | API consumption                                                                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                      | —                                                                                                                                                                                         | `redirect()` → `/today`                                                                                                                                                               |
| `/today`                 | `components/screens/today-screen.tsx` → `components/dashboard/dashboard.tsx` \| `components/today/review-queue-view.tsx` (nuqs `?view=`)                                                  | `components/dashboard/use-dashboard-data.ts`: `["workspace"]`, `["reports","pack",…]`, `["integrity"]`, `["company-settings"]`; queue mutations approve/reject/book/simulate          |
| `/capture`               | `components/screens/capture-screen.tsx`                                                                                                                                                   | drafts from IndexedDB; writes via `lib/promotion.ts` → `initUpload`/`uploadBlob`/`createEvidence`; `quick-add-grid.tsx` → `importSie`                                                 |
| `/capture/evidence/[id]` | `components/screens/evidence-detail-screen.tsx`                                                                                                                                           | `GET /api/evidence/:id`, `…/file-url`, mutation `POST …/extract`                                                                                                                      |
| `/books`                 | `components/screens/books-screen.tsx` → `books/{journal,general-ledger,trial-balance,suppliers,close}-view.tsx`                                                                           | `GET /api/reports/journal`, `…/trial-balance`, `["workspace"]`                                                                                                                        |
| `/reports`               | `components/screens/reports-screen.tsx` → `reports/*` (statements, vat-return-table, kpi-row, narrative-card, tax-timeline-row, account-drill-drawer `?drill=`, `charts/*`, print-header) | `GET /api/reports/pack?period=`, `["workspace"]`, `GET /api/exports/sie`                                                                                                              |
| `/assistant`             | `components/screens/assistant-screen.tsx` → `components/advisor/advisor-chat.tsx`                                                                                                         | streams `POST /api/advisor/chat`; demo path: `components/advisor/local-demo-transport.ts`                                                                                             |
| `/settings`              | —                                                                                                                                                                                         | `redirect()`                                                                                                                                                                          |
| `/settings/company`      | `components/settings/company-form.tsx`                                                                                                                                                    | `GET/PUT /api/settings/company`; writes `NEXT_LOCALE` cookie                                                                                                                          |
| `/settings/fiscal-year`  | `components/settings/fiscal-year-form.tsx`                                                                                                                                                | `saveCompanySettings`                                                                                                                                                                 |
| `/settings/ai-posture`   | `components/settings/ai-posture-form.tsx`                                                                                                                                                 | `["company-settings"]`, `GET /api/runtime-info`                                                                                                                                       |
| `/settings/compliance`   | `components/settings/compliance-integrity-panel.tsx` + `compliance-alerts-panel.tsx`                                                                                                      | `["integrity"]`, `POST /api/compliance-watch/refresh`                                                                                                                                 |
| `/settings/integrations` | `components/settings/integrations-posture.tsx`                                                                                                                                            | `GET /api/runtime-info`                                                                                                                                                               |
| `/settings/team`         | `components/settings/team-overview.tsx`                                                                                                                                                   | `["integrity"]`                                                                                                                                                                       |
| `/settings/retention`    | inline server render                                                                                                                                                                      | none — renders `lib/local-data.ts` registry + `lib/legal-sources.ts`                                                                                                                  |
| `/settings/about`        | `components/screens/settings-about-screen.tsx`                                                                                                                                            | `webRuntimeConfig`, `useWorkspaceProfile`, onboarding replay                                                                                                                          |
| `/login`                 | `components/auth/login-screen.tsx` (outside shell)                                                                                                                                        | Supabase Auth via `lib/auth/session.ts`                                                                                                                                               |
| `/api-proxy/[...path]`   | Route Handler                                                                                                                                                                             | Reverse proxy to `ACCOUNTING_API_BASE_URL`; forwards only `accept, authorization, content-type, x-request-id`; **streams body unbuffered** (SSE); 33 MiB cap; path-traversal hardened |
| `/share`                 | Route Handler (PWA share_target POST)                                                                                                                                                     | server-side forward: `initUpload` → PUT → `createEvidence` → fire-and-forget extract → redirect `/capture?promoted=n`. ⚠ **Unsupported when auth is on** (no server session)          |
| `/manifest.webmanifest`  | `app/manifest.ts`                                                                                                                                                                         | static PWA manifest incl. `share_target`                                                                                                                                              |

Layouts: root `app/layout.tsx` (`ThemeProvider` → `NextIntlClientProvider` → skip-link → `QueryProvider` → `WorkspaceProfileProvider` → `NuqsAdapter` → `ServiceWorkerRegistrar` → `Toaster`); shell `app/(shell)/layout.tsx` (`OnboardingShell` → `AppShell`).

⚠ **`apps/web/hooks/` contains no data-fetching hooks** — only `use-mobile`, `use-object-url`, `use-period-scope`, `use-review-keyboard`, `use-scroll-direction`. All API access goes through the singleton `apps/web/lib/client.ts` (`apiClient`) inside component-level `useQuery`/`useMutation`, plus the one composite data hook at `components/dashboard/use-dashboard-data.ts`.

Cross-cutting: `components/app-shell.tsx` (nav + mobile dock + capture sheet), `components/command-palette.tsx` (Cmd-K), `components/period/period-selector.tsx` + `period-options.ts`, `hooks/use-period-scope.ts` (resolves `?period=` through the **domain** `resolvePeriodToken` so client and server can't disagree).

---

## 4. Domain & package module map

### `packages/domain/src/` (barrel `index.ts` re-exports everything)

| Module                                                 | Key exports                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `store.ts`                                             | `LedgerStore` (18 methods), `MemoryLedgerStore`, `ReviewAction`, `ActorAttribution`, `DEMO_ACTOR_ID`, `ReviewNotFoundError`, `InvalidReviewEditError`, `SieImportError`, `isDuplicateEvidence`, `validEditVatCodes`, `resolveReviewDecisionEdit`, `planSieImport`, `deriveBookedAt`, `buildPostingLines`, `mergeExtractedFields`, `recomputeVoucherFields`, SIE caps (500 vouchers / 100 lines) |
| `projections.ts`                                       | `LedgerLine`, `filterLedgerLines`, `buildJournal`, `buildBalances`, `buildVat`                                                                                                                                                                                                                                                                                                                  |
| `hash-chain.ts`                                        | `canonicalJson`, `sha256Hex`, `buildEventHash`, `legacyDjb2EventHash`, `detectEventHashScheme`, hash patterns                                                                                                                                                                                                                                                                                   |
| `integrity.ts`                                         | `summarizeEventIntegrity(events, {verifiedAt, verifyPayloads})` → the `/api/integrity` payload                                                                                                                                                                                                                                                                                                  |
| `evidence-defaults.ts`                                 | `guessSupplier`, `buildExtractedFields`, `deriveVoucherFields`, `guessAccountingMethod`, `initialLedgerLines`                                                                                                                                                                                                                                                                                   |
| `deterministic-extraction.ts`                          | `fnv1a`, `deriveDeterministicExtraction` (stable pseudo-OCR from `{filename, sizeBytes}`)                                                                                                                                                                                                                                                                                                       |
| `rules.ts`                                             | `confidenceBand` (0.85/0.6 — the ONE tier source), `evaluateVoucherRules`, `buildDeterministicSuggestion`                                                                                                                                                                                                                                                                                       |
| `posting-invariants.ts`                                | `assertBalancedPosting`, `UnbalancedPostingError` (öre precision)                                                                                                                                                                                                                                                                                                                               |
| `compliance.ts`                                        | `detectComplianceIssues[Detailed]` (`stale-blocked`, `missing-supplier-vat`)                                                                                                                                                                                                                                                                                                                    |
| `simulation.ts`                                        | `simulateApprovals`                                                                                                                                                                                                                                                                                                                                                                             |
| `assistant.ts`                                         | ⚠ legacy `buildAssistantScaffold` — no live route                                                                                                                                                                                                                                                                                                                                               |
| `ids.ts`                                               | `createId(prefix)`, `nowIso()`, `today()` (id + clock seam)                                                                                                                                                                                                                                                                                                                                     |
| `reports/period.ts`                                    | `resolvePeriodToken`, `currentMonthToken`, `PeriodKind`, `InvalidPeriodTokenError` — THE period token grammar (`2026-07`, `2026-Q3`, `fy-2026`, `ytd`, `all`)                                                                                                                                                                                                                                   |
| `reports/pack.ts`                                      | `buildReportPack` — ONE `ReportPack` per period                                                                                                                                                                                                                                                                                                                                                 |
| `reports/statements.ts`                                | `buildProfitLoss`, `buildBalanceSheet`                                                                                                                                                                                                                                                                                                                                                          |
| `reports/cash.ts`                                      | `buildCashBridge`, `buildMonthlySeries`                                                                                                                                                                                                                                                                                                                                                         |
| `tax/calendar.ts`                                      | `buildTaxTimeline`, `currentVatPeriodToken`, `TAX_DEADLINE_SOURCES` (source-cited Swedish deadlines)                                                                                                                                                                                                                                                                                            |
| `vat/regime.ts`                                        | `swedishVatRegime`, `getVatRegime(country)` (country-pluggable; SE only)                                                                                                                                                                                                                                                                                                                        |
| `vat/boxes.ts`                                         | `buildVatReturnBoxes`                                                                                                                                                                                                                                                                                                                                                                           |
| `coa/registry.ts` + `coa/bas-2026.ts` + `coa/types.ts` | `coaTemplates`, `getCoaTemplate`, `findCoaAccount`, `classifyAccountNumber`, `bas2026`                                                                                                                                                                                                                                                                                                          |
| `sie/parse.ts` / `sie/serialize.ts` / `sie/pc8.ts`     | `parseSie`, `buildSieExport`, `encodePc8`/`decodePc8`/`decodeSieBuffer` (CP437)                                                                                                                                                                                                                                                                                                                 |

### `packages/contracts/src/index.ts` — schema groups in file order

1. Enums (`roleSchema` … `eventTypeSchema` … `assistantAnswerStatusSchema`)
2. Core entities (`evidenceObjectSchema`, `voucherSchema`, `accountingSuggestionSchema`, `reviewTaskSchema`, …)
3. Event log (`ledgerEventSchema` — envelope `{aggregateId, aggregateType, eventType, actorId, occurredAt, payload, previousHash, eventHash, digestDate}`)
4. Projections · 5. Sessions/runs · 6. Reports (`reportPackSchema` et al.)
5. Evidence I/O · 8. **Request inputs** (no `actorId` field anywhere — deleted, server-derived)
6. Settings (`workspaceProfileSchema`, `aiPostureSchema`, `companySettingsSchema`)
7. Import/upload · 11. Snapshot (`workspaceSnapshotSchema`) · 12. Tax + observations · 13. Integrity + knowledge + runtime-info

Siblings: `api-errors.ts` (JSON error envelope), `countries.ts` (⚠ NOT re-exported from the barrel; reachable only transitively via `domain`).

### Other packages

- **`reporting`** — `kpis.ts` (`buildKpis`), `narrative.ts` (`buildReportNarrative` — prose reconciles with pack by construction), `observations.ts` (six detectors + `buildObservations`; tunables: runway 1.5/3 months, z-threshold 2, deadline proximity 14 d, supplier spike ×2, limit 5).
- **`advisor`** — `retrieval.ts` (BM25-lite + `hasRetrievableContent` gate), `corpus.generated.ts` (⚠ generated — `pnpm build:knowledge`), `corpus-source.ts` (chunker; not in barrel), `excerpt.ts` (`buildExcerpt`), `sanitize.ts` (`delimitUntrustedText` with `«»`), `context.ts` (`buildAdvisorGrounding` — copies numbers, never recomputes), `demo-turn.ts` (`buildDemoAdvisorTurn`), `prompts.ts`.
- **`ai-core`** — `createAiRuntime`, `isAiRuntimeOperational`, `AiRuntimeUnavailableError`, `embed()`.
- **`api-client`** — `createAccountingApiClient` (23 methods, Zod-validated responses, bearer via `getAuthToken`, demo fallback store).
- **`document-intelligence`** — `createDocumentIntelligenceClient`, `pickModelForDocument`, `mapFieldsToContract`.
- **`persistence-postgres`** — `client.ts` (`createPostgresClient`/`closePostgresClient`), `store.ts` (largest file in the repo: `PostgresLedgerStore`, `HashChainForkError`, advisory-lock chain serialization), `knowledge.ts` (`upsertKnowledgeDocuments`, `queryKnowledgeByEmbedding`, halfvec 1536).
- **`ui-tokens`** — `brand`, `theme`, `styles.css` (imported by `apps/web/app/globals.css`).

---

## 5. Event vocabulary

Defined in `packages/contracts/src/index.ts` (`eventTypeSchema`). 19 names, **7 reserved (never emitted)**.

| Event                                                          | Emitted?          | Append sites                                                                                                         |
| -------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| `EvidenceReceived`                                             | ✅                | `domain/store.ts` + `persistence-postgres/store.ts` (createEvidence)                                                 |
| `EvidenceClassified`                                           | ❌ reserved       | —                                                                                                                    |
| `EvidenceRelinked`                                             | ✅                | both stores (composeEvidence)                                                                                        |
| `FieldsExtracted`                                              | ✅                | both stores (createEvidence)                                                                                         |
| `ExtractionRefreshed`                                          | ✅                | both stores (updateEvidenceExtraction)                                                                               |
| `VoucherCreated`                                               | ✅                | both stores (createEvidence)                                                                                         |
| `RuleSetApplied`                                               | ❌ reserved       | rule hits ride `SuggestionGenerated` payloads                                                                        |
| `SuggestionGenerated`                                          | ✅ ×2 sites/store | createEvidence + extraction refresh                                                                                  |
| `ReviewApproved` / `ReviewRejected` / `ReviewBookedWithoutVat` | ✅                | both stores (applyReviewDecision ternary)                                                                            |
| `PostedToLedger`                                               | ✅                | both stores; **the projection source** — Postgres reads `WHERE event_type = ANY('PostedToLedger','VoucherImported')` |
| `VoucherImported`                                              | ✅                | both stores (importSie; dedupe scan first)                                                                           |
| `CorrectionPosted` / `PeriodLocked`                            | ❌ reserved       | land with period close                                                                                               |
| `PolicyVersionActivated`                                       | ❌ reserved       | —                                                                                                                    |
| `SimulationExecuted`                                           | ✅                | both stores (runSimulation)                                                                                          |
| `CloseRunGenerated` / `ExportGenerated`                        | ❌ reserved       | close run is an honest empty shell; exports don't append                                                             |

There is no `EvidenceAdded` event — the name is `EvidenceReceived`.

---

## 6. Feature → files by journey stage

### A. Capture (intake → upload → evidence → extraction)

1. `apps/web/components/screens/capture-screen.tsx` (`?shared=` / `?promoted=`)
2. `apps/web/components/capture/quick-add-grid.tsx` / `drop-zone.tsx` / `drafts-table.tsx`
3. `apps/web/lib/draft-queue.ts` + `draft-queue-core.ts` — IndexedDB → sessionStorage → memory ladder
4. **`apps/web/lib/promotion.ts`** — THE promotion pipeline (`captureFiles`, `promoteDraft`, `joinInFlight`, 16 MB cap) + `lib/hash.ts` (client SHA-256)
5. `apps/web/lib/evidence-blob-cache.ts` — device preview cache (50 blobs)
6. `packages/api-client` `initUpload` → `uploadBlob` → `createEvidence`
7. API: `POST /api/uploads/init`, `POST /api/evidence` + `services/api/src/blob.ts`
8. `packages/domain/src/evidence-defaults.ts` → `store.createEvidence()` → events
9. `POST /api/evidence/:id/extract` → `packages/document-intelligence` → `store.updateEvidenceExtraction()` → `ExtractionRefreshed`
10. `apps/web/components/screens/evidence-detail-screen.tsx`

Alternate entry: `apps/web/app/share/route.ts` (PWA share target; demo-only under auth).

### B. Review (queue → decision → posting)

1. `apps/web/components/today/review-queue-view.tsx` (+ `review-filters.tsx`)
2. `review-card.tsx` + `review-card-actions.tsx` + `hooks/use-review-keyboard.ts` (J/K/Y/N/E/B)
3. `review-edit-sheet.tsx` — corrected account/VAT before approval
4. `simulation-preview-modal.tsx` → `POST /api/simulations/run`
5. API `POST /api/reviews/:id/{approve|reject|book-without-vat}` → `postReviewDecision` → `deriveActorId` (JWT `sub`)
6. `packages/domain/src/store.ts` `applyReviewDecision` → `resolveReviewDecisionEdit` → `deriveBookedAt` → `buildPostingLines` → `assertBalancedPosting`
7. Events: `Review*` then `PostedToLedger`
8. `apps/web/lib/query-invalidation.ts` — `invalidateLedgerDerived` fans out to 5 query families

### C. Books & reports (projections → period → drill)

1. `hooks/use-period-scope.ts` + `components/period/*` (nuqs `?period=`)
2. `packages/domain/src/reports/period.ts` `resolvePeriodToken` (shared both sides)
3. `GET /api/reports/pack` → `buildReportPack` → `projections.ts` + `statements.ts` + `cash.ts` + `vat/boxes.ts`
4. `packages/reporting` kpis / narrative / observations
5. `components/screens/reports-screen.tsx` → `reports/*` sub-views + `charts/*`
6. Drill: `reports/account-drill-drawer.tsx` (`?drill=`) → `GET /api/reports/journal?from=&to=`
7. Books tabs: `components/books/*-view.tsx`
8. SIE: export `GET /api/exports/sie` (`sie/serialize` + `pc8`), import `POST /api/imports/sie` (`sie/parse` + `planSieImport`)

### D. Advisor (chat → retrieval → tool approval)

1. `components/screens/assistant-screen.tsx` → `components/advisor/advisor-chat.tsx` (`@ai-sdk/react`)
2. `components/advisor/local-demo-transport.ts` — offline/demo transport
3. `components/advisor/tool-approval.ts` — ⚠ `respondToApprovalPreservingSignature`, the `ai@7.0.15` HMAC-drop workaround (delete only when the SDK bug is fixed; pinned by `tests/unit/web-tool-approval.test.ts`)
4. `approval-card.tsx`, `message-part.tsx`, `provenance-chips.tsx`, `suggested-prompts.tsx`
5. `app/api-proxy/[...path]/route.ts` — must stream SSE unbuffered
6. API: `services/api/src/advisor/chat.ts` `createAdvisorChatHandler` (gate order: body bounds 400/422 → `aiPosture.advisorEnabled` 403 → model configured 503 → grounding → stream)
7. Grounding: `store.getSnapshot()` + `getReportPack` + `buildTaxTimeline` + `buildObservations` → `packages/advisor/src/context.ts`
8. Retrieval: `packages/advisor/src/retrieval.ts` gate → keyword, or `services/api/src/knowledge.ts` → `packages/persistence-postgres/src/knowledge.ts` (vector)
9. Injection defense: `packages/advisor/src/sanitize.ts`
10. Tool execution: `validateProposalAgainstStore` → `executeReviewApproval` → the **same** `applyReviewDecision` as the review button

### E. Settings

`app/(shell)/settings/layout.tsx` + `components/settings/settings-sidebar.tsx` → 8 leaf pages (§3) → `components/settings/*` → `GET|PUT /api/settings/company` → `companySettingsSchema` (`workspaceProfileSchema` + `aiPostureSchema`). Retention page is a pure render of `lib/local-data.ts`.

### F. Onboarding

`app/(shell)/layout.tsx` → `components/onboarding/onboarding-shell.tsx` → `onboarding-context.tsx` → tooltip/progress/micro-hints/hotkey-strip; state in `lib/onboarding/onboarding-storage.ts` (key `jpx.accounting.onboarding.v1`); tours in `tour-definitions.ts` + `tour-ids.ts`; milestones in `milestone-derivation.ts` (`capture|approve|import|advisor|profile`); dashboard entry `components/dashboard/widgets/getting-started-widget.tsx`.

### G. Auth

`/login` → `lib/auth/session.ts` (`useAuthSession`, `signOutAndClearLocalData`) → `lib/auth/supabase-client.ts` → bearer via `lib/client.ts` `getAuthToken` → api-proxy forwards `authorization` → `hono/jwk` + `createCachedJwksFetcher` → `deriveActorId` → `user:<sub>`. Sign-out → `lib/local-data.ts` `clearAllLocalData()`.

---

## 7. Tests layout

### `tests/unit/` — 47 files, `tsx --test`, kebab-case `<subject>.test.ts`

Notable pinned regression tests:

- `local-data-registry.test.ts` — pins every storage key AND scans `apps/web` for unregistered storage writers.
- `web-query-invalidation.test.ts` — pins `LEDGER_DERIVED_QUERY_KEYS` (the canonical invalidation list).
- `web-tool-approval.test.ts` — the `ai@7.0.15` signature workaround net; **re-test on every `ai` bump**.
- `advisor-retrieval-gate.test.ts` — smalltalk must yield ZERO sources.
- `promotion.test.ts` — `joinInFlight` double-click race semantics.
- `api-telemetry.test.ts` — ⚠ test order within the file matters (documented inside).

Coverage: `.c8rc.json` + `pnpm test:unit:coverage` (ratcheting floors).

### `tests/integration/` — 6 test files + 3 helpers

| File                               | Gate                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `ledger-store-conformance.test.ts` | Memory always; Postgres + parity behind gate                                 |
| `postgres-ledger.test.ts`          | Postgres gate                                                                |
| `api-postgres-smoke.test.ts`       | Postgres gate; in-process Hono ↔ Postgres with ES256 test key + stubbed JWKS |
| `schema-contract.test.ts`          | Postgres gate; mirrors `db-migrations.mts verify`                            |
| `knowledge-query.test.ts`          | Postgres gate (pgvector + idempotent re-ingest)                              |
| `advisor-normal-mode.test.ts`      | no DB — `helpers/mock-openai-responses-server.ts`                            |

Gating: `helpers/postgres-test-context.ts` — URL resolution `DATABASE_TEST_URL → DATABASE_URL → SUPABASE_DB_URL`; DB name **must** start `jpx_test_`; `JPX_REQUIRE_DATABASE_TESTS=true` turns skips into failures. Shared scenarios: `helpers/ledger-store-conformance.ts`.

### `tests/e2e/` — 22 specs (~75 tests), Playwright

Projects `desktop-chromium` + `mobile-chromium` (Pixel 7); servers API `127.0.0.1:3201` / web `127.0.0.1:3200`. Helpers: `test-helpers.ts` (**`activateControl`** — keyboard activation on mobile; the Chromium visual-viewport 51 px offset bug makes pointer clicks unreliable), `a11y-helpers.ts` (`expectAccessible`, axe WCAG 2.2 AA). Visual baselines: `visual-regression.spec.ts-snapshots/` — 40 PNGs = 5 screens × 2 themes × 2 viewports × 2 platforms (`-win32`, `-linux`); procedure in `scripts/visual-baselines.md`. Fixtures: `tests/fixtures/` (`invoice.pdf`, `receipt.jpg`, `sie/golden-export.se`, `sie/minimal-4i.se`).

---

## 8. Scripts + infra

### `scripts/`

| File                                        | Purpose                                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- | --- | --- | ------- | ----- | ---- | ---- | ----------------------------------------- |
| `build-knowledge-corpus.mjs`                | `docs/knowledge/sv/*.md` → `packages/advisor/src/corpus.generated.ts` (`pnpm build:knowledge`) |
| `check-corpus-freshness.mjs`                | Corpus freshness tripwire (`pnpm check:corpus`) — ⚠ not in CI                                  |
| `check-i18n-parity.mjs`                     | en↔sv key parity gate (part of `pnpm check`)                                                   |
| `check-seams.sh`                            | Architectural seam grep gates — ⚠ not wired to CI                                              |
| `db.mts`                                    | Local Postgres lifecycle over `compose.db.yml` (`db:doctor                                     | up  | url | migrate | reset | seed | test | down`); per-clone/agent Compose isolation |
| `db-migrations.mts`                         | Locked, checksum-tracked migration runner; dynamic discovery + `verify`                        |
| `db-seed.mts`                               | Deterministic dev seed (`jpx_dev`)                                                             |
| `ingest-knowledge.mjs`                      | Corpus → Postgres pgvector (`pnpm ingest:knowledge`)                                           |
| `generate-brand-assets.mjs`                 | PWA icons/og-image from `apps/web/public/brand/logo.svg`                                       |
| `integration-db.md` / `visual-baselines.md` | Docs: local DB lifecycle; visual re-baseline procedure                                         |

### `infra/`

- `infra/azure/main.bicep` — 2 App Services (web westeurope, api) + Storage (swedencentral) on existing `jpx-app-plan`; `assignStorageRoles` (default `false`) is the CD-unblock flag (`docs/DEPLOY_UNBLOCK.md`).
- `infra/supabase/migrations/` — `0001_init` (base ledger schema) · `0002_schema_alignment` · `0003_pgvector` (halfvec) · `0004_compliance_and_settings` · `0005_events_id_text` (uuid→text — critical) · `0006_chain_serialization` (seq + fork constraint) · `0007_knowledge_tenant_pk` · `0008_evidence_dedupe_index`.

### `.github/workflows/`

- `ci.yml` — jobs: check, build, postgres-matrix → integration-postgres (`pnpm db:test`, no silent skips), bicep, e2e (**opt-in on PRs via `run-e2e` label**; automatic on main pushes), notify-failure.
- `deploy.yml` — `workflow_run`-triggered build → deploy (Azure) → notify-failure.

---

## 9. Client-side persistence registry — `apps/web/lib/local-data.ts`

`LOCAL_DATA_REGISTRY` is consumed by `clearAllLocalData()` (sign-out), the `/settings/retention` page, and `tests/unit/local-data-registry.test.ts` (fails on unregistered storage writers).

| id                       | Storage        | Key                                                                 | Cleared on sign-out | Owner                                                         |
| ------------------------ | -------------- | ------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------- |
| `assistantThreads`       | localStorage   | `jpx.accounting.assistantThreads.v2`                                | ✅                  | `lib/assistant-thread-storage.ts`                             |
| `assistantThreadsLegacy` | localStorage   | `jpx.accounting.assistantThreads.v1`                                | ✅                  | (read-migrated once)                                          |
| `dashboardLayout`        | localStorage   | `jpx.accounting.dashboardLayout.v1`                                 | ✅                  | `lib/dashboard-layout-storage.ts`                             |
| `onboarding`             | localStorage   | `jpx.accounting.onboarding.v1`                                      | ✅                  | `lib/onboarding/onboarding-storage.ts`                        |
| `theme`                  | localStorage   | `theme`                                                             | ❌ device pref      | next-themes (root layout)                                     |
| `captureDraftsSession`   | sessionStorage | `jpx-accounting-drafts:session`                                     | ✅                  | `lib/draft-queue.ts`                                          |
| `captureDraftsDb`        | IndexedDB      | `jpx-accounting-drafts` (stores `capture-drafts`, `evidence-blobs`) | ✅                  | `lib/draft-queue.ts`, `lib/evidence-blob-cache.ts`            |
| `staticAssetCache`       | CacheStorage   | prefix from `lib/service-worker-cache.ts`                           | ✅                  | `public/sw.js`, `components/pwa/service-worker-registrar.tsx` |
| `localeCookie`           | cookie         | `NEXT_LOCALE`                                                       | ❌ language pref    | `components/settings/company-form.tsx`                        |
| `supabaseSession`        | localStorage   | `sb-` prefix                                                        | ✅                  | `lib/auth/supabase-client.ts`                                 |

---

## 10. Config / env surface

**API** — single reader `readApiRuntimeConfig(env)` in `services/api/src/config.ts`. Groups: `port`, `runtimeMode` (unknown value **throws**), `allowTestReset`, `corsPolicy`, `azureOpenAi`, `database` (`DATABASE_URL` canonical; `SUPABASE_DB_URL` legacy alias — **conflict throws**; `DATABASE_POOL_MODE/MAX`, `DATABASE_MIGRATION_URL`, `DATABASE_TEST_URL`), `azureStorage` (absent → stub uploader), `azureDocumentIntelligence` (absent → stub), `auth` (`SUPABASE_JWKS_URL` **required in normal mode — boot throws**; `SUPABASE_JWT_ALGS`), `advisor` (`ADVISOR_TOOL_APPROVAL_SECRET`, demo default baked in).

Read outside `config.ts`: `ADVISOR_MAX_OUTPUT_TOKENS` / `ADVISOR_STREAM_TIMEOUT_MS` (`advisor/chat.ts` `resolveAdvisorStreamLimits`), `APPLICATIONINSIGHTS_CONNECTION_STRING` + `OTEL_SERVICE_NAME` (`telemetry.ts`).

**Web** — `NEXT_PUBLIC_ACCOUNTING_RUNTIME_MODE` + `NEXT_PUBLIC_API_BASE_URL` (`lib/runtime-config.ts`, `lib/server-runtime-config.ts`), `ACCOUNTING_API_BASE_URL` (server-only, the proxy target), `NEXT_PUBLIC_DISABLE_SW`, `NEXT_PUBLIC_SUPABASE_URL`/`_ANON_KEY` (auth UI + CSP; **build-time**), `NEXT_PUBLIC_AZURE_STORAGE_ORIGIN` (CSP; **build-time**), `NEXT_PUBLIC_APPINSIGHTS_CONNECTION_STRING` (no-op seam).

`.env.example` is the annotated master list. ⚠ Don't grep `apps/web/.next/` when auditing env vars — it contains stale references from older commits.

---

## 11. Docs index

| File                             | Purpose                                                                                                                                                                                                                                                         | Freshness           |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `docs/CONTRIBUTING.md`           | Contributing + env matrix + build/deploy subtleties                                                                                                                                                                                                             | —                   |
| `docs/CONVENTIONS.md`            | **The rule book** — numbered rules from real incidents; referenced by code comments (`Rule 20`, `R5`, …)                                                                                                                                                        | living              |
| `docs/architecture.md`           | Runtime shape                                                                                                                                                                                                                                                   | verified 2026-07-19 |
| `docs/DEV_STATUS.md`             | Phase status + open follow-ups                                                                                                                                                                                                                                  | reviewed 2026-07-19 |
| `docs/compliance-playbook.md`    | Accounting/compliance controls                                                                                                                                                                                                                                  | —                   |
| `docs/DEPLOY_UNBLOCK.md`         | The `assignStorageRoles` CD gate                                                                                                                                                                                                                                | 2026-07-05          |
| `docs/AGENT_HARNESS_ADOPTION.md` | Agent-harness mapping + open decisions                                                                                                                                                                                                                          | —                   |
| `docs/REPO_MAP.md`               | This file                                                                                                                                                                                                                                                       | 2026-08-06          |
| `docs/archive/`                  | 4 superseded plans/reports (archived 2026-07-18)                                                                                                                                                                                                                | archived            |
| `docs/knowledge/sv/`             | Advisor corpus — 10 sourced Swedish docs (front matter `title/source/url/effective`); ⚠ `bokforingslagen-verifikationer.md` is oldest (`effective: 2024-07-01`, pending re-verification — why `check:corpus` isn't in CI). Edits require `pnpm build:knowledge` | per-file            |
| `docs/superpowers/plans/`        | 22 chronological plans; newest: `2026-08-06-repo-health-consolidation-plan.md`. Strategy baseline: `2026-07-18-full-sweep-next-steps-plan.md`; product bets: `2026-07-19-opportunity-backlog.md`                                                                | per-file            |
| `docs/superpowers/specs/`        | 7 design specs; governing: `2026-07-03-advisory-pivot-design.md` (Approved)                                                                                                                                                                                     | per-file            |
| `docs/superpowers/*.md`          | 3 session handovers                                                                                                                                                                                                                                             | per-file            |

---

## 12. Gotchas — things that will mislead you

1. **`packages/supabase-client/` is an empty ghost** (stale `node_modules/` only). Nothing imports it.
2. **`apps/web/hooks/` has no data hooks** — the composite data hook is `components/dashboard/use-dashboard-data.ts`.
3. **`/api/reports/general-ledger` ≡ `/api/reports/trial-balance`** — one handler, two names.
4. **`closeDatabase` is never wired** — `createApiRuntimeDependencies` returns it with a TODO; `index.ts` has no signal handlers; the pool leaks on shutdown.
5. **Orphaned assistant chain** — `domain/assistant.ts`, `LedgerStore.answerAssistantQuestion`, `assistantSessionSchema`, and the `ledger.assistant_sessions` table (migration 0004) have no live route since Phase 6.
6. **7 of 19 event types are reserved, never emitted** — `PeriodLocked` / `CorrectionPosted` etc. do not mean those features exist.
7. **`contracts/src/countries.ts` is not in the barrel** — reachable only transitively via `domain`.
8. **`check-seams.sh` and `check:corpus` are NOT in CI** — they look like gates but only run manually.
9. **`packages/advisor/src/corpus.generated.ts` is generated** — hand edits are overwritten by `pnpm build:knowledge`.
10. **`components/advisor/tool-approval.ts` is a deliberate SDK workaround** — looks removable, is not (until the `ai` bump that fixes approval-signature drop, verified by its pinned unit test).
11. **Two `MemoryLedgerStore` swap points** — `POST /api/testing/reset` replaces the store at runtime; that's why the advisor handler takes a late-bound `getStore: () => currentStore` closure.
12. **`/share` is demo-only under auth** — the route runs server-side with no session (documented in DEV_STATUS).
13. **Visual baselines are per-platform** — a Windows re-baseline does not update the `-linux` files CI compares.
14. **Line counts drift fast** — sizes cited in plans (e.g. the repo-health plan's mega-module map) go stale within weeks; re-measure before splitting files.
