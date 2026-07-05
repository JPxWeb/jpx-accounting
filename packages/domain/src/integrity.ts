import type { IntegritySummary, LedgerEvent } from "@jpx-accounting/contracts";

import { defaultCoaTemplate } from "./coa/registry";
import type { CoaTemplate } from "./coa/types";

const RECENT_EVENTS_MAX = 8;

/**
 * Summarize the hash-chain integrity of a workspace's event log
 * (advisory pivot Phase 5, plan finding 7).
 *
 * Verification checks LINKAGE, not payload recomputation: the genesis event
 * must carry `previousHash === "GENESIS"` and every subsequent event's
 * `previousHash` must equal its predecessor's `eventHash`. That detects
 * removal, reordering, and insertion anywhere in the chain. Recomputing
 * `eventHash` from the payload is deliberately NOT attempted — Postgres jsonb
 * normalizes key order, so `JSON.stringify(payload)` is not byte-stable
 * across stores. Canonical-serialization payload-tamper detection is a
 * documented future note.
 *
 * Pure and deterministic given `events` + `verifiedAt`; both stores'
 * `getEvents()` feed it (API route and offline api-client fallback alike).
 */
export function summarizeEventIntegrity(
  events: LedgerEvent[],
  options: { verifiedAt: string; coa?: CoaTemplate },
): IntegritySummary {
  const coa = options.coa ?? defaultCoaTemplate;

  let chainLinked = true;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    const expectedPrevious = index === 0 ? "GENESIS" : events[index - 1]!.eventHash;
    if (event.previousHash !== expectedPrevious) {
      chainLinked = false;
      break;
    }
  }

  const head = events.at(-1);
  const recentEvents = events
    .slice(-RECENT_EVENTS_MAX)
    .reverse()
    .map((event) => ({
      id: event.id,
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      occurredAt: event.occurredAt,
      actorId: event.actorId,
    }));

  return {
    eventCount: events.length,
    chainLinked,
    headHash: head?.eventHash ?? null,
    lastEventAt: head?.occurredAt ?? null,
    verifiedAt: options.verifiedAt,
    recentEvents,
    bas: { template: coa.id, accountCount: coa.accounts.length },
  };
}
