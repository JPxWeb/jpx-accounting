import assert from "node:assert/strict";
import test from "node:test";

import { ReviewNotFoundError } from "@jpx-accounting/domain";
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

test("PostgresLedgerStore.runSimulation real diff + ReviewNotFoundError", { skip }, async () => {
  if (!databaseUrl) return;
  const orgId = `org_test_${Date.now().toString(36)}`;
  const wsId = `ws_${Math.random().toString(36).slice(2, 8)}`;
  const client = createPostgresClient({ connectionString: databaseUrl });
  try {
    const store = new PostgresLedgerStore(client, { organizationId: orgId, workspaceId: wsId });

    const created = await store.createEvidence({
      organizationId: orgId,
      workspaceId: wsId,
      actorId: "user_test",
      title: "Sim invoice",
      originalFilename: "sim.pdf",
      mimeType: "application/pdf",
      modalities: ["pdf"],
    });

    const sim = await store.runSimulation({
      actorId: "user_test",
      title: "what-if",
      scenario: "approve one",
      reviewIds: [created.review.id],
      action: "approve",
    });
    assert.ok(sim.balanceDelta.length > 0, "balance delta non-empty");
    assert.ok(sim.affectedAccounts.includes("2641"), "input VAT in affected accounts");

    await assert.rejects(
      () =>
        store.runSimulation({
          actorId: "u",
          title: "t",
          scenario: "s",
          reviewIds: ["review_does_not_exist"],
          action: "approve",
        }),
      (err) => err instanceof ReviewNotFoundError,
    );
  } finally {
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

test("PostgresLedgerStore.answerAssistantQuestion delegates + persists", { skip }, async () => {
  if (!databaseUrl) return;
  const orgId = `org_test_${Date.now().toString(36)}`;
  const wsId = `ws_${Math.random().toString(36).slice(2, 8)}`;
  const client = createPostgresClient({ connectionString: databaseUrl });
  try {
    const store = new PostgresLedgerStore(client, { organizationId: orgId, workspaceId: wsId });
    const session = await store.answerAssistantQuestion("Can I deduct this?");
    assert.equal(session.status, "grounded");
    assert.equal(session.citations.length, 1);
    assert.equal(session.question, "Can I deduct this?");

    const rows = await client<Array<{ question: string }>>`
      SELECT question FROM ledger.assistant_sessions WHERE id = ${session.id}
    `;
    assert.equal(rows[0]?.question, "Can I deduct this?");
  } finally {
    await client`delete from ledger.assistant_sessions where organization_id = ${orgId}`;
    await closePostgresClient(client);
  }
});

test("PostgresLedgerStore.refreshComplianceAlerts is idempotent (same input → same set)", { skip }, async () => {
  if (!databaseUrl) return;
  const orgId = `org_test_${Date.now().toString(36)}`;
  const wsId = `ws_${Math.random().toString(36).slice(2, 8)}`;
  const client = createPostgresClient({ connectionString: databaseUrl });
  try {
    const store = new PostgresLedgerStore(client, { organizationId: orgId, workspaceId: wsId });

    // Empty workspace: both calls return empty (or just whatever pre-existed via dedup index).
    const first = await store.refreshComplianceAlerts();
    const second = await store.refreshComplianceAlerts();
    assert.equal(first.length, second.length);
    assert.deepEqual(first.map((a) => a.id).sort(), second.map((a) => a.id).sort());
  } finally {
    await client`delete from ledger.compliance_alerts where organization_id = ${orgId}`;
    await closePostgresClient(client);
  }
});

test("PostgresLedgerStore.getCompanySettings/putCompanySettings round-trip", { skip }, async () => {
  if (!databaseUrl) return;
  const orgId = `org_test_${Date.now().toString(36)}`;
  const wsId = `ws_${Math.random().toString(36).slice(2, 8)}`;
  const client = createPostgresClient({ connectionString: databaseUrl });
  try {
    const store = new PostgresLedgerStore(client, { organizationId: orgId, workspaceId: wsId });
    assert.equal(await store.getCompanySettings(), null);

    const settings = {
      organizationId: orgId,
      organizationName: "Test AB",
      organizationNumber: "556677-8899",
      addressLine1: "Kungsgatan 1",
      postalCode: "111 22",
      city: "Stockholm",
      contactEmail: "test@example.com",
    };
    await store.putCompanySettings(settings);
    const loaded = await store.getCompanySettings();
    assert.equal(loaded?.organizationName, "Test AB");
    assert.equal(loaded?.organizationNumber, "556677-8899");
  } finally {
    await client`delete from ledger.organization_settings where organization_id = ${orgId}`;
    await closePostgresClient(client);
  }
});
