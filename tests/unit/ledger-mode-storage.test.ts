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
  it("persists drawer mode while a valid URL mode takes precedence", () => {
    const store = installLocalStorage();
    assert.equal(saveLedgerMode("drawer"), "drawer");
    assert.equal(store.getItem(LEDGER_MODE_STORAGE_KEY), "drawer");
    assert.equal(loadLedgerMode(), "drawer");
    assert.equal(resolveLedgerMode("inline"), "inline");
    assert.equal(store.getItem(LEDGER_MODE_STORAGE_KEY), "drawer");
  });

  it("defaults to inline without a browser or stored preference", () => {
    assert.equal(resolveLedgerMode(null), "inline");

    const store = installLocalStorage();
    assert.equal(resolveLedgerMode(null), "inline");
    assert.equal(store.getItem(LEDGER_MODE_STORAGE_KEY), null);
  });

  it("ignores an unrecognized stored value", () => {
    const store = installLocalStorage();
    store.setItem(LEDGER_MODE_STORAGE_KEY, "side-panel");
    assert.equal(loadLedgerMode(), "inline");
  });
});
