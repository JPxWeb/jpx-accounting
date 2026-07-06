import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseOnboardingState } from "../../apps/web/lib/onboarding/onboarding-storage";

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
});
