/**
 * R18: ONE invalidation helper for ledger mutations. Every success path that
 * changes ledger state (review decisions, capture promotion, SIE import,
 * settings saves, advisor tool approvals, evidence extraction) calls
 * `invalidateLedgerDerived` instead of remembering its own subset of derived
 * query keys — forgetting `["integrity"]` or `["reports"]` at one call site
 * left other screens stale.
 *
 * Invalidation is prefix-based, so each family below also covers its
 * parameterized members (e.g. `["reports", "journal", from, to]` and
 * `["reports", "pack", token]` under `["reports"]`).
 *
 * Deliberately NOT in this list (call sites keep their narrow handling):
 * - `["company-settings"]` — settings mutations write the fresh server copy
 *   via `setQueryData`; the ledger-derived readers refresh through this helper
 * - `["capture-drafts"]` — local draft queue, never ledger state
 * - `["runtime-info"]` — deployment posture, static per process
 * - `["evidence-blob", id]` / `["evidence-file-url", id]` — device blob cache
 *   and short-lived read SAS mints; refetching them on ledger writes would
 *   churn SAS tokens for nothing
 */
export const LEDGER_DERIVED_QUERY_KEYS = [
  // Workspace snapshot: vouchers, reviews, evidence archive, balances, alerts —
  // and with it every client-derived view (observations, command palette hits).
  ["workspace"],
  // Journal, trial balance, and report packs (dashboard month pack, tax-timeline VAT pack).
  ["reports"],
  // Hash-chain integrity summary — changes on every append.
  ["integrity"],
  // Compliance detector output over ledger state.
  ["compliance-alerts"],
  // Per-id evidence context (evidence + voucher + review join).
  ["evidence"],
] as const;

/**
 * Structural subset of React Query's `QueryClient` — keeps this module
 * dependency-free so unit tests can exercise it with a plain fake. A real
 * `QueryClient` is assignable as-is.
 */
export type LedgerQueryInvalidator = {
  invalidateQueries: (filters: { queryKey: readonly string[] }) => Promise<void>;
};

/**
 * Mark every ledger-derived query family stale after a ledger mutation.
 * Additive by design: call sites keep their intentionally-narrow extras
 * (optimistic `setQueryData`, `["capture-drafts"]`, `["company-settings"]`)
 * alongside this call.
 */
export function invalidateLedgerDerived(queryClient: LedgerQueryInvalidator): void {
  for (const queryKey of LEDGER_DERIVED_QUERY_KEYS) {
    void queryClient.invalidateQueries({ queryKey });
  }
}
