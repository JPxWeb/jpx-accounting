# Final code review — `feat/post-wave-c-integrate` vs `origin/main`

**Reviewer:** finish agent (post–Wave C integrate)  
**Tip reviewed:** `8b08c68` (+ follow-up fix commit below)  
**Base:** `origin/main` @ `3604ba5`  
**Date:** 2026-08-06

## Verdict

**Approve with Important fixes applied.** No Critical invariant breaks found. Trust spine (D′ / G′ / Share′ S-fail / E-1/E-2) is present and correctly wired; store planners share one gate; normal mode fails closed on missing Azure peripherals; AI still only mutates via `applyReviewDecision` after signed human approval.

## Invariant checklist

| Invariant                        | Result                                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Append-only / no history rewrite | Pass — no store rewrite paths introduced                                                                                     |
| AI never mutates                 | Pass — advisor tool → `executeReviewApproval` → `applyReviewDecision` only after approval; R21 `rejectReviewProposal` shared |
| Store parity (Memory / Postgres) | Pass — both call `planReviewDecision(..., ApprovalGate)`; Postgres signature updated                                         |
| Fail-closed normal               | Pass — `UnavailableBlobUploader` / `UnavailableDocumentIntelligenceClient` when `failClosed`; JWKS still required in normal  |
| `blockedReason` gate             | Pass — planner throws `ReviewBlockedError`; API 409; advisor soft-denies; demo omits flag                                    |
| Share′ S-fail                    | Pass — `decideShareFileIntake` refuses files in `normal` with `authRequired=1`                                               |
| Unavailable\* + `/ready`         | Pass — `checks.blob`/`docintel` = `kind === "azure"`; overall ready false when either is `unavailable`                       |
| Merge conflict residue           | Pass — no `<<<<<<<` / `=======` / `>>>>>>>`                                                                                  |
| Article 50 labeling              | Pass — review AI marker + thread `aiTransparency` + assessment draft                                                         |

## Findings

### Critical

_None._

### Important (fixed on branch)

1. **`review-proposal.ts` imported `validEditVatCodes` from `./store`**  
   Re-coupled the pure R21 helper to the heavy Memory store module after Wave Hygiene’s cycle break (`store` → `store-planning` → `store-shared`).  
   **Fix:** import from `./store-shared`.

2. **Blocked reviews still offered Approve / Edit in the queue UI**  
   Server already 409s in normal mode, but Accept + Edit buttons and Y/E hotkeys still fired, producing doomed requests and confusing UX vs the planner (reject / book-without-vat remain valid).  
   **Fix:** `ReviewCardActions.approveDisabled` when `blockedReason` is set; `handleAction` no-ops accept/edit for blocked reviews (hotkey parity).

### Suggestions (not blocking)

- Postgres integration test for `enforceBlockedReason` (Memory unit covers planner + Memory; Postgres shares planner — add a conformance case when next touching `postgres-ledger.test.ts`).
- Map `DocumentIntelligenceUnavailableError` in `app.onError` if extract’s fail-soft catch is ever narrowed (today extract intentionally swallows).
- Full P1-1 `extractionPending` / pending badge (explicit D′ non-goal).
- F-4 `.gitattributes` EOL (local Windows `format:check` noise; CI Linux LF-native).
- G-3 `app.ts` split (skipped by design).
- Deploy.yml `/ready` smoke still asserts ledger+ai only — fine until Azure blob/DocIntel env is complete.

## Conflict-resolution spot-checks

- `store-shared` holds `ApprovalGate` + `ReviewBlockedError`; planners import from `store-shared` (no cycle).
- Advisor `retrieveChatPassages` returns `{ passages, mode: "keyword" }` with `DEFAULT_RETRIEVAL_TOP_K` (E-6 + E-2 both preserved).
- Demo advisor path omits `ApprovalGate` (blockedReason advisory); normal threads `enforceBlockedReason: true`.

## Fixes committed (on integrate tip before merge)

| Commit    | Change                                                                    |
| --------- | ------------------------------------------------------------------------- |
| `31855c4` | Blocked-review Accept/Edit UI gate + `store-shared` import for R21 helper |
| `ee3e323` | CI installs ripgrep before `check:seams`                                  |
| `0abda62` | Prettier-format Wave F' docs that failed Linux `format:check`             |

Merged to `main` as `a649ec3` via PR #38.
