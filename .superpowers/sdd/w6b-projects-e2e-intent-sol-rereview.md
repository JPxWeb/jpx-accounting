# Wave 6b projects E2E intent follow-up — Sol re-review

## Verdict

**APPROVE — keep Wave 6b COMPLETE.**

Reviewed commit `b684bdd` only, plus the current approval call sites needed to
confirm that no enrichment-consuming caller still depends on implicit consume.
No high-confidence finding remains.

## Delta review

`tests/e2e/projects-vertical.spec.ts` now reads the opaque `version` returned by
the `project_assignment` intent attachment and echoes that exact version in
`enrichmentIntent: { mode: "consume", version }` when approving. This matches
the already-approved fail-closed contract: the setup consumes only the intent
it presented and a replacement between attach and approval would be rejected
instead of silently consumed.

The change is tests and SDD documentation only. It does not alter the approved
intent-version design, product behavior, ledger mutation path, or store parity.

## Caller audit

All production approval entry points are explicit about their intent:

- `review-edit-sheet.tsx` echoes the version returned by its attach and is the
  enrichment-consuming UI path.
- The queue view and dashboard widget first attach `noop`, then approve without
  a consume assertion; omission deliberately clears unseen enrichment.
- The server advisor executor and local demo transport likewise attach `noop`
  before approval, so they do not claim to consume a presented enrichment.
- Direct plain approvals that do not attach enrichment remain ordinary
  approvals and cannot implicitly consume an existing intent.

Among E2E setup callers, `projects-vertical.spec.ts` was the only direct
attach-then-approve enrichment consumer that omitted the version. Invoice
workflow coverage exercises the review edit sheet or deliberate stale-intent
clearing, rather than implicit consume.

## Verification

- `git diff 56abac1..b684bdd --check`: PASS.
- Focused `projects-vertical.spec.ts`: **2/2 PASS** on desktop Chromium and
  Pixel 7/mobile Chromium.
- Implementer record: **53/53 PASS** across the deferred approval/enrichment
  desktop and Pixel 7 E2E selection after this fix.
- Visual comparison remains deferred; no baseline was updated. That does not
  change this test-only follow-up verdict.

No renewed Opus review is required.
