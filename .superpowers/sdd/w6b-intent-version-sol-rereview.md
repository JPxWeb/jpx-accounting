# Wave 6b Sol re-review — intent-version consume race

Date: 2026-08-09

Branch: `feat/ledger-overview-enrichments-mcp`

Reviewed: `5ec5169`, the coordinated `services/api/src/app.ts` and
`packages/api-client/src/index.ts` restoration in `11e69d9`, Opus review
`44db8cf`, and prior Sol REQUEST_CHANGES `b467729`.

Verdict: **APPROVE**

## Findings

No findings at confidence 80 or higher.

The prior blocker is closed end-to-end:

- Every attach mints and returns a fresh opaque intent `version`.
- A consume decision must echo that version; the old bare `"consume"` shape
  no longer parses.
- Memory and Postgres call the same resolver. A stale or forged version fails
  before any Memory mutation and inside the Postgres advisory-locked
  transaction before any append.
- The API maps the mismatch to typed HTTP 409
  `enrichment_intent_stale`; the review remains open and the replacement
  intent remains attached.
- Omission and explicit clear remain fail-closed: approval posts without
  enrichment and discards any unseen intent.
- Migration `0012` backfills pre-existing rows with
  `rei_legacy_ || gen_random_uuid()`, not a token derivable from the review id.
- The edit sheet consumes the exact version returned by its attach. The
  coordinated API/API-client changes are present in the final tree despite
  their misleading commit ownership.

## Non-blocking notes

1. A direct caller that sends a stale consume assertion with `reject` receives
   the same 409 even though reject would not append enrichment. Current reject
   surfaces never send the assertion, and failing closed is safe.
2. Queue/dashboard noop attaches are now redundant because omission already
   discards unseen intent. They are harmless and can be removed with dedicated
   coverage when those surfaces are next changed.
3. The domain 409 detail is English, matching existing domain errors. A
   localized reviewer-facing message can be added at the UI error-mapping
   boundary; it does not reopen the ledger race.

## Verification

- Fresh focused intent suite: **30/30 PASS**.
- `git diff --check 5ec5169^ 44db8cf`: PASS.
- Existing clean run: production typecheck **11/11** plus tests typecheck:
  PASS.
- Existing strict disposable-Postgres run: migrations `0001`–`0012`,
  **119/119 PASS**, including Memory/Postgres consume-race parity.

Invoice E2E and visual comparisons were not rerun during this re-review because
Wave 6e UI files are actively dirty in the shared worktree. This does not block
the Wave 6b review verdict: the request-shape seam is covered by contract,
API-client, route, store, and strict Postgres tests, and no visual output was
intentionally changed. Functional E2E and human-reviewed visuals remain
required at the centralized pre-merge gate; no baseline may be updated blindly.

Wave 6b is **COMPLETE** for the intent-identity blocker and all prior Sol
conditions. No further Opus review is requested. No PR was opened, `main` was
not touched, and no Wave 6e implementation was modified.
