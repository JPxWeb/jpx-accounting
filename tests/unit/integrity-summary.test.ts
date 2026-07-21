import assert from "node:assert/strict";
import test from "node:test";

import type { LedgerEvent } from "@jpx-accounting/contracts";
import { integritySummarySchema } from "@jpx-accounting/contracts";
import {
  buildEventHash,
  legacyDjb2EventHash,
  MemoryLedgerStore,
  summarizeEventIntegrity,
} from "@jpx-accounting/domain";

const VERIFIED_AT = "2026-07-04T12:00:00.000Z";

function makeEvent(
  index: number,
  previousHash: string,
  eventHash: string,
  payload: Record<string, unknown>,
): LedgerEvent {
  return {
    id: `evt_${index + 1}`,
    organizationId: "org_jpx",
    workspaceId: "workspace_main",
    aggregateType: "ledger",
    aggregateId: `agg_${index + 1}`,
    eventType: "PostedToLedger",
    actorId: index % 2 === 0 ? "user_founder" : "system-rules",
    occurredAt: `2026-07-0${(index % 9) + 1}T10:00:00.000Z`,
    payload,
    previousHash,
    eventHash,
    digestDate: "2026-07-04",
  };
}

/** Build a well-linked SHA-256 chain of `count` events (post-cutover appends). */
function buildChain(count: number): LedgerEvent[] {
  const events: LedgerEvent[] = [];
  for (let index = 0; index < count; index += 1) {
    const previousHash = index === 0 ? "GENESIS" : events[index - 1]!.eventHash;
    const payload = { index };
    events.push(makeEvent(index, previousHash, buildEventHash(previousHash, payload), payload));
  }
  return events;
}

/**
 * Build a pre-cutover chain the way the legacy append path did:
 * djb2 over `previousHash + ":" + JSON.stringify(payload)`.
 */
function buildLegacyChain(count: number): LedgerEvent[] {
  const events: LedgerEvent[] = [];
  for (let index = 0; index < count; index += 1) {
    const previousHash = index === 0 ? "GENESIS" : events[index - 1]!.eventHash;
    const payload = { index, legacy: true };
    events.push(makeEvent(index, previousHash, legacyDjb2EventHash(previousHash, JSON.stringify(payload)), payload));
  }
  return events;
}

/** Continue an existing chain with SHA-256 appends (the post-cutover suffix). */
function extendWithSha256(events: LedgerEvent[], count: number): LedgerEvent[] {
  const extended = [...events];
  for (let index = 0; index < count; index += 1) {
    const absoluteIndex = extended.length;
    const previousHash = extended.at(-1)?.eventHash ?? "GENESIS";
    const payload = { index: absoluteIndex };
    extended.push(makeEvent(absoluteIndex, previousHash, buildEventHash(previousHash, payload), payload));
  }
  return extended;
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

test("default (no verifyPayloads) output keeps the pre-R14 shape — web chip compatibility pin", () => {
  const summary = summarizeEventIntegrity(buildChain(2), { verifiedAt: VERIFIED_AT });
  assert.equal("payloadVerified" in summary, false);
  assert.equal("payloadMismatchCount" in summary, false);
  assert.equal("recomputedEventCount" in summary, false);
  assert.equal("legacyEventCount" in summary, false);
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

test("the MemoryLedgerStore seed produces a linked SHA-256 chain that survives payload recomputation", async () => {
  const store = new MemoryLedgerStore();
  const events = await store.getEvents();
  const summary = summarizeEventIntegrity(events, { verifiedAt: VERIFIED_AT, verifyPayloads: true });

  assert.equal(summary.chainLinked, true);
  assert.ok(summary.eventCount >= 4);
  assert.equal(summary.payloadVerified, true);
  assert.equal(summary.payloadMismatchCount, 0);
  assert.equal(summary.recomputedEventCount, events.length);
  assert.equal(summary.legacyEventCount, 0);
  assert.equal(integritySummarySchema.safeParse(summary).success, true);
});

test("appending through MemoryLedgerStore keeps the chain linked and recomputable", async () => {
  const store = new MemoryLedgerStore();
  await store.createEvidence({
    organizationId: "org_jpx",
    workspaceId: "workspace_main",
    actorId: "user_founder",
    title: "Taxi receipt",
    originalFilename: "taxi.jpg",
    mimeType: "image/jpeg",
    modalities: ["camera"],
    extractedText: "Taxi Stockholm 245,00 kr",
  });

  const summary = summarizeEventIntegrity(await store.getEvents(), { verifiedAt: VERIFIED_AT, verifyPayloads: true });
  assert.equal(summary.chainLinked, true);
  assert.equal(summary.payloadVerified, true);
  assert.equal(summary.payloadMismatchCount, 0);
});

// ---------------------------------------------------------------------------
// Scheme cutover: legacy djb2 prefix + SHA-256 suffix (WS-B R14)
// ---------------------------------------------------------------------------

test("a legacy djb2 chain verifies by linkage only (recomputation reports it as legacy)", () => {
  const events = buildLegacyChain(4);
  const summary = summarizeEventIntegrity(events, { verifiedAt: VERIFIED_AT, verifyPayloads: true });

  assert.equal(summary.chainLinked, true);
  assert.equal(summary.legacyEventCount, 4);
  assert.equal(summary.recomputedEventCount, 0);
  assert.equal(summary.payloadMismatchCount, 0);
  assert.equal(summary.payloadVerified, true);
});

test("mixed chain: djb2 prefix + SHA-256 suffix links, and only the suffix is recomputed", () => {
  const events = extendWithSha256(buildLegacyChain(3), 2);
  const summary = summarizeEventIntegrity(events, { verifiedAt: VERIFIED_AT, verifyPayloads: true });

  assert.equal(summary.chainLinked, true);
  assert.equal(summary.eventCount, 5);
  assert.equal(summary.legacyEventCount, 3);
  assert.equal(summary.recomputedEventCount, 2);
  assert.equal(summary.payloadMismatchCount, 0);
  assert.equal(summary.payloadVerified, true);
  assert.equal(integritySummarySchema.safeParse(summary).success, true);
});

test("a djb2-format hash AFTER the SHA-256 cutover point breaks the chain", () => {
  const events = extendWithSha256(buildLegacyChain(1), 2);
  // Forge a "legacy-looking" event on top of the SHA-256 suffix — an attacker
  // dressing new events as legacy to dodge payload recomputation.
  const previousHash = events.at(-1)!.eventHash;
  const payload = { index: events.length, forged: true };
  events.push(
    makeEvent(events.length, previousHash, legacyDjb2EventHash(previousHash, JSON.stringify(payload)), payload),
  );

  const summary = summarizeEventIntegrity(events, { verifiedAt: VERIFIED_AT });
  assert.equal(summary.chainLinked, false);
});

test("an eventHash matching neither scheme breaks the chain and counts as unverifiable", () => {
  const events = buildChain(3);
  const tampered = [...events.slice(0, 2), { ...events[2]!, eventHash: "deadbeef".repeat(8) }];

  const summary = summarizeEventIntegrity(tampered, { verifiedAt: VERIFIED_AT, verifyPayloads: true });
  assert.equal(summary.chainLinked, false);
  assert.equal(summary.payloadVerified, false);
  assert.equal(summary.payloadMismatchCount, 1);
});

// ---------------------------------------------------------------------------
// Tamper detection (WS-B R14)
// ---------------------------------------------------------------------------

test("payload tamper: linkage alone stays green, recomputation flags the mismatch", () => {
  const events = buildChain(4);
  const tampered = events.map((event, index) =>
    index === 2 ? { ...event, payload: { ...event.payload, index: 999 } } : event,
  );

  // Linkage-only verification cannot see an in-place payload edit…
  const linkageOnly = summarizeEventIntegrity(tampered, { verifiedAt: VERIFIED_AT });
  assert.equal(linkageOnly.chainLinked, true);

  // …but recomputation catches exactly the edited event.
  const recomputed = summarizeEventIntegrity(tampered, { verifiedAt: VERIFIED_AT, verifyPayloads: true });
  assert.equal(recomputed.chainLinked, true);
  assert.equal(recomputed.payloadVerified, false);
  assert.equal(recomputed.payloadMismatchCount, 1);
  assert.equal(recomputed.recomputedEventCount, 4);
});

test("relink attack: rehashing a tampered event breaks linkage at its successor", () => {
  const events = buildChain(4);
  const payload = { index: 2, tampered: true };
  const relinked = events.map((event, index) =>
    index === 2 ? { ...event, payload, eventHash: buildEventHash(event.previousHash, payload) } : event,
  );

  // The tampered event now recomputes cleanly — but its successor still
  // points at the ORIGINAL hash, so the linkage walk catches the rewrite.
  const summary = summarizeEventIntegrity(relinked, { verifiedAt: VERIFIED_AT, verifyPayloads: true });
  assert.equal(summary.chainLinked, false);
  assert.equal(summary.payloadMismatchCount, 0);
});

test("tampering the head event's payload is caught by recomputation even with no successor", () => {
  const events = buildChain(3);
  const tampered = [...events.slice(0, 2), { ...events[2]!, payload: { index: 999 } }];

  const summary = summarizeEventIntegrity(tampered, { verifiedAt: VERIFIED_AT, verifyPayloads: true });
  assert.equal(summary.chainLinked, true); // linkage can never see a head edit
  assert.equal(summary.payloadVerified, false);
  assert.equal(summary.payloadMismatchCount, 1);
});
