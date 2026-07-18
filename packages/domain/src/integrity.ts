import type { IntegritySummary, LedgerEvent } from "@jpx-accounting/contracts";

import { defaultCoaTemplate } from "./coa/registry";
import type { CoaTemplate } from "./coa/types";
import { buildEventHash, detectEventHashScheme } from "./hash-chain";

const RECENT_EVENTS_MAX = 8;

/**
 * Summarize the hash-chain integrity of a workspace's event log
 * (advisory pivot Phase 5, plan finding 7; hardened by WS-B R14).
 *
 * ## Linkage
 *
 * The genesis event must carry `previousHash === "GENESIS"` and every
 * subsequent event's `previousHash` must equal its predecessor's
 * `eventHash`. That detects removal, reordering, and insertion anywhere in
 * the chain, regardless of which hash scheme produced each link.
 *
 * ## Scheme cutover rule (djb2 → SHA-256)
 *
 * The ledger is append-only, so pre-cutover chains keep their legacy djb2
 * hashes (`h_` + 8 hex) forever — there is deliberately NO rewrite
 * migration. Post-cutover appends always use SHA-256 (`sha256_` + 64 hex,
 * see `hash-chain.ts`). A valid chain is therefore an OLDER djb2 prefix
 * (possibly empty) followed by a NEWER SHA-256 suffix (possibly empty), and
 * each link is validated under its own scheme:
 *
 * - djb2 links: linkage only. Their hashes were built over the append-time
 *   `JSON.stringify(payload)`, whose key order did not survive the Postgres
 *   jsonb round trip — recomputation is impossible by construction.
 * - SHA-256 links: linkage always; payload recomputation on request (they
 *   hash `canonicalJson`, which IS byte-stable across the jsonb round trip).
 * - A djb2-format hash appearing AFTER any SHA-256 hash breaks the chain:
 *   no honest append could have produced it, and accepting it would let a
 *   forger dodge recomputation by dressing new events up as legacy ones.
 * - A hash matching neither format breaks the chain outright.
 *
 * ## Payload recomputation (`verifyPayloads: true`)
 *
 * Recomputes each SHA-256 event's `eventHash` from its STORED payload via
 * the same `buildEventHash(previousHash, payload)` used at append time and
 * reports mismatches — this catches in-place payload edits that pure
 * linkage cannot see. Results land in the optional `payloadVerified` /
 * `payloadMismatchCount` / `recomputedEventCount` / `legacyEventCount`
 * fields; legacy djb2 events count as `legacyEventCount` and stay
 * linkage-only per the cutover rule. When the option is off the summary is
 * shape-identical to the pre-R14 output, so existing `GET /api/integrity`
 * consumers (the web chip) need no change.
 *
 * Pure and deterministic given `events` + `verifiedAt`; both stores'
 * `getEvents()` feed it (API route and offline api-client fallback alike).
 */
export function summarizeEventIntegrity(
  events: LedgerEvent[],
  options: { verifiedAt: string; coa?: CoaTemplate; verifyPayloads?: boolean },
): IntegritySummary {
  const coa = options.coa ?? defaultCoaTemplate;

  let chainLinked = true;
  let sawSha256 = false;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    const expectedPrevious = index === 0 ? "GENESIS" : events[index - 1]!.eventHash;
    if (event.previousHash !== expectedPrevious) {
      chainLinked = false;
      break;
    }
    const scheme = detectEventHashScheme(event.eventHash);
    if (scheme === "unknown" || (scheme === "djb2" && sawSha256)) {
      // Unknown format, or a "legacy" hash after the SHA-256 cutover point —
      // neither can come from an honest append (see cutover rule above).
      chainLinked = false;
      break;
    }
    if (scheme === "sha256") sawSha256 = true;
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

  const summary: IntegritySummary = {
    eventCount: events.length,
    chainLinked,
    headHash: head?.eventHash ?? null,
    lastEventAt: head?.occurredAt ?? null,
    verifiedAt: options.verifiedAt,
    recentEvents,
    bas: { template: coa.id, accountCount: coa.accounts.length },
  };

  if (!options.verifyPayloads) return summary;

  let payloadMismatchCount = 0;
  let recomputedEventCount = 0;
  let legacyEventCount = 0;
  for (const event of events) {
    const scheme = detectEventHashScheme(event.eventHash);
    if (scheme === "sha256") {
      recomputedEventCount += 1;
      if (buildEventHash(event.previousHash, event.payload) !== event.eventHash) {
        payloadMismatchCount += 1;
      }
    } else if (scheme === "djb2") {
      // Pre-cutover link: linkage-only by design (jsonb key-order blocker).
      legacyEventCount += 1;
    } else {
      // Unknown scheme: unverifiable, count as a mismatch (chainLinked is
      // already false via the scheme check above).
      payloadMismatchCount += 1;
    }
  }

  return {
    ...summary,
    payloadVerified: payloadMismatchCount === 0,
    payloadMismatchCount,
    recomputedEventCount,
    legacyEventCount,
  };
}
