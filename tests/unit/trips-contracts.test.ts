import assert from "node:assert/strict";
import { test } from "node:test";

import {
  enrichmentProposalSchema,
  eventTypeSchema,
  tripClosedPayloadSchema,
  tripLineEnrichmentPayloadSchema,
  tripRegisteredPayloadSchema,
  tripsListSchema,
} from "@jpx-accounting/contracts";

test("trip event types exist", () => {
  assert.ok(eventTypeSchema.options.includes("TripRegistered"));
  assert.ok(eventTypeSchema.options.includes("TripClosed"));
});

test("trip payload requires purpose traveler and ordered dates", () => {
  const row = tripLineEnrichmentPayloadSchema.parse({
    tripId: "trip_1",
    purpose: "Customer visit",
    traveler: "Ada",
    startDate: "2026-08-01",
    endDate: "2026-08-03",
    evidenceId: "evidence_1",
    distanceKm: 120,
  });

  assert.equal(row.traveler, "Ada");
  assert.equal(row.distanceKm, 120);
  assert.equal(tripLineEnrichmentPayloadSchema.safeParse({ tripId: "trip_1" }).success, false);
  assert.equal(
    tripLineEnrichmentPayloadSchema.safeParse({
      ...row,
      startDate: "2026-08-04",
      endDate: "2026-08-03",
    }).success,
    false,
  );
});

test("trip registration and close payloads identify immutable trip lifecycle events", () => {
  const registered = tripRegisteredPayloadSchema.parse({
    tripId: "trip_1",
    purpose: "Customer visit",
    traveler: "Ada",
    startDate: "2026-08-01",
    endDate: "2026-08-03",
    evidenceId: "evidence_1",
    distanceKm: 120,
    actorId: "forged-client-actor",
  });

  assert.equal("actorId" in registered, false);
  assert.deepEqual(tripClosedPayloadSchema.parse({ tripId: "trip_1" }), { tripId: "trip_1" });
  assert.equal(tripClosedPayloadSchema.safeParse({ tripId: "" }).success, false);
});

test("trip enrichment uses the existing human-confirmed line proposal path", () => {
  const payload = tripLineEnrichmentPayloadSchema.parse({
    tripId: "trip_1",
    purpose: "Customer visit",
    traveler: "Ada",
    startDate: "2026-08-01",
    endDate: "2026-08-03",
  });
  const proposal = enrichmentProposalSchema.parse({
    kind: "line_enrichment_record",
    lineId: "ln_1",
    enrichmentType: "trip",
    payload,
  });

  assert.equal(proposal.kind, "line_enrichment_record");
  assert.deepEqual(proposal.payload, payload);
});

test("trip list rows are contract validated", () => {
  assert.deepEqual(
    tripsListSchema.parse([
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
    ]),
    [
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
    ],
  );
});
