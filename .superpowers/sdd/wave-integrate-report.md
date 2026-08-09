# Wave Integrate report — post–Wave C swarm

**Branch / worktree:** `feat/post-wave-c-integrate` @ `.worktrees/feat-post-wave-c-integrate`  
**Tip:** `8b08c68`  
**Base:** `origin/main` @ `3604ba5`  
**Date:** 2026-08-06  
**Push / PR:** not done (per brief)

## Status

**DONE_WITH_CONCERNS**

Integration branch is locally complete with all in-scope waves merged and conflict-resolved. Substantive gates (i18n, seams, typecheck ×11 + tests, unit 490/490, focused wave units, `pnpm build`) are green. Full `pnpm check` did not finish green solely on `format:check` (421-file Prettier EOL noise under `core.autocrlf=true` on Windows — wave-touched files pass `prettier --check` individually; see F-4). E2E / visual not run. Approach A still needs human **Deploy′**.

## Preconditions handled

| Wave branch                | At handoff                      | Action                                |
| -------------------------- | ------------------------------- | ------------------------------------- |
| `feat/post-wave-c-g-prime` | Committed `79aff57`             | Merged as-is (includes D′ + E-6 + G′) |
| `feat/post-wave-c-hygiene` | Dirty working tree on `3604ba5` | Committed as `1874688` before merge   |
| `feat/post-wave-c-share-e` | Dirty working tree on `3604ba5` | Committed as `2ba98d4` before merge   |
| `feat/post-wave-c-docs`    | Committed `7c64d92`             | Merged as-is                          |
| `feat/post-wave-c-d-prime` | Dirty subset of g-prime         | **Not merged** (g-prime supersedes)   |

## Merge order

1. Created worktree `.worktrees/feat-post-wave-c-integrate` from `origin/main` → branch `feat/post-wave-c-integrate`
2. `pnpm install` in integrate worktree
3. **Fast-forward** `feat/post-wave-c-g-prime` (`79aff57`) — D′ + E-6 + G-1/G-2
4. **Merge** `feat/post-wave-c-hygiene` (`1874688`) — conflict resolved (below)
5. **Merge** `feat/post-wave-c-share-e` (`2ba98d4`) — conflict resolved (below)
6. **Merge** `feat/post-wave-c-docs` (`7c64d92`) — clean
7. Follow-up fix commit `8b08c68` — demo-path typecheck (narrowed `runtimeMode`)

```text
* 8b08c68 fix(api): drop dead demo ApprovalGate compare that broke typecheck
*   fd75de2 merge: Wave F' docs (F-1/F-2/F-3)
*   bced656 merge: Wave Share-E (S-fail + E-1/2/4/5)
*   e56314a merge: Wave Hygiene (F-5/F-6/F-7/F-10)
* 79aff57 feat(api): fail-closed blob/DocIntel peripherals (Wave G′)
* 3604ba5 origin/main
```

## Conflict resolutions (file-level)

### `packages/domain/src/store.ts` (hygiene × g-prime)

- **Conflict:** HEAD (g-prime) still defined `DEMO_ACTOR_ID` / `ActorAttribution` / `ApprovalGate` / `ReviewBlockedError` inline; hygiene moved actors/helpers to `store-shared.ts` and deleted the inline block.
- **Resolution:** Keep hygiene cycle break (`store` → `store-planning` → `store-shared`). Move D′ **`ApprovalGate`** + **`ReviewBlockedError`** into `store-shared.ts` and re-export them from `store.ts` (same pattern as `DEMO_ACTOR_ID`). Planners keep importing from `./store-shared` (no cycle).
- **Preserved:** `enforceBlockedReason` gate in `planReviewDecision`, Memory `planComplianceMerge` parity extras, orphan-assistant retirement, fail-closed runtime wiring.

### `services/api/src/advisor/chat.ts` (share-e × g-prime)

- **Conflict (2 sites in `retrieveChatPassages`):** HEAD returned bare `retrieveKnowledge(...)` with `DEFAULT_RETRIEVAL_TOP_K`; share-e wrapped `{ passages, mode: "keyword" }` but still used old `RETRIEVAL_TOP_K`.
- **Resolution:** `{ passages: retrieveKnowledge(question, { topK: DEFAULT_RETRIEVAL_TOP_K }), mode: "keyword" }` — E-6 top-k **and** E-2 mode honesty.
- Auto-merged cleanly: `local-demo-transport.ts` (`rejectReviewProposal` + top-k), advisor tests, messages, share policy.

### Docs × share-e

- No conflict. Kept both `docs/compliance/article-50-assessment.md` (share-e) and docs archive / `docs/README.md` (F′).

### Post-merge typecheck fix (`8b08c68`)

- Inside `if (options.runtimeMode === "demo")`, comparing to `"normal"` for `enforceBlockedReason` is a TS2367 dead compare.
- Demo path now calls `executeReviewApproval(...)` with default empty gate (blockedReason advisory). Normal path still threads `enforceBlockedReason: options.runtimeMode === "normal"`.

## Behaviors verified present after integrate

| Behavior                                                                   | Source      |
| -------------------------------------------------------------------------- | ----------- |
| `blockedReason` → `ReviewBlockedError` / 409 in normal                     | D′          |
| `rejectReviewProposal` + `DEFAULT_RETRIEVAL_TOP_K = 4`                     | E-6         |
| `Unavailable*` blob/DocIntel + `/ready.checks.blob\|docintel`              | G-1         |
| Knowledge DI + advisor config fold (`maxOutputTokens` / `streamTimeoutMs`) | G-2         |
| `store-shared` cycle break + Joyride `next/dynamic` + CI `check:seams`     | F-5/F-6     |
| Orphan assistant retired; ghost `supabase-client` gitignored               | F-7         |
| Share S-fail + `authRequired` banner                                       | Share′      |
| `data-retrieval` mode + keyword-degrade banner                             | E-2         |
| Art. 50 draft + `aiTransparency` thread metadata                           | E-1         |
| UnavailableState i18n + review AI marker                                   | E-4/E-5     |
| Docs truth + archive                                                       | F-1/F-2/F-3 |

## Verification

| Gate                                               | Result                                                                                                                                                                                                               |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check:i18n`                                  | **pass** — 932 keys en/sv                                                                                                                                                                                            |
| `bash scripts/check-seams.sh`                      | **pass**                                                                                                                                                                                                             |
| `pnpm typecheck` (11 workspaces)                   | **pass** (after `8b08c68`)                                                                                                                                                                                           |
| `pnpm typecheck:tests`                             | **pass**                                                                                                                                                                                                             |
| `pnpm test:unit`                                   | **pass** — 490/490                                                                                                                                                                                                   |
| Focused wave units (D′/G′/Share/E/hygiene samples) | **pass** — 126/126                                                                                                                                                                                                   |
| `pnpm build` (web + api)                           | **pass**                                                                                                                                                                                                             |
| `pnpm lint`                                        | **pass** (1 pre-existing TanStack warning)                                                                                                                                                                           |
| `pnpm format:check`                                | **fail** — 421 files; Windows `core.autocrlf=true` vs Prettier default `lf`. Wave-touched files pass targeted `prettier --check`. Aligns with brainstorm **F-4** (EOL / `.gitattributes`), not a merge logic defect. |
| Full `pnpm check`                                  | **fail** — stopped at `format:check` (above). Lint/i18n would have continued; typecheck/unit/build re-run green separately.                                                                                          |
| E2E / visual                                       | **not run** (out of scope; no snapshot updates)                                                                                                                                                                      |

## Remaining gaps vs brainstorm Approach A

Approach A spine: **Deploy′ → D′ → G′ → Share′ → E-1/E-2** (+ thin docs).

| Item                                              | State on integrate tip                        |
| ------------------------------------------------- | --------------------------------------------- |
| D′ (P1-1 blockedReason + DocIntel `kind`)         | **In** (via g-prime)                          |
| G′ (P1-4 Unavailable\* + G-2 DI)                  | **In** (G-3 `app.ts` split still skipped)     |
| Share′ S-fail (P0-4)                              | **In**                                        |
| E-1 / E-2                                         | **In** (+ E-4/E-5 bonus from share-e wave)    |
| F-1/F-2/F-3 docs                                  | **In**                                        |
| F-5/F-6/F-7/F-10 hygiene                          | **In** (beyond thin Approach A docs PR)       |
| **Deploy′** (Dep-1…Dep-6 owner ops)               | **Still open** — human-led; not in this swarm |
| E-3 capture IA / dashboard framing                | Out of scope (product Q7/Q8)                  |
| F-4 EOL / `.gitattributes`                        | Still open — explains local `format:check`    |
| F-8 deploy secret alias window                    | Blocked on Deploy′                            |
| F-9 caret→exact + catalogs                        | Parked (Q9)                                   |
| Plat-1…Plat-5                                     | Parked / blocked                              |
| Full P1-1 `extractionPending` / web pending badge | Explicit D′ non-goal — still open             |

## Suggested next step (human)

1. **PR strategy:** Open one PR from `feat/post-wave-c-integrate` → `main` (single integration PR preferred over replaying four wave PRs — history already has merge commits + wave tip commits). Optional: add `run-e2e` label before merge for user-facing Share/advisor surfaces.
2. **Before merge on a Linux/CI agent (or after F-4):** confirm `pnpm check` green where EOL is LF-native — do not blind-run `prettier --write` on 421 files from Windows autocrlf.
3. **Deploy′:** Own the Azure/secrets ops package next; do not treat this integrate tip as production-ready without it.
4. **Do not** merge `feat/post-wave-c-d-prime` separately — it is a dirty subset already carried by g-prime / this tip.
5. No push was performed from this orchestrator run.
