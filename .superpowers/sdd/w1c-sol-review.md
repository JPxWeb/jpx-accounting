# Batch W1-C Sol Review

## Verdict

**APPROVE_WITH_FIXES**

Tasks 1.5–1.7 implement the approved Wave 1 Mode A/Mode B interaction over the shared `LedgerVoucherDetail`. The review applied bounded accessibility, hydration, and YAGNI fixes in the owned UI files. No accounting behavior, ledger writes, review-gate behavior, contracts, stores, translations, or visual baselines changed.

## Findings

- **Mode persistence could hydrate to different server/client layouts.** `resolveLedgerMode()` read localStorage during the first client render while SSR always resolved `inline`. `JournalView` now reads the stored preference through `useSyncExternalStore` with an `inline` server snapshot, preserving URL precedence without a hydration mismatch.
- **The drawer did not restore focus to its opener.** It now captures the invoking control before the focus trap moves focus and restores focus after close when that control remains connected.
- **The focus trap could restart on unrelated parent renders.** The URL close handler is now stable, so a live drawer does not repeatedly refocus its first control.
- **The disclosure region had no accessible name.** The expanded region is now labelled by its toggle. Drawer-mode toggles expose `aria-haspopup="dialog"`.
- **The backdrop was a click-only non-interactive element.** It is now an accessible close button behind the dialog.
- **The onboarding blocker had no unmount cleanup while open.** The drawer now releases the blocker on close or unmount.
- **Empty descriptions could leave the drawer title unnamed.** Both overview and drawer fall back through supplier to voucher number.
- **Two `useMemo` calls never memoized useful work** because their array/map inputs were recreated every render. Straight-line grouping/filtering is smaller and follows the repository's nuqs/React Compiler guidance.
- **Search matched internal voucher ids beyond the approved grammar.** It now matches only description, supplier, and voucher number as designed.

The shared `LedgerVoucherDetail` remains the sole detail renderer for both modes. Mobile dock clearance remains `env(safe-area-inset-bottom) + 144px` below the sheet content and resets at the desktop breakpoint. No duplicate detail implementation or speculative Wave 2+ behavior was introduced.

## Verification

- `pnpm exec tsx --test tests/unit/ledger-mode-storage.test.ts` — **PASS**, 3 tests.
- `pnpm --filter @jpx-accounting/web typecheck` — **PASS**.
- `pnpm build:e2e` — **PASS**.
- `npx playwright test tests/e2e/ledger-overview.spec.ts tests/e2e/books-drilldown.spec.ts` — **PASS**, 12 tests across desktop Chromium and Pixel 7.
- IDE diagnostics for the three edited UI files — no errors.
- `git diff --check` — **PASS**.

## Proceed decision

Wave 1 Tasks 1.8–1.9 may proceed. Task 1.8 was not started and visual baselines were not updated. Task 1.9 should still run the planned axe/focus/mobile-clearance gate over the final UI.

No `NEEDS_OPUS_REVIEW` concern was found.
