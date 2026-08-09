# Wave G′ report — Fail-closed peripherals

**Branch / worktree:** `feat/post-wave-c-g-prime` @ `.worktrees/feat-post-wave-c-g-prime`  
**Commit:** `79aff57`  
**Base:** `feat/post-wave-c-d-prime` (D′ working tree was **uncommitted** at handoff — files copied into G′ before G-1/G-2; D′ `blockedReason` / `rejectReviewProposal` / DocIntel `kind` preserved)  
**Scope:** G-1 (required), G-2 (after G-1). **G-3 skipped.**

## Delivered

### G-1 — P1-4 — `Unavailable*` blob/DocIntel + `/ready.checks`

- `BlobUploader.kind` widened to `"stub" | "azure" | "unavailable"`.
- `UnavailableBlobUploader` + `BlobUploaderUnavailableError` (`code: "blob_unavailable"`).
- `createBlobUploader({ failClosed })` — normal mode passes `failClosed: true` from `runtime.ts`; missing Azure storage → unavailable (never stub).
- `UnavailableDocumentIntelligenceClient` + factory `failClosed` (consumes D′ `DocumentIntelligenceKind`; `extract()` throws existing `DocumentIntelligenceUnavailableError`).
- `/ready`:
  - `checks.blob` / `checks.docintel` = `kind === "azure"` (explicit Azure, per D′ notes).
  - Overall `ready` also requires peripherals not `unavailable` (demo stubs keep `ready` true; checks stay honest `false` for non-Azure).
- `app.onError` maps `BlobUploaderUnavailableError` → 503 `{ code: "blob_unavailable" }`.
- DocIntel unavailable on extract stays in the existing fail-soft catch (no stub fiction invented by the factory).
- Boot-fail on missing blob/DocIntel **rejected** — Unavailable\* + ready checks only.

### G-2 — P1-15/16 — Knowledge DI + advisor config fold

- `configureKnowledgeRetrieval({ client, aiRuntime })` replaces `configureKnowledgeDatabaseClient`.
- `knowledge.ts` no longer calls `readApiRuntimeConfig` or `createAiRuntime`.
- Boot AiRuntime hoisted in `runtime.ts` and injected (demo: `{ client: null, aiRuntime: null }` → keyword-only).
- `ADVISOR_MAX_OUTPUT_TOKENS` / `ADVISOR_STREAM_TIMEOUT_MS` folded into `ApiRuntimeConfig.advisor`.
- `resolveAdvisorStreamLimits` + chat.ts DEFAULT\_\* **deleted** (no re-export); defaults live in `config.ts`.
- `createAdvisorChatHandler` requires `maxOutputTokens` / `streamTimeoutMs`; app/runtime thread them.

### G-3 — P2-17 — SKIPPED

Optional `app.ts` split left for a later wave — G-1+G-2 are the trust-critical slice; splitting `app.ts` is high-churn/low-urgency.

## Gate evidence

```text
npx tsx --test \
  tests/unit/blob-uploader.test.ts \
  tests/unit/document-intelligence.test.ts \
  tests/unit/api-runtime.test.ts \
  tests/unit/api-knowledge.test.ts \
  tests/unit/api-config.test.ts \
  tests/unit/advisor-chat-route.test.ts \
  tests/unit/review-blocked-approval.test.ts \
  tests/unit/reject-review-proposal.test.ts \
  tests/unit/api-actor-attribution.test.ts
→ 99 pass / 0 fail
```

Pinned behaviors:

- Normal + missing Azure → `blobUploader.kind === "unavailable"`, `documentIntelligence.kind === "unavailable"`.
- Normal `/ready` → `ready: false`, `checks: { ledger, ai, blob, docintel }` all false without config.
- Normal `POST /api/uploads/init` → 503 `blob_unavailable` (never stub URL).
- Demo → stub kinds; `/ready.ready === true`; checks.blob/docintel false (not Azure).

## Files touched (G′ delta on top of D′ base)

| Area      | Files                                                                                                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blob      | `services/api/src/blob.ts`                                                                                                                                                                |
| DocIntel  | `packages/document-intelligence/src/index.ts`                                                                                                                                             |
| Runtime   | `services/api/src/runtime.ts`                                                                                                                                                             |
| Knowledge | `services/api/src/knowledge.ts`                                                                                                                                                           |
| Config    | `services/api/src/config.ts`                                                                                                                                                              |
| Advisor   | `services/api/src/advisor/chat.ts`                                                                                                                                                        |
| App       | `services/api/src/app.ts` (`/ready`, onError, advisor options)                                                                                                                            |
| Tests     | `blob-uploader.test.ts` (new), `api-knowledge.test.ts` (new), updates to api-runtime / api-config / document-intelligence / advisor-chat-route / actor-attribution / integration fixtures |

## Explicit non-goals / follow-ups

- G-3 `app.ts` split
- Docs truth (REPO_MAP / CLAUDE still mention `resolveAdvisorStreamLimits` / `configureKnowledgeDatabaseClient`) — Wave F′
- Deploy.yml `/ready` probe still only asserts ledger+ai (works; may later require blob/docintel once Azure env is complete)
- Full `pnpm check` / E2E / push — not run
- Share′ / E′ Art. 50 / extractionPending — out of scope

## Note for merge

D′ work was uncommitted when G′ started. This branch **includes** the D′ tree (blockedReason gate, `rejectReviewProposal`, DocIntel `kind`, shared top-k) plus G-1/G-2. Coordinate with the D′ worktree before double-landing.
