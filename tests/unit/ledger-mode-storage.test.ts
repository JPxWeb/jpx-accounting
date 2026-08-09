import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  LEDGER_MODE_STORAGE_KEY,
  loadLedgerMode,
  resolveLedgerMode,
  saveLedgerMode,
} from "../../apps/web/lib/ledger/ledger-mode-storage.ts";

type StorageShim = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
};

function installLocalStorage(): StorageShim {
  const map = new Map<string, string>();
  const localStorage: StorageShim = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
    clear: () => {
      map.clear();
    },
  };
  (globalThis as { window?: unknown }).window = { localStorage };
  return localStorage;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("ledger-mode-storage", () => {
  it("resolveLedgerMode prefers URL over stored preference", () => {
    const store = installLocalStorage();
    saveLedgerMode("inline");
    assert.equal(store.getItem(LEDGER_MODE_STORAGE_KEY), "inline");
    assert.equal(resolveLedgerMode("drawer"), "drawer");
    assert.equal(loadLedgerMode(), "inline");
    assert.equal(
      (globalThis as { window: { localStorage: StorageShim } }).window.localStorage.getItem(LEDGER_MODE_STORAGE_KEY),
      "inline",
    );
  });

  it("resolveLedgerMode defaults to inline when unset", () => {
    const store = installLocalStorage();
    assert.equal(resolveLedgerMode(null), "inline");
    assert.equal(store.getItem(LEDGER_MODE_STORAGE_KEY), null);
    assert.equal(
      (globalThis as { window: { localStorage: StorageShim } }).window.localStorage.getItem(LEDGER_MODE_STORAGE_KEY),
      null,
    );
  });
});
