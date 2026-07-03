import assert from "node:assert/strict";
import test from "node:test";

import type { ExtractionResult } from "@jpx-accounting/contracts";
import { deriveDeterministicExtraction, MemoryLedgerStore, ReviewNotFoundError, today } from "@jpx-accounting/domain";
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

test("PostgresLedgerStore.createEvidence upload metadata round-trip + Memory field parity", { skip }, async () => {
  if (!databaseUrl) return;
  const orgId = `org_test_${Date.now().toString(36)}`;
  const wsId = `ws_${Math.random().toString(36).slice(2, 8)}`;
  const client = createPostgresClient({ connectionString: databaseUrl });
  try {
    const store = new PostgresLedgerStore(client, { organizationId: orgId, workspaceId: wsId });

    const sha256 = "cd".repeat(32);
    const blobPath = "evidence-uploads/integ-upload-1/uploaded-receipt.jpg";
    const baseInput = {
      actorId: "user_test",
      title: "Uploaded receipt",
      originalFilename: "uploaded-receipt.jpg",
      mimeType: "image/jpeg",
      modalities: ["upload" as const],
      sizeBytes: 48211,
      sha256,
      uploadId: "integ-upload-1",
      blobPath,
    };

    const created = await store.createEvidence({ ...baseInput, organizationId: orgId, workspaceId: wsId });
    assert.equal(created.evidence.hash, sha256, "sha256 must become the evidence hash");
    assert.equal(created.evidence.blobPath, blobPath, "client-echoed blobPath must be stored");
    assert.equal(created.evidence.sizeBytes, 48211, "sizeBytes must round-trip");
    assert.notEqual(created.voucher.voucherFields.grossAmount, 1249, "file-seeded gross must not be the legacy 1249");

    // metadata jsonb read-back — both via the mapped read path and the raw row.
    const context = await store.getEvidenceContext(created.evidence.id);
    assert.equal(context?.evidence.sizeBytes, 48211, "sizeBytes must be read back from metadata jsonb");
    const rows = await client<Array<{ metadata: { sizeBytes?: number } | null }>>`
      SELECT metadata FROM ledger.evidence_objects WHERE id = ${created.evidence.id}
    `;
    assert.equal(rows[0]?.metadata?.sizeBytes, 48211, "metadata jsonb must carry sizeBytes");

    // Memory/Postgres parity on the derived fields (CONVENTIONS Rule 11).
    const memory = new MemoryLedgerStore();
    const memCreated = await memory.createEvidence({
      ...baseInput,
      organizationId: "org_jpx",
      workspaceId: "workspace_main",
    });
    assert.deepEqual(created.voucher.extractedFields, memCreated.voucher.extractedFields);
    assert.deepEqual(created.voucher.voucherFields, memCreated.voucher.voucherFields);
    assert.equal(created.evidence.hash, memCreated.evidence.hash);
    assert.equal(created.evidence.blobPath, memCreated.evidence.blobPath);
    assert.equal(created.evidence.sizeBytes, memCreated.evidence.sizeBytes);
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

test(
  "PostgresLedgerStore.updateEvidenceExtraction persists refresh, chains events, guards decided vouchers + Memory parity",
  { skip },
  async () => {
    if (!databaseUrl) return;
    const orgId = `org_test_${Date.now().toString(36)}`;
    const wsId = `ws_${Math.random().toString(36).slice(2, 8)}`;
    const client = createPostgresClient({ connectionString: databaseUrl });
    try {
      const store = new PostgresLedgerStore(client, { organizationId: orgId, workspaceId: wsId });

      const baseInput = {
        actorId: "user_test",
        title: "Extraction refresh receipt",
        originalFilename: "refresh-me.jpg",
        mimeType: "image/jpeg",
        modalities: ["camera" as const],
      };
      const created = await store.createEvidence({ ...baseInput, organizationId: orgId, workspaceId: wsId });
      assert.equal(created.voucher.voucherFields.grossAmount, 1249, "legacy create precondition");

      const refresh: ExtractionResult = {
        modelId: "prebuilt-invoice",
        fields: deriveDeterministicExtraction({ filename: "refresh-me.jpg", sizeBytes: 77777 }, today()),
        extractedAt: new Date().toISOString(),
      };

      const eventsBefore = await store.getEvents();
      const updated = await store.updateEvidenceExtraction(created.evidence.id, refresh);
      assert.ok(updated?.voucher, "refresh must return the voucher context");

      const refreshedGross = Number.parseFloat(refresh.fields.find((field) => field.key === "grossAmount")!.value);
      assert.equal(updated.voucher.voucherFields.grossAmount, refreshedGross, "refreshed gross wins");
      assert.equal(updated.voucher.voucherFields.description, baseInput.title, "description preserved");
      assert.ok(updated.review, "review must ride along");
      assert.notEqual(updated.review.suggestion?.id, created.review.suggestion?.id, "suggestion regenerated");

      // Persisted on the read model, not just the returned copy.
      const context = await store.getEvidenceContext(created.evidence.id);
      assert.equal(context?.voucher?.voucherFields.grossAmount, refreshedGross);

      // Exactly two hash-chained events with system actors.
      const eventsAfter = await store.getEvents();
      assert.equal(eventsAfter.length, eventsBefore.length + 2, "exactly two events appended");
      const [refreshedEvt, suggestionEvt] = eventsAfter.slice(-2);
      assert.equal(refreshedEvt?.eventType, "ExtractionRefreshed");
      assert.equal(refreshedEvt?.actorId, "system-extractor");
      assert.equal(suggestionEvt?.eventType, "SuggestionGenerated");
      assert.equal(suggestionEvt?.actorId, "system-ai");
      assert.equal(refreshedEvt?.previousHash, eventsBefore.at(-1)?.eventHash);
      assert.equal(suggestionEvt?.previousHash, refreshedEvt?.eventHash);

      // Decided-voucher guard: approve, refresh again → zero mutations/events.
      const approved = await store.applyReviewDecision(created.review.id, "approve", { actorId: "user_test" });
      assert.equal(approved?.status, "approved");
      const eventsAfterApprove = await store.getEvents();
      const guarded = await store.updateEvidenceExtraction(created.evidence.id, {
        ...refresh,
        fields: deriveDeterministicExtraction({ filename: "refresh-me.jpg", sizeBytes: 11111 }, today()),
      });
      assert.equal(guarded?.voucher?.status, "approved");
      assert.equal(guarded?.voucher?.voucherFields.grossAmount, refreshedGross, "decided voucher untouched");
      assert.equal((await store.getEvents()).length, eventsAfterApprove.length, "no events appended past decision");

      // Memory/Postgres parity on the refreshed read model (CONVENTIONS Rule 11).
      const memory = new MemoryLedgerStore();
      const memCreated = await memory.createEvidence({
        ...baseInput,
        organizationId: "org_jpx",
        workspaceId: "workspace_main",
      });
      const memUpdated = await memory.updateEvidenceExtraction(memCreated.evidence.id, refresh);
      assert.ok(memUpdated?.voucher);
      assert.deepEqual(updated.voucher.extractedFields, memUpdated.voucher.extractedFields);
      assert.deepEqual(updated.voucher.voucherFields, memUpdated.voucher.voucherFields);
      assert.equal(updated.review.suggestion?.accountNumber, memUpdated.review?.suggestion?.accountNumber);
      assert.equal(updated.review.suggestion?.vatCode, memUpdated.review?.suggestion?.vatCode);
      assert.equal(updated.review.blockedReason, memUpdated.review?.blockedReason);
      assert.equal(updated.review.suggestedAction, memUpdated.review?.suggestedAction);
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
  },
);

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
      profile: { country: "SE" as const, locale: "en-GB", currency: "EUR", fiscalYearStart: "07-01" },
    };
    await store.putCompanySettings(settings);
    const loaded = await store.getCompanySettings();
    assert.equal(loaded?.organizationName, "Test AB");
    assert.equal(loaded?.organizationNumber, "556677-8899");
    assert.equal(loaded?.profile.currency, "EUR");
    assert.equal(loaded?.profile.fiscalYearStart, "07-01");
  } finally {
    await client`delete from ledger.organization_settings where organization_id = ${orgId}`;
    await closePostgresClient(client);
  }
});

test("PostgresLedgerStore.getCompanySettings normalizes legacy jsonb rows without a profile", { skip }, async () => {
  if (!databaseUrl) return;
  const orgId = `org_test_${Date.now().toString(36)}`;
  const wsId = `ws_${Math.random().toString(36).slice(2, 8)}`;
  const client = createPostgresClient({ connectionString: databaseUrl });
  try {
    const store = new PostgresLedgerStore(client, { organizationId: orgId, workspaceId: wsId });
    const legacyJson = {
      organizationId: orgId,
      organizationName: "Legacy AB",
      organizationNumber: "556677-8899",
      addressLine1: "Kungsgatan 1",
      postalCode: "111 22",
      city: "Stockholm",
      contactEmail: "legacy@example.com",
    };
    await client`
      insert into ledger.organization_settings (organization_id, settings, updated_by)
      values (${orgId}, ${client.json(legacyJson as never)}, ${orgId})
    `;
    const loaded = await store.getCompanySettings();
    assert.deepEqual(loaded?.profile, { country: "SE", locale: "sv-SE", currency: "SEK", fiscalYearStart: "01-01" });
  } finally {
    await client`delete from ledger.organization_settings where organization_id = ${orgId}`;
    await closePostgresClient(client);
  }
});
