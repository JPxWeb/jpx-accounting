import assert from "node:assert/strict";
import { test } from "node:test";

import type { LedgerEvent } from "@jpx-accounting/contracts";
import { buildListProjection, buildTripsList } from "@jpx-accounting/domain";

function event(id: string, eventType: LedgerEvent["eventType"], payload: Record<string, unknown>): LedgerEvent {
  return {
    id,
    organizationId: "org_jpx",
    workspaceId: "workspace_main",
    aggregateType: "ledger",
    aggregateId: "trip_1",
    eventType,
    actorId: "user:test",
    occurredAt: "2026-08-09T10:00:00.000Z",
    payload,
    previousHash: id === "evt_trip" ? "GENESIS" : "sha256_trip",
    eventHash: `sha256_${id.padEnd(64, "0").slice(0, 64)}`,
    digestDate: "2026-08-09",
  };
}

const trip = {
  tripId: "trip_1",
  purpose: "Customer visit",
  traveler: "Ada",
  startDate: "2026-08-01",
  endDate: "2026-08-03",
} as const;

test("trip list totals expenses and retains closed trips", () => {
  const rows = buildTripsList([
    event("evt_trip", "TripRegistered", trip),
    event("evt_expense", "LineEnrichmentRecorded", {
      lineId: "ln_1",
      enrichmentId: "le_1",
      enrichmentType: "trip",
      payload: { tripId: "trip_1", expenseAmount: 250 },
    }),
    event("evt_closed", "TripClosed", { tripId: "trip_1" }),
  ]);

  assert.deepEqual(rows, [
    {
      id: "trip_1",
      kind: "trip",
      purpose: "Customer visit",
      traveler: "Ada",
      startDate: "2026-08-01",
      endDate: "2026-08-03",
      status: "closed",
      expenseTotal: 250,
    },
  ]);
});

test("first trip registration remains authoritative during replay", () => {
  const rows = buildTripsList([
    event("evt_trip", "TripRegistered", trip),
    event("evt_closed", "TripClosed", { tripId: "trip_1" }),
    event("evt_duplicate", "TripRegistered", {
      ...trip,
      purpose: "Rewritten purpose",
      traveler: "Mallory",
    }),
  ]);

  assert.equal(rows[0]?.purpose, "Customer visit");
  assert.equal(rows[0]?.traveler, "Ada");
  assert.equal(rows[0]?.status, "closed");
});

test("superseded trip expenses are replaced rather than double counted", () => {
  const rows = buildTripsList([
    event("evt_trip", "TripRegistered", trip),
    event("evt_expense", "LineEnrichmentRecorded", {
      lineId: "ln_1",
      enrichmentId: "le_1",
      enrichmentType: "trip",
      payload: { tripId: "trip_1", expenseAmount: 250 },
    }),
    event("evt_superseded", "LineEnrichmentSuperseded", {
      lineId: "ln_1",
      priorEnrichmentId: "le_1",
      replacementEnrichmentId: "le_2",
    }),
    event("evt_replacement", "LineEnrichmentRecorded", {
      lineId: "ln_1",
      enrichmentId: "le_2",
      enrichmentType: "trip",
      payload: { tripId: "trip_1", expenseAmount: 300 },
    }),
  ]);

  assert.equal(rows[0]?.expenseTotal, 300);
});

test("trip list builder is registered on the generic projection seam", () => {
  const events = [event("evt_trip", "TripRegistered", trip)];

  assert.deepEqual(buildListProjection("trip", events), buildTripsList(events));
});
