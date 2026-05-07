import assert from "node:assert/strict";
import test from "node:test";

import { closePostgresClient, createPostgresClient, PostgresLedgerStore } from "@jpx-accounting/persistence-postgres";

// Integration test: gated on `SUPABASE_DB_URL`. Skips silently when not set so CI without a live DB
// still passes. Run locally with `supabase start` + `psql -f infra/supabase/migrations/0001_init.sql`
// + `psql -f infra/supabase/migrations/0002_schema_alignment.sql`, then export SUPABASE_DB_URL.

const databaseUrl = process.env.SUPABASE_DB_URL;
const skip = !databaseUrl;

test("PostgresLedgerStore round-trips evidence creation, review approval, and report rebuild", { skip }, async () => {
  if (!databaseUrl) return; // belt-and-braces for the type narrower

  const orgId = `org_test_${Date.now().toString(36)}`;
  const wsId = `ws_${Math.random().toString(36).slice(2, 8)}`;

  const client = createPostgresClient({ connectionString: databaseUrl });
  try {
    const store = new PostgresLedgerStore(client, { organizationId: orgId, workspaceId: wsId });

    const created = await store.createEvidence({
      organizationId: orgId,
      workspaceId: wsId,
      actorId: "user_test",
      title: "Integration test invoice",
      originalFilename: "test-invoice.pdf",
      mimeType: "application/pdf",
      modalities: ["pdf", "upload"],
      extractedText: "Integration test invoice body",
    });

    assert.ok(created.evidence.id);
    assert.ok(created.voucher.id);
    assert.ok(created.review.id);
    assert.equal(created.evidence.modalities.includes("pdf"), true);
    assert.equal(created.voucher.status, "needs-review");

    const events = await store.getEvents();
    const myEvents = events.filter((e) => e.organizationId === orgId && e.workspaceId === wsId);
    assert.equal(myEvents.length, 4, "createEvidence should append four events");
    assert.equal(myEvents[0]?.eventType, "EvidenceReceived");
    assert.equal(myEvents[1]?.eventType, "FieldsExtracted");
    assert.equal(myEvents[2]?.eventType, "VoucherCreated");
    assert.equal(myEvents[3]?.eventType, "SuggestionGenerated");

    // Hash chain: each event's previousHash must equal the prior event's eventHash, with GENESIS at the head.
    let prev = "GENESIS";
    for (const evt of myEvents) {
      assert.equal(evt.previousHash, prev, `previousHash mismatch on ${evt.eventType}`);
      prev = evt.eventHash;
    }

    const journalBefore = (await store.getReports()).journal.length;
    const approved = await store.applyReviewDecision(created.review.id, "approve", { actorId: "user_test" });
    assert.equal(approved?.status, "approved");

    const journalAfter = (await store.getReports()).journal.length;
    assert.equal(journalAfter, journalBefore + 3, "approval should append three ledger lines");

    // Idempotency: re-approving must not double-post.
    const reapproved = await store.applyReviewDecision(created.review.id, "approve", { actorId: "user_test" });
    assert.equal(reapproved?.status, "approved");
    assert.equal((await store.getReports()).journal.length, journalAfter, "replay must not duplicate ledger lines");
  } finally {
    // Clean up the test workspace so re-runs are deterministic.
    await client`delete from ledger.events where organization_id = ${orgId}`;
    await client`delete from ledger.review_tasks where organization_id = ${orgId}`;
    await client`delete from ledger.vouchers where organization_id = ${orgId}`;
    await client`delete from ledger.evidence_packet_items
      where evidence_packet_id in (select id from ledger.evidence_packets where organization_id = ${orgId})`;
    await client`delete from ledger.evidence_packets where organization_id = ${orgId}`;
    await client`delete from ledger.evidence_objects where organization_id = ${orgId}`;
    await closePostgresClient(client);
  }
});
