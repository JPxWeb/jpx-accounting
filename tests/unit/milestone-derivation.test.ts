import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { WorkspaceSnapshot } from "@jpx-accounting/contracts";

import {
  countCompletedMilestones,
  deriveMilestones,
  SEEDED_EVIDENCE_COUNT,
} from "../../apps/web/lib/onboarding/milestone-derivation";

function emptySnapshot(): WorkspaceSnapshot {
  return {
    evidence: [],
    reviews: [],
    reports: { journal: [] },
  } as unknown as WorkspaceSnapshot;
}

describe("deriveMilestones", () => {
  it("demo capture requires evidence beyond seeded baseline", () => {
    const result = deriveMilestones({
      snapshot: {
        ...emptySnapshot(),
        evidence: [{ id: "e1" }],
      } as WorkspaceSnapshot,
      settings: null,
      advisorThreadCount: 0,
      runtimeMode: "demo",
    });
    assert.equal(result.capture, false);
    assert.equal(SEEDED_EVIDENCE_COUNT.demo, 1);
  });

  it("normal capture flips on first evidence", () => {
    const result = deriveMilestones({
      snapshot: {
        ...emptySnapshot(),
        evidence: [{ id: "e1" }],
      } as WorkspaceSnapshot,
      settings: null,
      advisorThreadCount: 0,
      runtimeMode: "normal",
    });
    assert.equal(result.capture, true);
  });

  it("approve flips on approved review", () => {
    const result = deriveMilestones({
      snapshot: {
        ...emptySnapshot(),
        reviews: [{ status: "approved" }],
      } as WorkspaceSnapshot,
      settings: null,
      advisorThreadCount: 0,
      runtimeMode: "demo",
    });
    assert.equal(result.approve, true);
  });

  it("import flips on sie_ voucher", () => {
    const result = deriveMilestones({
      snapshot: {
        ...emptySnapshot(),
        reports: { journal: [{ voucherId: "sie_001" }] },
      } as WorkspaceSnapshot,
      settings: null,
      advisorThreadCount: 0,
      runtimeMode: "normal",
    });
    assert.equal(result.import, true);
  });

  it("countCompletedMilestones sums done steps", () => {
    const milestones = deriveMilestones({
      snapshot: emptySnapshot(),
      settings: { organizationName: "Test" } as import("@jpx-accounting/contracts").CompanySettings,
      advisorThreadCount: 1,
      runtimeMode: "normal",
    });
    assert.equal(countCompletedMilestones(milestones), 2);
  });
});
