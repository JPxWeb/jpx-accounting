import assert from "node:assert/strict";
import test from "node:test";

import { invalidateLedgerDerived, LEDGER_DERIVED_QUERY_KEYS } from "../../apps/web/lib/query-invalidation";

test("LEDGER_DERIVED_QUERY_KEYS pins the ledger-derived key families", () => {
  // R18: THE canonical list. Adding a new ledger-derived query family means
  // updating the helper AND this pin — a silent drift would reintroduce the
  // per-call-site stale-cache bug the helper exists to kill.
  assert.deepEqual(
    LEDGER_DERIVED_QUERY_KEYS.map((key) => [...key]),
    [["workspace"], ["reports"], ["integrity"], ["compliance-alerts"], ["evidence"]],
  );
});

test("key families are one-element prefixes so parameterized keys match", () => {
  // Prefix invalidation only covers `["reports", "journal", from, to]` if the
  // family is the bare root — a two-element family would silently skip siblings.
  for (const key of LEDGER_DERIVED_QUERY_KEYS) {
    assert.equal(key.length, 1, `family ${JSON.stringify([...key])} must be a bare root`);
  }
  assert.equal(new Set(LEDGER_DERIVED_QUERY_KEYS.map((key) => key[0])).size, LEDGER_DERIVED_QUERY_KEYS.length);
});

test("invalidateLedgerDerived invalidates each family exactly once, in order", () => {
  const calls: (readonly string[])[] = [];
  invalidateLedgerDerived({
    invalidateQueries: (filters) => {
      calls.push(filters.queryKey);
      return Promise.resolve();
    },
  });
  assert.deepEqual(
    calls.map((key) => [...key]),
    LEDGER_DERIVED_QUERY_KEYS.map((key) => [...key]),
  );
});
