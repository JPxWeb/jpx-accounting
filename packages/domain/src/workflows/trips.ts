import {
  tripClosedPayloadSchema,
  tripLineEnrichmentPayloadSchema,
  tripRegisteredPayloadSchema,
  type LedgerEvent,
  type TripsListRow,
} from "@jpx-accounting/contracts";

import { buildLineEnrichmentsFromEvents } from "../enrichment-projections";
import { buildJournal, collectLedgerLinesFromEvents } from "../projections";
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

  const expenseByLineId = new Map(
    buildJournal(collectLedgerLinesFromEvents(events)).flatMap((line) =>
      line.lineId === undefined ? [] : [[line.lineId, round2(line.debit - line.credit)] as const],
    ),
  );

  for (const enrichment of buildLineEnrichmentsFromEvents(events)) {
    if (enrichment.superseded || enrichment.enrichmentType !== "trip") continue;

    const payload = tripLineEnrichmentPayloadSchema.safeParse(enrichment.payload);
    if (!payload.success) continue;

    const trip = trips.get(payload.data.tripId);
    const expense = expenseByLineId.get(enrichment.lineId);
    if (trip && expense !== undefined) {
      trips.set(trip.id, { ...trip, expenseTotal: round2(trip.expenseTotal + expense) });
    }
  }

  return [...trips.values()];
}
