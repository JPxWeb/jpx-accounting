import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  ONBOARDING_STORAGE_KEY,
  getClientOnboardingSnapshot,
  getServerOnboardingSnapshot,
  loadOnboardingState,
  markTourCompleted,
  parseOnboardingState,
  readCachedState,
  resetOnboardingStoreForTests,
  resetOnboardingTours,
  subscribeOnboardingStorage,
} from "../../apps/web/lib/onboarding/onboarding-storage";

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
  (globalThis as { window?: unknown }).window = {
    localStorage,
    addEventListener() {},
    removeEventListener() {},
  };
  return localStorage;
}

afterEach(() => {
  resetOnboardingStoreForTests();
  delete (globalThis as { window?: unknown }).window;
});

describe("onboarding-storage", () => {
  it("returns empty state for invalid JSON", () => {
    const state = parseOnboardingState("{not-json");
    assert.equal(state.schemaVersion, 1);
    assert.deepEqual(state.completedTours, []);
  });

  it("rejects unknown tour ids when parsing", () => {
    const state = parseOnboardingState(
      JSON.stringify({ schemaVersion: 1, completedTours: ["app-orientation", "not-a-tour"] }),
    );
    assert.deepEqual(state.completedTours, []);
  });

  it("accepts valid completed tour ids when parsing", () => {
    const state = parseOnboardingState(
      JSON.stringify({ schemaVersion: 1, completedTours: ["app-orientation", "capture-flow"] }),
    );
    assert.deepEqual(state.completedTours, ["app-orientation", "capture-flow"]);
  });

  it("getServerOnboardingSnapshot is Object.is-stable and never allocates", () => {
    const a = getServerOnboardingSnapshot();
    const b = getServerOnboardingSnapshot();
    assert.equal(Object.is(a, b), true);
    assert.equal(Object.is(a, parseOnboardingState(null)), true);
  });

  it("getClientOnboardingSnapshot matches server snapshot before subscribe (seeded storage)", () => {
    const storage = installLocalStorage();
    storage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, completedTours: ["app-orientation"] }));

    const server = getServerOnboardingSnapshot();
    const clientBefore = getClientOnboardingSnapshot();
    assert.equal(Object.is(clientBefore, server), true);

    // Imperative read still sees seeded storage (not gated on subscribe).
    assert.deepEqual(readCachedState().completedTours, ["app-orientation"]);
  });

  it("after subscribe, getClientOnboardingSnapshot is Object.is-stable on seeded storage", () => {
    const storage = installLocalStorage();
    storage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, completedTours: ["app-orientation"] }));

    const unsub = subscribeOnboardingStorage(() => {});
    const first = getClientOnboardingSnapshot();
    const second = getClientOnboardingSnapshot();
    const viaLoad = loadOnboardingState();

    assert.equal(Object.is(first, second), true);
    assert.equal(Object.is(first, viaLoad), true);
    assert.deepEqual(first.completedTours, ["app-orientation"]);
    assert.equal(Object.is(first, getServerOnboardingSnapshot()), false);
    unsub();
  });

  it("write produces a new snapshot identity; subsequent reads stay stable", () => {
    installLocalStorage();
    const unsub = subscribeOnboardingStorage(() => {});

    const before = getClientOnboardingSnapshot();
    const afterWrite = markTourCompleted("capture-flow");
    const reread = getClientOnboardingSnapshot();
    const rereadAgain = getClientOnboardingSnapshot();

    assert.equal(Object.is(before, afterWrite), false);
    assert.equal(Object.is(afterWrite, reread), true);
    assert.equal(Object.is(reread, rereadAgain), true);
    assert.deepEqual(reread.completedTours, ["capture-flow"]);
    unsub();
  });

  it("reset restores the EMPTY_STATE identity", () => {
    installLocalStorage();
    const unsub = subscribeOnboardingStorage(() => {});
    markTourCompleted("app-orientation");
    const reset = resetOnboardingTours();
    assert.equal(Object.is(reset, getServerOnboardingSnapshot()), true);
    assert.equal(Object.is(getClientOnboardingSnapshot(), getServerOnboardingSnapshot()), true);
    unsub();
  });
});
