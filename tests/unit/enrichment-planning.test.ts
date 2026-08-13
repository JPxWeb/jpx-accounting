import assert from "node:assert/strict";
import { test } from "node:test";

import type { EnrichmentWorkItem } from "@jpx-accounting/contracts";
import {
  collectPostedEnrichmentTargets,
  EnrichmentNotSupportedError,
  EnrichmentTargetNotPostedError,
  planPostPostEnrichmentConfirm,
} from "@jpx-accounting/domain";

const baseWorkItem: EnrichmentWorkItem = {
  id: "ewi_1",
  organizationId: "org_jpx",
  workspaceId: "workspace_main",
  targetKind: "voucher",
  targetId: "voucher_posted",
  proposedChange: { kind: "noop" },
  status: "pending_confirmation",
  source: "ui",
  idempotencyKey: "k1",
  createdAt: "2026-08-09T10:00:00.000Z",
  createdBy: "user:abc",
};

test("planPostPostEnrichmentConfirm rejects unposted voucher targets", () => {
  assert.throws(
    () =>
      planPostPostEnrichmentConfirm({
        workItem: { ...baseWorkItem, targetId: "voucher_missing" },
        actorId: "user:abc",
        postedVoucherIds: new Set(["voucher_posted"]),
        postedLineIds: new Set(),
      }),
    EnrichmentTargetNotPostedError,
  );
});

test("planPostPostEnrichmentConfirm rejects unposted line targets", () => {
  assert.throws(
    () =>
      planPostPostEnrichmentConfirm({
        workItem: { ...baseWorkItem, targetKind: "line", targetId: "line_missing" },
        actorId: "user:abc",
        postedVoucherIds: new Set(["voucher_posted"]),
        postedLineIds: new Set(),
      }),
    EnrichmentTargetNotPostedError,
  );
});

test("collectPostedEnrichmentTargets ignores line ids outside posting events", () => {
  const targets = collectPostedEnrichmentTargets([
    {
      aggregateId: "simulation_1",
      eventType: "SimulationExecuted",
      payload: { lines: [{ lineId: "line_not_posted" }] },
    },
    {
      id: "evt_posted",
      aggregateId: "voucher_posted",
      eventType: "PostedToLedger",
      payload: { lines: [{ lineId: "line_posted" }, { accountNumber: "1930" }] },
    },
  ]);

  assert.equal(targets.postedVoucherIds.has("simulation_1"), false);
  assert.equal(targets.postedLineIds.has("line_not_posted"), false);
  assert.equal(targets.postedVoucherIds.has("voucher_posted"), true);
  assert.equal(targets.postedLineIds.has("line_posted"), true);
  assert.equal(targets.postedLineIds.has("legacy_evt_posted_1"), true);
});

test("planPostPostEnrichmentConfirm never emits PostedToLedger for noop", () => {
  const plan = planPostPostEnrichmentConfirm({
    workItem: baseWorkItem,
    actorId: "user:abc",
    postedVoucherIds: new Set(["voucher_posted"]),
    postedLineIds: new Set(),
  });

  assert.ok(plan.events.every((event) => event.eventType !== "PostedToLedger"));
  assert.equal(plan.events.length, 0);
});

test("unknown proposal kinds fail closed at runtime", () => {
  const staleKindWorkItem = {
    ...baseWorkItem,
    proposedChange: { kind: "future_kind" },
  } as unknown as EnrichmentWorkItem;

  assert.throws(
    () =>
      planPostPostEnrichmentConfirm({
        workItem: staleKindWorkItem,
        actorId: "user:abc",
        postedVoucherIds: new Set(["voucher_posted"]),
        postedLineIds: new Set(),
      }),
    EnrichmentNotSupportedError,
  );
});
