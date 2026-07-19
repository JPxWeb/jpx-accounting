import assert from "node:assert/strict";
import { test } from "node:test";

import { simulationRequestSchema, simulationRunSchema } from "@jpx-accounting/contracts";

test("simulationRequestSchema requires reviewIds (min 1) and action", () => {
  const ok = simulationRequestSchema.parse({
    title: "What if I approve these",
    scenario: "approve 2 pending",
    reviewIds: ["r1", "r2"],
    action: "approve",
  });
  assert.equal(ok.reviewIds.length, 2);
  assert.equal(ok.action, "approve");

  assert.throws(() =>
    simulationRequestSchema.parse({
      title: "t",
      scenario: "s",
      reviewIds: [],
      action: "approve",
    }),
  );

  assert.throws(() =>
    simulationRequestSchema.parse({
      title: "t",
      scenario: "s",
      reviewIds: ["r1"],
      action: "delete",
    }),
  );
});

test("simulationRequestSchema strips a client-posted actorId (WS-C R5 — attribution is server-derived)", () => {
  const parsed = simulationRequestSchema.parse({
    actorId: "user_spoof",
    title: "t",
    scenario: "s",
    reviewIds: ["r1"],
    action: "approve",
  });
  assert.ok(!("actorId" in parsed), "legacy payloads still validate, but the actorId key must be stripped");
});

test("simulationRunSchema requires balanceDelta and vatDelta", () => {
  const ok = simulationRunSchema.parse({
    id: "sim_1",
    title: "t",
    scenario: "s",
    outcomeSummary: "ok",
    affectedAccounts: ["6540"],
    balanceDelta: [{ accountNumber: "6540", accountName: "IT", deltaDebit: 999.2, deltaCredit: 0 }],
    vatDelta: [{ vatCode: "VAT25", deltaBase: 999.2, deltaAmount: 249.8 }],
  });
  assert.equal(ok.balanceDelta.length, 1);
  assert.equal(ok.vatDelta[0]?.vatCode, "VAT25");
});
