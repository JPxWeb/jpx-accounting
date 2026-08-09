# Wave D′ (+ E-6) report

**Branch / worktree:** `feat/post-wave-c-d-prime` @ `.worktrees/feat-post-wave-c-d-prime`  
**Base:** `origin/main` @ `3604ba5`  
**Scope:** D-1, D-2, D-3, E-6 (P1-7). Not in scope: docs wave, share UI, messages, Joyride, full G′ `Unavailable*`.

## Delivered

### D-1 — `DocumentIntelligenceClient.kind` discriminator

Added a `kind` field mirroring `BlobUploader.kind`. Stub and Azure clients set it; factory unchanged (still returns stub when env missing). **No** `UnavailableDocumentIntelligenceClient` yet — that lands in G′.

### Exact `kind` TypeScript shape (define once for G′)

```ts
/**
 * Discriminator for Document Intelligence backends (Wave D′ / G′).
 * - `stub` — deterministic demo / missing-env fallback (today's factory default)
 * - `azure` — live Azure Document Intelligence
 * - `unavailable` — reserved for Wave G′ fail-closed peripheral
 */
export type DocumentIntelligenceKind = "stub" | "azure" | "unavailable";

export interface DocumentIntelligenceClient {
  readonly kind: DocumentIntelligenceKind;
  extract(input: ExtractInput): Promise<DocumentExtractionResult>;
}
```

**G′ consumption notes (do not implement here):**

- Factory becomes `createDocumentIntelligenceClient(config & { failClosed?: boolean })`.
- When `failClosed` (normal mode) and env missing → `kind: "unavailable"` client whose `extract()` throws existing `DocumentIntelligenceUnavailableError`.
- `/ready.checks.docintel` = `documentIntelligence.kind === "azure"` (or `!== "unavailable" && operational` — pick one; prefer explicit azure).
- Parallel blob shape already planned: `BlobUploader.kind: "stub" | "azure" | "unavailable"`.

### D-2 — Approval gate honors `blockedReason` in normal

- Shared gate in `planReviewDecision` (both Memory + Postgres call it).
- Server-only `ApprovalGate = { enforceBlockedReason?: boolean }` (like `actorId` — never on wire schemas).
- When `enforceBlockedReason && action === "approve" && review.blockedReason` → throws `ReviewBlockedError` (`code: "review_blocked"`).
- Reject + `book-without-vat` remain allowed (matches blocked suggestedAction copy).
- API `postReviewDecision` sets `enforceBlockedReason: runtimeMode === "normal"`.
- Demo omits the flag → byte-identical approve-on-blocked behavior.
- `app.onError` maps `ReviewBlockedError` → HTTP **409** `{ code: "review_blocked" }`.
- Advisor `executeReviewApproval` threads the same gate and soft-denies on `ReviewBlockedError`.

### D-3 — Unit tests

`tests/unit/review-blocked-approval.test.ts`:

- Planner throws under normal gate; demo plan still `apply`.
- Memory store: blocked approve rejected with flag, allowed without; unblocked still approves under gate.

### E-6 — Shared top-k + `rejectReviewProposal`

- `DEFAULT_RETRIEVAL_TOP_K = 4` in `packages/advisor/src/retrieval.ts` (default for `retrieveKnowledge`).
- Consumers: `services/api` chat + knowledge, web `local-demo-transport`, unit/integration pins.
- Pure `rejectReviewProposal(snapshot, proposal)` in `packages/domain/src/review-proposal.ts` — identical five checks formerly inlined in `validateProposalAgainstStore`.
- API `validateProposalAgainstStore` → thin wrapper over `rejectReviewProposal(await store.getSnapshot(), …)`.
- Local demo transport calls `rejectReviewProposal` before `approveReview` (fixes stale-offline success lie).
- Unit: `tests/unit/reject-review-proposal.test.ts`.

## Verification

```text
npx tsx --test \
  tests/unit/review-blocked-approval.test.ts \
  tests/unit/reject-review-proposal.test.ts \
  tests/unit/document-intelligence.test.ts \
  tests/unit/advisor-chat-route.test.ts \
  tests/unit/store-planning.test.ts
→ 44 pass / 0 fail
```

(Worktree required `pnpm install` first — bare worktree resolved workspace packages from the parent tree and silently missed source edits.)

## Files touched

| Area              | Files                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| DocIntel          | `packages/document-intelligence/src/index.ts`                                                                      |
| Domain            | `store.ts`, `store-planning.ts`, `review-proposal.ts` (new), `index.ts`                                            |
| Postgres          | `packages/persistence-postgres/src/store.ts` (signature parity)                                                    |
| Advisor pkg       | `packages/advisor/src/retrieval.ts`                                                                                |
| API               | `app.ts`, `advisor/chat.ts`, `knowledge.ts`                                                                        |
| Web (minimal E-6) | `local-demo-transport.ts`                                                                                          |
| Tests             | `review-blocked-approval.test.ts`, `reject-review-proposal.test.ts`, DI + advisor unit/integration literal updates |

## Explicit non-goals (left for later waves)

- Full P1-1 `extractionPending` / `ExtractionPolicy` / web pending badge / messages
- G′ `Unavailable*` blob/DocIntel + `/ready.checks.blob|docintel`
- E′ retrieval `purpose` split, demo chunk protocol extract, Art. 50 docs
- Contracts schema changes (none required)
- Commit / push / full `pnpm check` / E2E
