import {
  tripClosedPayloadSchema,
  tripRegisteredPayloadSchema,
  type LedgerEvent,
  type TripsListRow,
} from "@jpx-accounting/contracts";

import { buildLineEnrichmentsFromEvents } from "../enrichment-projections";
import { round2 } from "../store-shared";

export type { TripsListRow } from "@jpx-accounting/contracts";

export function buildTripsList(events: LedgerEvent[]): TripsListRow[] {
  const trips = new Map<string, TripsListRow>();

  for (const event of events) {
    if (event.eventType === "TripRegistered") {
      const trip = tripRegisteredPayloadSchema.parse(event.payload);
      if (trips.has(trip.tripId)) continue;
      trips.set(trip.tripId, {
        id: trip.tripId,
        kind: "trip",
        purpose: trip.purpose,
        traveler: trip.traveler,
        startDate: trip.startDate,
        endDate: trip.endDate,
        status: "open",
        expenseTotal: 0,
      });
      continue;
    }

    if (event.eventType === "TripClosed") {
      const { tripId } = tripClosedPayloadSchema.parse(event.payload);
      const trip = trips.get(tripId);
      if (trip) trips.set(tripId, { ...trip, status: "closed" });
    }
  }

  for (const enrichment of buildLineEnrichmentsFromEvents(events)) {
    if (enrichment.superseded || enrichment.enrichmentType !== "trip") continue;

    const { tripId, expenseAmount } = enrichment.payload;
    if (typeof tripId !== "string" || typeof expenseAmount !== "number" || !Number.isFinite(expenseAmount)) continue;

    const trip = trips.get(tripId);
    if (trip) trip.expenseTotal = round2(trip.expenseTotal + expenseAmount);
  }

  return [...trips.values()];
}
