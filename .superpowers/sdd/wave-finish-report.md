# Wave Finish report — post–Wave C integrate

**Date:** 2026-08-06  
**PR:** https://github.com/JPxWeb/jpx-accounting/pull/38  
**Merge:** `a649ec3` on `main` (merge commit, 2026-08-06T19:26:40Z)  
**Branch tip merged:** `0abda62` (`feat/post-wave-c-integrate`)

## 1) Review verdict + fixes

**Verdict:** Approve (after Important fixes). Full notes: [wave-final-review.md](./wave-final-review.md).

| Severity       | Finding                                                                                       | Fix                                          |
| -------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Important      | `rejectReviewProposal` imported `validEditVatCodes` from `./store` (cycle-risk after Hygiene) | Import from `./store-shared` (`31855c4`)     |
| Important      | Queue UI still offered Accept/Edit on `blockedReason` reviews                                 | `approveDisabled` + hotkey no-op (`31855c4`) |
| Important (CI) | `check:seams` failed closed — `rg` missing on ubuntu-latest                                   | Install ripgrep in CI (`ee3e323`)            |
| Important (CI) | `format:check` failed on 3 Wave F' docs                                                       | Prettier-write those files (`0abda62`)       |
| Critical       | _none_                                                                                        | —                                            |

Trust spine verified on tip: D′ gate, G′ Unavailable\*, Share′ S-fail, E-1/E-2, store parity, AI-never-mutates, no conflict residue.

## 2) PR + merge

| Item                   | Status                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Push                   | `origin/feat/post-wave-c-integrate`                                                                                                                     |
| PR                     | [#38](https://github.com/JPxWeb/jpx-accounting/pull/38) — `run-e2e` label applied                                                                       |
| CI used for merge gate | [workflow_dispatch #31126771507](https://github.com/JPxWeb/jpx-accounting/actions/runs/31126771507) — **success** (typecheck, PG 15/17, build, **E2E**) |
| Merge                  | **MERGED** via merge commit (`gh pr merge --merge`) → `a649ec3`                                                                                         |

**Actions quirk:** `pull_request` / `push` events did **not** queue CI for this PR or the merge to `main` during this session. Gates were driven via `workflow_dispatch`. Worth a human look at org/Actions delivery if it persists.

## 3) Deploy status

| Item                                        | Status                                                                                                                                                                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auto Deploy after merge                     | **Did not start** — needs green CI `workflow_run` on `main`; push-event CI never queued                                                                                                                                             |
| Manual main CI                              | Dispatched for `a649ec3` ([#31127088857](https://github.com/JPxWeb/jpx-accounting/actions/runs/31127088857)); typecheck/seams/prettier green; Build + Postgres jobs stayed **queued** long enough that finish did not wait them out |
| Last Deploy attempts (pre-merge, `3604ba5`) | **Failed** at web container step: **`GHCR_PULL_TOKEN` secret empty** ([#31113097518](https://github.com/JPxWeb/jpx-accounting/actions/runs/31113097518)) — Build + API zip succeeded; web pull blocked                              |
| `assignStorageRoles`                        | Left **false** (no blind flip)                                                                                                                                                                                                      |

### Human Deploy′ checklist (still open)

| ID    | Item                                                            | Agent did                                 | Human still must                         |
| ----- | --------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------- |
| Dep-1 | `GHCR_PULL_TOKEN` PAT (`read:packages`) → Actions secret        | Confirmed missing from failed Deploy logs | Create PAT + set secret                  |
| Dep-2 | Storage RBAC Option 1 or 2 + optional `assignStorageRoles=true` | Not touched                               | Owner grant per `docs/DEPLOY_UNBLOCK.md` |
| Dep-3 | Hosted migrations `0005`–`0008`                                 | Not run against prod                      | Apply on hosted DB                       |
| Dep-4 | Prod `ADVISOR_TOOL_APPROVAL_SECRET`                             | Not set                                   | Set non-demo secret                      |
| Dep-5 | `WEBSITES_CONTAINER_STOP_TIME_LIMIT` (default is **5 s**)       | Not set                                   | Set + verify after next deploy           |
| Dep-6 | Live auth + Azure advisor smoke                                 | Not possible without Dep-1+               | Smoke after deploy                       |

**Do not** re-dispatch Deploy until Dep-1 is set — it will fail at the same web-container step.

## 4) Remaining backlog vs Approach A / brainstorm §5–§6

### Done on `main` after merge

- D′ blockedReason ApprovalGate + 409 + advisor soft-deny
- G′ Unavailable\* blob/DocIntel + `/ready.checks` + knowledge DI / advisor config fold
- Share′ S-fail + `authRequired` banner
- E-1 Art. 50 draft + thread `aiTransparency`; E-2 retrieval mode honesty; E-4/E-5 i18n/AI marker
- Hygiene F-5/F-6/F-7/F-10; Docs F-1/F-2/F-3
- Review polish: blocked Accept/Edit UI; CI ripgrep; docs prettier

### Still open

| Item                                                  | Notes                                                       |
| ----------------------------------------------------- | ----------------------------------------------------------- |
| **Deploy′ Dep-1…Dep-6**                               | Human-led; Dep-1 is the hard CD blocker today               |
| **F-4** EOL / `.gitattributes`                        | Local Windows `format:check` noise remains                  |
| **E-3** capture IA / dashboard framing                | Product Q7/Q8                                               |
| **F-8** deploy secret alias window                    | Blocked on Dep-1/2                                          |
| **F-9** caret→exact + catalogs                        | Parked Q9                                                   |
| **Plat-1…Plat-5**                                     | Parked / blocked                                            |
| **Full P1-1** `extractionPending` / web pending badge | Explicit D′ non-goal                                        |
| **G-3** `app.ts` split                                | Skipped by design                                           |
| **Visual** re-baseline                                | Not run; do not blind-update                                |
| **Actions delivery**                                  | Investigate why `pull_request`/`push` CI did not auto-queue |

## Evidence links

- PR: https://github.com/JPxWeb/jpx-accounting/pull/38
- Green branch CI (+ E2E): https://github.com/JPxWeb/jpx-accounting/actions/runs/31126771507
- Merge commit: `a649ec3`
- Deploy failure (GHCR): https://github.com/JPxWeb/jpx-accounting/actions/runs/31113097518
- Deploy unblock doc: `docs/DEPLOY_UNBLOCK.md`
- Brainstorm: `docs/superpowers/plans/2026-08-06-post-wave-c-improvement-brainstorm.md` §5–§6
