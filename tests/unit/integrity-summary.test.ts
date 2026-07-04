import assert from "node:assert/strict";
import test from "node:test";

import type { LedgerEvent } from "@jpx-accounting/contracts";
import { integritySummarySchema } from "@jpx-accounting/contracts";
import { buildEventHash, MemoryLedgerStore, summarizeEventIntegrity } from "@jpx-accounting/domain";

const VERIFIED_AT = "2026-07-04T12:00:00.000Z";

/** Build a well-linked synthetic chain of `count` events. */
function buildChain(count: number): LedgerEvent[] {
  const events: LedgerEvent[] = [];
  for (let index = 0; index < count; index += 1) {
    const previousHash = index === 0 ? "GENESIS" : events[index - 1]!.eventHash;
    events.push({
      id: `evt_${index + 1}`,
      organizationId: "org_jpx",
      workspaceId: "workspace_main",
      aggregateType: "ledger",
      aggregateId: `agg_${index + 1}`,
      eventType: "PostedToLedger",
      actorId: index % 2 === 0 ? "user_founder" : "system-rules",
      occurredAt: `2026-07-0${(index % 9) + 1}T10:00:00.000Z`,
      payload: { index },
      previousHash,
      eventHash: buildEventHash(previousHash, JSON.stringify({ index })),
      digestDate: "2026-07-04",
    });
  }
  return events;
}

test("intact chain: linked, head hash + last event surfaced, schema-valid", () => {
  const events = buildChain(3);
  const summary = summarizeEventIntegrity(events, { verifiedAt: VERIFIED_AT });

  assert.equal(summary.eventCount, 3);
  assert.equal(summary.chainLinked, true);
  assert.equal(summary.headHash, events[2]!.eventHash);
  assert.equal(summary.lastEventAt, events[2]!.occurredAt);
  assert.equal(summary.verifiedAt, VERIFIED_AT);
  assert.equal(summary.bas.template, "bas-2026");
  assert.ok(summary.bas.accountCount > 0);
  assert.equal(integritySummarySchema.safeParse(summary).success, true);
});

test("recentEvents: last 8 newest-first with the projected fields only", () => {
  const events = buildChain(10);
  const summary = summarizeEventIntegrity(events, { verifiedAt: VERIFIED_AT });

  assert.equal(summary.recentEvents.length, 8);
  assert.equal(summary.recentEvents[0]!.id, "evt_10");
  assert.equal(summary.recentEvents[7]!.id, "evt_3");
  assert.deepEqual(Object.keys(summary.recentEvents[0]!).sort(), [
    "actorId",
    "aggregateType",
    "eventType",
    "id",
    "occurredAt",
  ]);
});

test("reordered events break linkage", () => {
  const events = buildChain(3);
  const reordered = [events[1]!, events[0]!, events[2]!];
  const summary = summarizeEventIntegrity(reordered, { verifiedAt: VERIFIED_AT });
  assert.equal(summary.chainLinked, false);
});

test("a removed middle event breaks linkage", () => {
  const events = buildChain(3);
  const withRemoval = [events[0]!, events[2]!];
  const summary = summarizeEventIntegrity(withRemoval, { verifiedAt: VERIFIED_AT });
  assert.equal(summary.chainLinked, false);
});

test("a removed genesis event breaks linkage", () => {
  const events = buildChain(3);
  const summary = summarizeEventIntegrity(events.slice(1), { verifiedAt: VERIFIED_AT });
  assert.equal(summary.chainLinked, false);
});

test("empty log: vacuously linked with null head", () => {
  const summary = summarizeEventIntegrity([], { verifiedAt: VERIFIED_AT });
  assert.equal(summary.eventCount, 0);
  assert.equal(summary.chainLinked, true);
  assert.equal(summary.headHash, null);
  assert.equal(summary.lastEventAt, null);
  assert.deepEqual(summary.recentEvents, []);
  assert.equal(integritySummarySchema.safeParse(summary).success, true);
});

test("the MemoryLedgerStore seed produces a linked chain", async () => {
  const store = new MemoryLedgerStore();
  const summary = summarizeEventIntegrity(await store.getEvents(), { verifiedAt: VERIFIED_AT });
  assert.equal(summary.chainLinked, true);
  assert.ok(summary.eventCount >= 4);
});
