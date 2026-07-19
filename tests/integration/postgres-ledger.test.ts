import assert from "node:assert/strict";
import test from "node:test";

import type { ExtractionResult, ReportPack } from "@jpx-accounting/contracts";
import {
  buildEventHash,
  deriveDeterministicExtraction,
  InvalidPeriodTokenError,
  InvalidReviewEditError,
  legacyDjb2EventHash,
  MemoryLedgerStore,
  parseSie,
  ReviewNotFoundError,
  SHA256_EVENT_HASH_PATTERN,
  summarizeEventIntegrity,
  today,
} from "@jpx-accounting/domain";
import { closePostgresClient, createPostgresClient, PostgresLedgerStore } from "@jpx-accounting/persistence-postgres";

// Integration test: gated on `SUPABASE_DB_URL`. Skips silently when not set so CI without a live DB
// still passes. Requires migrations 0001–0007 applied in order — see scripts/integration-db.md for
// the exact docker + psql + run commands (pgvector/pgvector:pg17 container on port 54329).

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

test("migration 0005: ledger.events.id is text and created_at orders same-transaction batches", { skip }, async () => {
  if (!databaseUrl) return;
  const orgId = `org_test_${Date.now().toString(36)}`;
  const wsId = `ws_${Math.random().toString(36).slice(2, 8)}`;
  const client = createPostgresClient({ connectionString: databaseUrl });
  try {
    // Schema pin: 0001 shipped id as `uuid default gen_random_uuid()`, which
    // rejected every `createId('evt')` insert with 22P02. 0005 aligns it.
    const idColumn = await client<Array<{ data_type: string; column_default: string | null }>>`
      SELECT data_type, column_default FROM information_schema.columns
      WHERE table_schema = 'ledger' AND table_name = 'events' AND column_name = 'id'
    `;
    assert.equal(idColumn[0]?.data_type, "text", "ledger.events.id must be text (migration 0005)");
    assert.equal(idColumn[0]?.column_default, null, "uuid default must be dropped (migration 0005)");

    // Schema pin: created_at must default to clock_timestamp() — now() is
    // frozen per transaction, which left same-transaction event batches with
    // tied (occurred_at, created_at) and made getEvents ordering and the
    // lockWorkspaceTail hash-chain tail pick nondeterministic.
    const createdAtColumn = await client<Array<{ column_default: string | null }>>`
      SELECT column_default FROM information_schema.columns
      WHERE table_schema = 'ledger' AND table_name = 'events' AND column_name = 'created_at'
    `;
    assert.match(
      createdAtColumn[0]?.column_default ?? "",
      /clock_timestamp\(\)/,
      "created_at must default to clock_timestamp() (migration 0005)",
    );

    // Behavior pin: one createEvidence transaction appends four events whose
    // text ids insert cleanly and whose created_at values are strictly
    // increasing in insertion order.
    const store = new PostgresLedgerStore(client, { organizationId: orgId, workspaceId: wsId });
    await store.createEvidence({
      organizationId: orgId,
      workspaceId: wsId,
      actorId: "user_test",
      title: "Events id/order regression",
      originalFilename: "events-id.pdf",
      mimeType: "application/pdf",
      modalities: ["pdf"],
    });

    // Microsecond epoch (float8 is exact out to ~2^53, far beyond µs epochs) —
    // JS Date would truncate clock_timestamp()'s µs resolution to ms and flake.
    const rows = await client<Array<{ id: string; event_type: string; epoch_us: number }>>`
      SELECT id, event_type, (extract(epoch from created_at) * 1e6)::float8 AS epoch_us
      FROM ledger.events
      WHERE organization_id = ${orgId} AND workspace_id = ${wsId}
      ORDER BY created_at ASC
    `;
    assert.equal(rows.length, 4);
    assert.ok(
      rows.every((row) => row.id.startsWith("evt_")),
      "createId('evt') text ids must round-trip",
    );
    assert.deepEqual(
      rows.map((row) => row.event_type),
      ["EvidenceReceived", "FieldsExtracted", "VoucherCreated", "SuggestionGenerated"],
      "created_at must reproduce insertion order within one transaction",
    );
    for (let i = 1; i < rows.length; i += 1) {
      const previous = rows[i - 1];
      const current = rows[i];
      assert.ok(
        previous !== undefined && current !== undefined && current.epoch_us > previous.epoch_us,
        "created_at strictly increases across the batch",
      );
    }
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
  "WS-D R19: createEvidence dedupes identical (workspace, sha256, sizeBytes), appends nothing, and survives a concurrent race",
  { skip },
  async () => {
    if (!databaseUrl) return;
    const orgId = `org_test_${Date.now().toString(36)}`;
    const wsId = `ws_${Math.random().toString(36).slice(2, 8)}`;
    const client = createPostgresClient({ connectionString: databaseUrl });
    const racerClient = createPostgresClient({ connectionString: databaseUrl });
    try {
      const store = new PostgresLedgerStore(client, { organizationId: orgId, workspaceId: wsId });
      const dedupeInput = () => ({
        organizationId: orgId,
        workspaceId: wsId,
        actorId: "user_test",
        title: "Dedupe receipt",
        originalFilename: "dedupe-receipt.jpg",
        mimeType: "image/jpeg",
        modalities: ["upload" as const],
        sizeBytes: 2048,
        sha256: "ef".repeat(32),
      });

      const first = await store.createEvidence(dedupeInput());
      assert.equal(first.deduped, undefined, "a genuine create must not carry the deduped marker");

      // A deliberate re-upload of the same file is the same evidence — draft-level
      // fields (title, modality) don't matter, only the content tuple.
      const second = await store.createEvidence({
        ...dedupeInput(),
        title: "Dedupe receipt (retried)",
        modalities: ["share" as const],
      });
      assert.equal(second.deduped, true);
      assert.equal(second.evidence.id, first.evidence.id, "dedup hit must return the FIRST evidence id");
      assert.equal(second.voucherId, first.voucherId);
      assert.equal(second.packet.id, first.packet.id);
      assert.equal(second.review.id, first.review.id);
      assert.equal(second.evidence.title, "Dedupe receipt", "the existing evidence is returned unmodified");

      const eventsAfterDedupe = await store.getEvents();
      assert.equal(eventsAfterDedupe.length, 4, "a dedup hit must append NO events — chain stays clean");

      // Concurrent race on two real connections (the WS-D item's actual bug): the
      // advisory lock serializes the appenders, so exactly one creates and the
      // blocked racer sees the committed row and dedupes.
      const racerStore = new PostgresLedgerStore(racerClient, { organizationId: orgId, workspaceId: wsId });
      const raceInput = () => ({ ...dedupeInput(), sha256: "ab12".repeat(16), sizeBytes: 4096 });
      const [left, right] = await Promise.all([
        store.createEvidence(raceInput()),
        racerStore.createEvidence(raceInput()),
      ]);
      assert.equal(left.evidence.id, right.evidence.id, "both racers must land on ONE evidence row");
      assert.equal(
        [left, right].filter((r) => r.deduped === true).length,
        1,
        "exactly one racer dedupes, the other creates",
      );
      const evidenceRows = await client<Array<{ count: string }>>`
        SELECT COUNT(*)::text AS count FROM ledger.evidence_objects
        WHERE organization_id = ${orgId} AND workspace_id = ${wsId}
      `;
      assert.equal(evidenceRows[0]?.count, "2", "one row per distinct content tuple");
      assert.equal((await store.getEvents()).length, 8, "four events per genuine create, none for dedup hits");

      // Memory parity (CONVENTIONS Rule 11): same duplicate input, same idempotent answer.
      const memory = new MemoryLedgerStore();
      const memInput = { ...dedupeInput(), organizationId: "org_jpx", workspaceId: "workspace_main" };
      const memFirst = await memory.createEvidence(memInput);
      const memSecond = await memory.createEvidence(memInput);
      assert.equal(memFirst.deduped, undefined);
      assert.equal(memSecond.deduped, true);
      assert.equal(memSecond.evidence.id, memFirst.evidence.id);

      // Migration 0008 schema pin: the dedupe lookup must be indexed, not a seq scan.
      const indexRows = await client<Array<{ indexname: string }>>`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'ledger' AND tablename = 'evidence_objects'
          AND indexname = 'ledger_evidence_objects_dedupe_idx'
      `;
      assert.equal(indexRows.length, 1, "migration 0008 dedupe index must exist");
    } finally {
      await client`delete from ledger.events where organization_id = ${orgId}`;
      await client`delete from ledger.review_tasks where organization_id = ${orgId}`;
      await client`delete from ledger.vouchers where organization_id = ${orgId}`;
      await client`delete from ledger.evidence_packet_items
        where evidence_packet_id in (select id from ledger.evidence_packets where organization_id = ${orgId})`;
      await client`delete from ledger.evidence_packets where organization_id = ${orgId}`;
      await client`delete from ledger.evidence_objects where organization_id = ${orgId}`;
      await closePostgresClient(racerClient);
      await closePostgresClient(client);
    }
  },
);

test("WS-D R19: createEvidence never dedupes across workspaces and skips dedupe without sha256", { skip }, async () => {
  if (!databaseUrl) return;
  const orgId = `org_test_${Date.now().toString(36)}`;
  const wsA = `ws_${Math.random().toString(36).slice(2, 8)}`;
  const wsB = `ws_${Math.random().toString(36).slice(2, 8)}`;
  const client = createPostgresClient({ connectionString: databaseUrl });
  try {
    const storeA = new PostgresLedgerStore(client, { organizationId: orgId, workspaceId: wsA });
    const storeB = new PostgresLedgerStore(client, { organizationId: orgId, workspaceId: wsB });
    const fileInput = (workspaceId: string) => ({
      organizationId: orgId,
      workspaceId,
      actorId: "user_test",
      title: "Tenant-scoped receipt",
      originalFilename: "tenant-receipt.jpg",
      mimeType: "image/jpeg",
      modalities: ["upload" as const],
      sizeBytes: 1024,
      sha256: "0123".repeat(16),
    });

    // Same file, two workspaces: dedupe must NOT cross the tenant boundary.
    const inA = await storeA.createEvidence(fileInput(wsA));
    const inB = await storeB.createEvidence(fileInput(wsB));
    assert.equal(inB.deduped, undefined, "cross-workspace create must be genuine");
    assert.notEqual(inB.evidence.id, inA.evidence.id);
    assert.equal((await storeB.getEvents()).length, 4, "the second workspace gets its own four-event create chain");

    // Missing sha256 (legacy callers): identical metadata still creates every time.
    const legacyInput = () => {
      const { sha256: _sha256, ...rest } = fileInput(wsA);
      return rest;
    };
    const legacyFirst = await storeA.createEvidence(legacyInput());
    const legacySecond = await storeA.createEvidence(legacyInput());
    assert.equal(legacySecond.deduped, undefined);
    assert.notEqual(legacySecond.evidence.id, legacyFirst.evidence.id, "hash-less creates must never collapse");
    assert.equal((await storeA.getEvents()).length, 12, "three genuine creates in workspace A");
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

test(
  "PostgresLedgerStore.applyReviewDecision honors edits append-only + PostedToLedger lines parity",
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
        title: "Edited approval receipt",
        originalFilename: "edited-approval.jpg",
        mimeType: "image/jpeg",
        modalities: ["camera" as const],
      };
      const created = await store.createEvidence({ ...baseInput, organizationId: orgId, workspaceId: wsId });
      assert.equal(created.voucher.voucherFields.grossAmount, 1249, "legacy create precondition");

      // Inconsistent amounts → InvalidReviewEditError, transaction rolled back.
      await assert.rejects(
        () =>
          store.applyReviewDecision(created.review.id, "approve", {
            actorId: "user_test",
            edited: {
              accountNumber: "6110",
              accountName: "Kontorsmateriel",
              vatCode: "VAT25",
              grossAmount: 500,
              netAmount: 400,
              vatAmount: 50,
            },
          }),
        (error) => error instanceof InvalidReviewEditError,
      );
      const stillPending = await store.findReviewByVoucher(created.voucher.id);
      assert.equal(stillPending?.status, "needs-review", "failed edit must leave the review decidable");

      const journalBefore = (await store.getReports()).journal.length;
      const edited = {
        accountNumber: "6110",
        accountName: "Kontorsmateriel",
        vatCode: "VAT25",
        grossAmount: 500,
        netAmount: 400,
        vatAmount: 100,
      };
      const decided = await store.applyReviewDecision(created.review.id, "approve", {
        actorId: "user_test",
        edited,
      });
      assert.equal(decided?.status, "approved");
      assert.equal(decided.suggestion?.accountNumber, "6110", "review read model carries the edited suggestion");
      assert.equal(decided.provenanceTimeline.at(-1)?.label, "Approved with edits");

      // Posted lines use the edited account/amounts; replayed through getReports.
      const journal = (await store.getReports()).journal;
      assert.equal(journal.length, journalBefore + 3);
      const [expense, vat, bank] = journal.slice(-3);
      assert.equal(expense?.accountNumber, "6110");
      assert.equal(expense?.debit, 400);
      assert.equal(vat?.debit, 100);
      assert.equal(bank?.credit, 500);

      // Append-only: the stored voucher row keeps its original amounts.
      const voucherRows = await client<Array<{ voucher_fields: { grossAmount?: number } }>>`
        SELECT voucher_fields FROM ledger.vouchers WHERE id = ${created.voucher.id}
      `;
      assert.equal(voucherRows[0]?.voucher_fields.grossAmount, 1249, "voucher row not rewritten by the edit");

      // Events: ReviewApproved carries the edit; PostedToLedger carries lines.
      const events = await store.getEvents();
      const approvedEvt = events.find((event) => event.eventType === "ReviewApproved");
      assert.deepEqual(approvedEvt?.payload.edited, edited);
      const postedEvt = events.find((event) => event.eventType === "PostedToLedger");
      const postedLines = postedEvt?.payload.lines as Array<{ accountNumber: string; debit: number; credit: number }>;
      assert.ok(Array.isArray(postedLines) && postedLines.length === 3, "PostedToLedger payload must include lines");

      // Memory/Postgres parity (CONVENTIONS Rule 11): same decision on Memory
      // produces identical posted-line economics and event payload shape.
      const memory = new MemoryLedgerStore();
      const memCreated = await memory.createEvidence({
        ...baseInput,
        organizationId: "org_jpx",
        workspaceId: "workspace_main",
      });
      const memDecided = await memory.applyReviewDecision(memCreated.review.id, "approve", {
        actorId: "user_test",
        edited,
      });
      assert.equal(memDecided?.suggestion?.accountNumber, decided.suggestion?.accountNumber);
      assert.equal(memDecided?.provenanceTimeline.at(-1)?.label, decided.provenanceTimeline.at(-1)?.label);
      const memPostedEvt = (await memory.getEvents()).find((event) => event.eventType === "PostedToLedger");
      const memLines = memPostedEvt?.payload.lines as Array<Record<string, unknown>>;
      assert.ok(Array.isArray(memLines) && memLines.length === 3, "Memory PostedToLedger payload must include lines");
      const stable = (lines: Array<Record<string, unknown>>) =>
        lines.map((line) => [line.accountNumber, line.debit, line.credit, line.vatCode, line.deductible]);
      assert.deepEqual(
        stable(postedLines as unknown as Array<Record<string, unknown>>),
        stable(memLines),
        "PostedToLedger payload lines parity",
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
  },
);

test(
  "PostgresLedgerStore R13: postings dated by the voucher transaction date; edited bookedAt round-trips; Memory parity",
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
        title: "R13 prior-month receipt",
        originalFilename: "r13-prior-month.jpg",
        mimeType: "image/jpeg",
        modalities: ["camera" as const],
      };
      const marchExtraction = {
        modelId: "stub-test",
        extractedAt: new Date().toISOString(),
        fields: [
          { key: "receiptDate", label: "Receipt date", value: "2026-03-15", confidence: 0.97, required: true },
          { key: "transactionDate", label: "Transaction date", value: "2026-03-15", confidence: 0.9, required: false },
        ],
      };

      // --- Derived path: prior-month transaction date wins over the approval click.
      const created = await store.createEvidence({ ...baseInput, organizationId: orgId, workspaceId: wsId });
      const refreshed = await store.updateEvidenceExtraction(created.evidence.id, marchExtraction);
      assert.equal(refreshed?.voucher?.voucherFields.transactionDate, "2026-03-15", "refresh precondition");

      const beforeDecision = Date.now();
      const decided = await store.applyReviewDecision(created.review.id, "approve", { actorId: "user_test" });
      assert.equal(decided?.status, "approved");

      const march = await store.getReports({ from: "2026-03-01", to: "2026-03-31" });
      assert.equal(march.journal.length, 3, "expense + input VAT + bank land in the March window");
      for (const entry of march.journal) {
        assert.equal(entry.bookedAt, "2026-03-15");
      }
      assert.ok(
        march.vat.some((entry) => entry.vatCode === "VAT25" && entry.vatAmount > 0),
        "input VAT is claimed in the March VAT window",
      );

      // Audit trail unchanged: the decision events keep decision-time occurredAt.
      const events = await store.getEvents();
      const postedEvt = events.find((event) => event.eventType === "PostedToLedger");
      assert.ok(postedEvt, "PostedToLedger event present");
      assert.ok(
        Date.parse(postedEvt.occurredAt) >= beforeDecision - 5000,
        "PostedToLedger occurredAt stays at decision time, not the accounting date",
      );
      const postedLines = postedEvt.payload.lines as Array<Record<string, unknown>>;
      assert.ok(Array.isArray(postedLines) && postedLines.length === 3);
      for (const line of postedLines) {
        assert.equal(line.bookedAt, "2026-03-15", "event payload lines carry the accounting date (replay truth)");
      }

      // --- Edited override path: bookedAt round-trips through store + events.
      const created2 = await store.createEvidence({
        ...baseInput,
        organizationId: orgId,
        workspaceId: wsId,
        title: "R13 edited booking date",
        originalFilename: "r13-edited.jpg",
      });
      const edited = {
        accountNumber: "6110",
        accountName: "Kontorsmateriel",
        vatCode: "VAT25",
        bookedAt: "2026-04-02",
      };
      const decided2 = await store.applyReviewDecision(created2.review.id, "approve", { actorId: "user_test", edited });
      assert.equal(decided2?.status, "approved");
      const april = await store.getReports({ from: "2026-04-01", to: "2026-04-30" });
      assert.equal(april.journal.length, 3, "edited bookedAt buckets the posting into April");
      for (const entry of april.journal) {
        assert.equal(entry.bookedAt, "2026-04-02");
      }
      const approvedEvt2 = (await store.getEvents()).find(
        (event) => event.eventType === "ReviewApproved" && event.aggregateId === created2.review.id,
      );
      assert.deepEqual(approvedEvt2?.payload.edited, edited, "edited bookedAt recorded on the decision event");

      // --- Future bookedAt rejected before any mutation (transaction rolled back).
      const created3 = await store.createEvidence({
        ...baseInput,
        organizationId: orgId,
        workspaceId: wsId,
        title: "R13 future booking date",
        originalFilename: "r13-future.jpg",
      });
      // +2 days: the server allows ONE day of slack for client/server timezone
      // skew (resolveReviewDecisionEdit), so rejection starts at day-after-tomorrow.
      const tomorrowDate = new Date();
      tomorrowDate.setDate(tomorrowDate.getDate() + 2);
      const pad2 = (value: number) => String(value).padStart(2, "0");
      const tomorrow = `${tomorrowDate.getFullYear()}-${pad2(tomorrowDate.getMonth() + 1)}-${pad2(tomorrowDate.getDate())}`;
      await assert.rejects(
        () =>
          store.applyReviewDecision(created3.review.id, "approve", {
            actorId: "user_test",
            edited: { ...edited, bookedAt: tomorrow },
          }),
        (error) => error instanceof InvalidReviewEditError,
      );
      assert.equal(
        (await store.findReviewByVoucher(created3.voucher.id))?.status,
        "needs-review",
        "rejected future bookedAt leaves the review decidable",
      );

      // --- Memory parity (CONVENTIONS Rule 11): identical derived flow posts
      // identical line economics AND accounting dates.
      const memory = new MemoryLedgerStore();
      const memCreated = await memory.createEvidence({
        ...baseInput,
        organizationId: "org_jpx",
        workspaceId: "workspace_main",
      });
      await memory.updateEvidenceExtraction(memCreated.evidence.id, marchExtraction);
      await memory.applyReviewDecision(memCreated.review.id, "approve", { actorId: "user_test" });
      const memPostedEvt = (await memory.getEvents()).find((event) => event.eventType === "PostedToLedger");
      const memLines = memPostedEvt?.payload.lines as Array<Record<string, unknown>>;
      assert.ok(Array.isArray(memLines) && memLines.length === 3);
      const stableWithDate = (lines: Array<Record<string, unknown>>) =>
        lines.map((line) => [line.accountNumber, line.debit, line.credit, line.vatCode, line.bookedAt]);
      assert.deepEqual(stableWithDate(postedLines), stableWithDate(memLines), "bookedAt derivation parity");
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

test(
  "PostgresLedgerStore.importSie appends VoucherImported events, replays into reports + Memory parity",
  { skip },
  async () => {
    if (!databaseUrl) return;
    const orgId = `org_test_${Date.now().toString(36)}`;
    const wsId = `ws_${Math.random().toString(36).slice(2, 8)}`;
    const client = createPostgresClient({ connectionString: databaseUrl });
    try {
      const store = new PostgresLedgerStore(client, { organizationId: orgId, workspaceId: wsId });

      const sieText = [
        "#SIETYP 4",
        '#KONTO 6110 "Kontorsmateriel"',
        '#VER A 42 20260315 "Inköpta pärmar"',
        "{",
        "#TRANS 6110 {} 100.00",
        "#TRANS 1930 {} -100.00",
        "}",
        '#VER A 43 20260316 "Obalanserad"',
        "{",
        "#TRANS 6110 {} 50.00",
        "#TRANS 1930 {} -49.00",
        "}",
      ].join("\n");
      const file = parseSie(sieText);

      const journalBefore = (await store.getReports()).journal.length;
      const result = await store.importSie({ actorId: "user_test", file });
      assert.deepEqual(result, {
        accepted: true,
        importedVouchers: 1,
        importedTransactions: 2,
        skipped: [{ reference: "A 43", reason: "unbalanced" }],
      });

      // getReports replay widened to VoucherImported: the lines appear in the journal.
      const journal = (await store.getReports()).journal;
      assert.equal(journal.length, journalBefore + 2);
      const [expense, bank] = journal.slice(-2);
      assert.equal(expense?.accountNumber, "6110");
      assert.equal(expense?.debit, 100);
      assert.equal(bank?.accountNumber, "1930");
      assert.equal(bank?.credit, 100);

      // One hash-chained VoucherImported event with the replay lines in the payload.
      const events = await store.getEvents();
      const importedEvt = events.at(-1);
      assert.equal(importedEvt?.eventType, "VoucherImported");
      assert.equal(importedEvt?.aggregateId, "sie_A_42");
      assert.equal(importedEvt?.actorId, "user_test");
      const payloadLines = (importedEvt?.payload as { lines?: unknown[] }).lines;
      assert.ok(Array.isArray(payloadLines) && payloadLines.length === 2);

      // Idempotency: re-import skips both vouchers (duplicate + unbalanced).
      const replay = await store.importSie({ actorId: "user_test", file });
      assert.equal(replay.importedVouchers, 0);
      assert.equal(replay.importedTransactions, 0);
      assert.ok(replay.skipped.some((entry) => entry.reference === "A 42" && entry.reason === "duplicate"));
      assert.equal((await store.getReports()).journal.length, journalBefore + 2, "no duplicate lines");

      // Memory/Postgres parity (CONVENTIONS Rule 11): identical result + tail lines.
      const memory = new MemoryLedgerStore();
      const memResult = await memory.importSie({ actorId: "user_test", file });
      assert.deepEqual(memResult, result);
      const memJournal = (await memory.getReports()).journal;
      const stable = (entries: typeof journal) =>
        entries
          .slice(-2)
          .map((entry) => [entry.accountNumber, entry.accountName, entry.debit, entry.credit, entry.bookedAt]);
      assert.deepEqual(stable(journal), stable(memJournal));
    } finally {
      await client`delete from ledger.events where organization_id = ${orgId}`;
      await closePostgresClient(client);
    }
  },
);

test(
  "PostgresLedgerStore.getReports(range) windows + getReportPack parity with Memory (modulo generatedAt)",
  { skip },
  async () => {
    if (!databaseUrl) return;
    const orgId = `org_test_${Date.now().toString(36)}`;
    const wsId = `ws_${Math.random().toString(36).slice(2, 8)}`;
    const client = createPostgresClient({ connectionString: databaseUrl });
    try {
      const store = new PostgresLedgerStore(client, { organizationId: orgId, workspaceId: wsId });
      const memory = new MemoryLedgerStore();

      // The fixture is pinned to 2026-03-15 while seed lines are booked "now"
      // — a permanent out-of-current-period voucher (Phase 4 finding 8).
      const file = parseSie(
        [
          "#SIETYP 4",
          '#KONTO 6110 "Kontorsmateriel"',
          '#VER A 42 20260315 "Inköpta pärmar"',
          "{",
          "#TRANS 6110 {} 100.00",
          "#TRANS 1930 {} -100.00",
          "}",
        ].join("\n"),
      );
      await store.importSie({ actorId: "user_test", file });
      await memory.importSie({ actorId: "user_test", file });

      // Range windows replay through the shared collectLedgerLines path.
      const march = await store.getReports({ from: "2026-03-01", to: "2026-03-31" });
      assert.deepEqual(
        march.journal.map((entry) => [entry.accountNumber, entry.debit, entry.credit, entry.bookedAt]),
        [
          ["6110", 100, 0, "2026-03-15"],
          ["1930", 0, 100, "2026-03-15"],
        ],
      );
      assert.equal((await store.getReports({ from: "2026-04-01", to: "2026-04-30" })).journal.length, 0);
      const unfiltered = await store.getReports();
      assert.equal(unfiltered.journal.length, 5, "no-arg getReports stays unfiltered (3 seed + 2 imported)");

      // Pack parity: the two stores must build the SAME pack for the same
      // period, modulo the generatedAt timestamp (CONVENTIONS Rules 6, 11).
      const withoutGeneratedAt = ({ generatedAt: _generatedAt, ...rest }: ReportPack) => rest;
      const pgPack = await store.getReportPack({ period: "2026-03" });
      const memPack = await memory.getReportPack({ period: "2026-03" });
      assert.deepEqual(withoutGeneratedAt(pgPack), withoutGeneratedAt(memPack), "ReportPack parity Memory vs Postgres");
      assert.equal(pgPack.profitLoss.periodResult, -100);

      // Both stores propagate unknown tokens identically (→ HTTP 422).
      await assert.rejects(
        () => store.getReportPack({ period: "bogus" }),
        (error) => error instanceof InvalidPeriodTokenError,
      );
    } finally {
      await client`delete from ledger.events where organization_id = ${orgId}`;
      await closePostgresClient(client);
    }
  },
);

test("PostgresLedgerStore.getSnapshot exposes org/workspace-scoped packets + Memory parity", { skip }, async () => {
  if (!databaseUrl) return;
  const orgId = `org_test_${Date.now().toString(36)}`;
  const wsId = `ws_${Math.random().toString(36).slice(2, 8)}`;
  const client = createPostgresClient({ connectionString: databaseUrl });
  try {
    const store = new PostgresLedgerStore(client, { organizationId: orgId, workspaceId: wsId });

    const baseInput = {
      actorId: "user_test",
      title: "Packet snapshot receipt",
      originalFilename: "packet-snapshot.jpg",
      mimeType: "image/jpeg",
      modalities: ["camera" as const],
    };
    const created = await store.createEvidence({ ...baseInput, organizationId: orgId, workspaceId: wsId });
    const composed = await store.composeEvidence({
      organizationId: orgId,
      workspaceId: wsId,
      actorId: "user_test",
      evidenceIds: [created.evidence.id],
      note: "Bundled for the drill join",
    });

    const snapshot = await store.getSnapshot();
    // Exactly the two packets of THIS workspace — rows from other orgs (or
    // other tests) must not leak into the snapshot.
    assert.equal(snapshot.packets.length, 2, "create + compose packets, org/workspace-scoped");
    const createdPacket = snapshot.packets.find((packet) => packet.id === created.packet.id);
    assert.deepEqual(createdPacket?.evidenceIds, [created.evidence.id]);
    const composedPacket = snapshot.packets.find((packet) => packet.id === composed.id);
    assert.deepEqual(composedPacket?.evidenceIds, [created.evidence.id]);
    assert.equal(composedPacket?.note, "Bundled for the drill join");

    // After composeEvidence relink (§A N9), the voucher points at the newest packet.
    const voucher = snapshot.vouchers.find((candidate) => candidate.id === created.voucher.id);
    assert.ok(voucher);
    assert.equal(voucher.evidencePacketId, composed.id, "composeEvidence must relink the voucher");
    const joined = snapshot.packets.find((packet) => packet.id === voucher.evidencePacketId);
    assert.deepEqual(joined?.evidenceIds, [created.evidence.id]);
    assert.equal(joined?.id, composed.id);

    // Memory parity (Rule 11): the same create resolves the same join shape.
    const memory = new MemoryLedgerStore();
    const memCreated = await memory.createEvidence({
      ...baseInput,
      organizationId: "org_jpx",
      workspaceId: "workspace_main",
    });
    const memSnapshot = await memory.getSnapshot();
    const memPacket = memSnapshot.packets.find((packet) => packet.id === memCreated.voucher.evidencePacketId);
    assert.deepEqual(memPacket?.evidenceIds, [memCreated.evidence.id]);
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
  "PostgresLedgerStore.composeEvidence relinks voucher + converges getEvidenceContext and getSnapshot (§A N9/N10)",
  { skip },
  async () => {
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
        title: "Relink target receipt",
        originalFilename: "relink.jpg",
        mimeType: "image/jpeg",
        modalities: ["camera"],
      });

      const composed = await store.composeEvidence({
        organizationId: orgId,
        workspaceId: wsId,
        actorId: "user_test",
        evidenceIds: [created.evidence.id],
        note: "Rebundled packet",
      });

      // EvidencePacket shape parity (§A N10): optional keys always present.
      assert.ok("note" in composed);
      assert.ok("voiceTranscript" in composed);
      assert.equal(composed.note, "Rebundled packet");

      const context = await store.getEvidenceContext(created.evidence.id);
      assert.equal(context?.packet?.id, composed.id, "getEvidenceContext picks newest packet");
      assert.equal(context?.voucher?.evidencePacketId, composed.id, "voucher relinked to newest packet");

      const snapshot = await store.getSnapshot();
      const snapshotVoucher = snapshot.vouchers.find((candidate) => candidate.id === created.voucher.id);
      assert.equal(snapshotVoucher?.evidencePacketId, composed.id, "getSnapshot voucher link matches context");

      const snapshotPacket = snapshot.packets.find((packet) => packet.id === composed.id);
      assert.ok(snapshotPacket);
      assert.ok("note" in snapshotPacket);
      assert.ok("voiceTranscript" in snapshotPacket);
      assert.equal(snapshotPacket.note, "Rebundled packet");

      // WS-B B6b: the relink is chain-visible — composeEvidence appends one
      // EvidenceRelinked event on top of createEvidence's four.
      const events = await store.getEvents();
      assert.equal(events.length, 5, "composeEvidence relink appends exactly one chain event");
      const relinkEvt = events.at(-1);
      assert.equal(relinkEvt?.eventType, "EvidenceRelinked");
      assert.equal(relinkEvt?.aggregateType, "voucher");
      assert.equal(relinkEvt?.aggregateId, created.voucher.id);
      assert.equal(relinkEvt?.actorId, "user_test");
      assert.equal(relinkEvt?.payload.packetId, composed.id);
      assert.equal(relinkEvt?.payload.previousPacketId, created.packet.id);
      assert.deepEqual(relinkEvt?.payload.evidenceIds, [created.evidence.id]);
      // The relink event chains onto the prior tail (linkage intact).
      assert.equal(relinkEvt?.previousHash, events.at(-2)?.eventHash, "EvidenceRelinked chains onto the tail");

      // Memory parity (Rule 11): same flow appends the same event shape.
      const memory = new MemoryLedgerStore();
      const memCreated = await memory.createEvidence({
        organizationId: "org_jpx",
        workspaceId: "workspace_main",
        actorId: "user_test",
        title: "Relink target receipt",
        originalFilename: "relink.jpg",
        mimeType: "image/jpeg",
        modalities: ["camera"],
      });
      const memComposed = await memory.composeEvidence({
        organizationId: "org_jpx",
        workspaceId: "workspace_main",
        actorId: "user_test",
        evidenceIds: [memCreated.evidence.id],
        note: "Rebundled packet",
      });
      const memRelinkEvt = (await memory.getEvents()).at(-1);
      assert.equal(memRelinkEvt?.eventType, "EvidenceRelinked");
      assert.equal(memRelinkEvt?.aggregateId, memCreated.voucher.id);
      assert.equal(memRelinkEvt?.payload.packetId, memComposed.id);
      assert.deepEqual(Object.keys(memRelinkEvt?.payload ?? {}).sort(), Object.keys(relinkEvt?.payload ?? {}).sort());
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

test("PostgresLedgerStore.getSnapshot sources alerts from compliance_alerts (§2.2)", { skip }, async () => {
  if (!databaseUrl) return;
  const orgId = `org_test_${Date.now().toString(36)}`;
  const wsId = `ws_${Math.random().toString(36).slice(2, 8)}`;
  const client = createPostgresClient({ connectionString: databaseUrl });
  try {
    const store = new PostgresLedgerStore(client, { organizationId: orgId, workspaceId: wsId });

    const emptySnapshot = await store.getSnapshot();
    assert.deepEqual(emptySnapshot.alerts, []);
    assert.deepEqual(emptySnapshot.assistantExamples, []);

    const refreshed = await store.refreshComplianceAlerts();
    const snapshot = await store.getSnapshot();
    assert.deepEqual(
      snapshot.alerts.map((alert) => alert.id).sort(),
      refreshed.map((alert) => alert.id).sort(),
      "getSnapshot alerts must mirror compliance_alerts table",
    );
    assert.deepEqual(snapshot.assistantExamples, [], "assistantExamples stays empty until a read model lands");
  } finally {
    await client`delete from ledger.compliance_alerts where organization_id = ${orgId}`;
    await closePostgresClient(client);
  }
});

test("PostgresLedgerStore.getReviewFeed orders by created_at DESC, id DESC (§A N12)", { skip }, async () => {
  if (!databaseUrl) return;
  const orgId = `org_test_${Date.now().toString(36)}`;
  const wsId = `ws_${Math.random().toString(36).slice(2, 8)}`;
  const client = createPostgresClient({ connectionString: databaseUrl });
  try {
    const store = new PostgresLedgerStore(client, { organizationId: orgId, workspaceId: wsId });

    const first = await store.createEvidence({
      organizationId: orgId,
      workspaceId: wsId,
      actorId: "user_test",
      title: "First in feed",
      originalFilename: "first.jpg",
      mimeType: "image/jpeg",
      modalities: ["camera"],
    });
    const second = await store.createEvidence({
      organizationId: orgId,
      workspaceId: wsId,
      actorId: "user_test",
      title: "Second in feed",
      originalFilename: "second.jpg",
      mimeType: "image/jpeg",
      modalities: ["camera"],
    });

    const feed = await store.getReviewFeed();
    assert.equal(feed.length, 2);
    assert.equal(feed[0]?.id, second.review.id, "newest review first");
    assert.equal(feed[1]?.id, first.review.id);
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
      profile: {
        country: "SE" as const,
        locale: "en-GB",
        currency: "EUR",
        fiscalYearStart: "07-01",
        vatPeriod: "quarterly" as const,
      },
      aiPosture: { advisorEnabled: true, suggestionsEnabled: true },
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
    assert.deepEqual(loaded?.profile, {
      country: "SE",
      locale: "sv-SE",
      currency: "SEK",
      fiscalYearStart: "01-01",
      vatPeriod: "quarterly",
    });
  } finally {
    await client`delete from ledger.organization_settings where organization_id = ${orgId}`;
    await closePostgresClient(client);
  }
});

test(
  "PostgresLedgerStore.getCloseRun returns the honest empty shell: close_unavailable, real local month, empty checklist + Memory parity",
  { skip },
  async () => {
    if (!databaseUrl) return;
    const orgId = `org_test_${Date.now().toString(36)}`;
    const wsId = `ws_${Math.random().toString(36).slice(2, 8)}`;
    const client = createPostgresClient({ connectionString: databaseUrl });
    try {
      const store = new PostgresLedgerStore(client, { organizationId: orgId, workspaceId: wsId });
      const closeRun = await store.getCloseRun();

      assert.equal(closeRun.id, "close_unavailable");
      assert.deepEqual(closeRun.checklist, [], "no synthetic checklist items");

      // Independently derive the expected `YYYY-MM` from LOCAL calendar parts
      // rather than exercising the same helper the store uses under the hood.
      const now = new Date();
      const expectedPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      assert.equal(closeRun.period, expectedPeriod);

      // Memory/Postgres parity (CONVENTIONS Rule 11), modulo generatedAt.
      const memory = new MemoryLedgerStore();
      const memCloseRun = await memory.getCloseRun();
      assert.equal(memCloseRun.id, closeRun.id);
      assert.equal(memCloseRun.period, closeRun.period);
      assert.deepEqual(memCloseRun.checklist, closeRun.checklist);
    } finally {
      await closePostgresClient(client);
    }
  },
);

// ---------------------------------------------------------------------------
// WS-B R14: SHA-256 hash chain over canonical JSON against the real DB
// ---------------------------------------------------------------------------

test("R14: appended events carry SHA-256 hashes that recompute from the stored jsonb payloads", { skip }, async () => {
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
      title: "Hash-chain integration invoice",
      originalFilename: "hash-chain.pdf",
      mimeType: "application/pdf",
      modalities: ["pdf", "upload"],
      extractedText: "Hash chain canonical serialization check 1 250,75 kr",
    });
    await store.applyReviewDecision(created.review.id, "approve", { actorId: "user_test" });

    const events = await store.getEvents();
    assert.ok(events.length >= 5, "createEvidence + approval should append at least five events");

    // Every post-cutover hash is SHA-256-format, and the domain buildEventHash
    // reproduces each stored hash from the jsonb-round-tripped payload — the
    // cross-store parity seam (both stores import buildEventHash from domain)
    // and the kill-shot for the old jsonb-key-order recompute blocker.
    for (const event of events) {
      assert.match(event.eventHash, SHA256_EVENT_HASH_PATTERN);
      assert.equal(
        buildEventHash(event.previousHash, event.payload),
        event.eventHash,
        `recomputed hash must match the stored hash for ${event.eventType}`,
      );
    }

    const summary = summarizeEventIntegrity(events, { verifiedAt: new Date().toISOString(), verifyPayloads: true });
    assert.equal(summary.chainLinked, true);
    assert.equal(summary.payloadVerified, true);
    assert.equal(summary.payloadMismatchCount, 0);
    assert.equal(summary.recomputedEventCount, events.length);
    assert.equal(summary.legacyEventCount, 0);
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

test("R14: a legacy djb2 prefix + new SHA-256 appends verify as one mixed chain", { skip }, async () => {
  if (!databaseUrl) return;
  const orgId = `org_test_${Date.now().toString(36)}`;
  const wsId = `ws_${Math.random().toString(36).slice(2, 8)}`;
  const client = createPostgresClient({ connectionString: databaseUrl });
  try {
    // 1. Fabricate the pre-cutover state exactly as the old append path wrote
    //    it: djb2 over `previousHash + ":" + JSON.stringify(payload)`. These
    //    rows model the hosted-Supabase chains that stay djb2 forever.
    const legacyPayloads = [
      { evidenceId: "ev_legacy_1", title: "Legacy receipt" },
      { evidenceId: "ev_legacy_2", title: "Legacy invoice" },
    ];
    let previousHash = "GENESIS";
    for (let index = 0; index < legacyPayloads.length; index += 1) {
      const payload = legacyPayloads[index]!;
      const eventHash = legacyDjb2EventHash(previousHash, JSON.stringify(payload));
      const occurredAt = new Date(Date.now() - (legacyPayloads.length - index) * 60_000).toISOString();
      await client`
        INSERT INTO ledger.events (
          id, organization_id, workspace_id, aggregate_type, aggregate_id, event_type,
          actor_id, occurred_at, payload, previous_hash, event_hash, digest_date
        ) VALUES (
          ${`evt_legacy_${index + 1}_${wsId}`}, ${orgId}, ${wsId}, ${"evidence"}, ${payload.evidenceId},
          ${"EvidenceReceived"}, ${"user_test"}, ${occurredAt}, ${client.json(payload as never)},
          ${previousHash}, ${eventHash}, ${occurredAt.slice(0, 10)}
        )
      `;
      previousHash = eventHash;
    }

    // 2. New appends go through the store and MUST chain onto the djb2 tail
    //    with SHA-256 hashes (cutover: no rewrite, per-link schemes).
    const store = new PostgresLedgerStore(client, { organizationId: orgId, workspaceId: wsId });
    await store.createEvidence({
      organizationId: orgId,
      workspaceId: wsId,
      actorId: "user_test",
      title: "Post-cutover evidence",
      originalFilename: "post-cutover.pdf",
      mimeType: "application/pdf",
      modalities: ["pdf"],
    });

    const events = await store.getEvents();
    assert.equal(events.length, 2 + 4, "two legacy rows + four store-appended events");
    assert.equal(events[2]!.previousHash, previousHash, "first SHA-256 event must link onto the djb2 tail");
    assert.match(events[1]!.eventHash, /^h_[0-9a-f]{8}$/);
    assert.match(events[2]!.eventHash, SHA256_EVENT_HASH_PATTERN);

    const summary = summarizeEventIntegrity(events, { verifiedAt: new Date().toISOString(), verifyPayloads: true });
    assert.equal(summary.chainLinked, true, "mixed djb2-prefix + SHA-256-suffix chain must verify");
    assert.equal(summary.legacyEventCount, 2);
    assert.equal(summary.recomputedEventCount, 4);
    assert.equal(summary.payloadMismatchCount, 0);
    assert.equal(summary.payloadVerified, true);
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

test("R14: an in-place jsonb payload edit is invisible to linkage but flagged by recomputation", { skip }, async () => {
  if (!databaseUrl) return;
  const orgId = `org_test_${Date.now().toString(36)}`;
  const wsId = `ws_${Math.random().toString(36).slice(2, 8)}`;
  const client = createPostgresClient({ connectionString: databaseUrl });
  try {
    const store = new PostgresLedgerStore(client, { organizationId: orgId, workspaceId: wsId });
    await store.createEvidence({
      organizationId: orgId,
      workspaceId: wsId,
      actorId: "user_test",
      title: "Tamper target",
      originalFilename: "tamper.pdf",
      mimeType: "application/pdf",
      modalities: ["pdf"],
    });

    // Simulate hostile DB access: rewrite one stored payload without touching
    // any hash column (linkage cannot see this — recomputation must).
    await client`
      UPDATE ledger.events
      SET payload = payload || '{"tampered": true}'::jsonb
      WHERE organization_id = ${orgId} AND workspace_id = ${wsId} AND event_type = 'FieldsExtracted'
    `;

    const events = await store.getEvents();
    const verifiedAt = new Date().toISOString();

    const linkageOnly = summarizeEventIntegrity(events, { verifiedAt });
    assert.equal(linkageOnly.chainLinked, true, "linkage alone must NOT detect an in-place payload edit");

    const recomputed = summarizeEventIntegrity(events, { verifiedAt, verifyPayloads: true });
    assert.equal(recomputed.chainLinked, true);
    assert.equal(recomputed.payloadVerified, false, "recomputation must flag the tampered payload");
    assert.equal(recomputed.payloadMismatchCount, 1);
    assert.equal(recomputed.recomputedEventCount, events.length);
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

// ---------------------------------------------------------------------------
// WS-B R15: hash-chain forks are structurally impossible
//
// Serialization contract under test (PostgresLedgerStore + migration 0006):
//   1. every chain-appending transaction takes pg_advisory_xact_lock on the
//      workspace key BEFORE reading the tail (fixes the stale-tail re-read of
//      the old FOR UPDATE and the no-row-to-lock GENESIS hole);
//   2. UNIQUE (organization_id, workspace_id, previous_hash) turns any
//      out-of-band fork into a retryable 23505;
//   3. `seq bigint generated always as identity` is the deterministic FINAL
//      ORDER BY key on every ledger.events read.
//
// Memory-parity note (Rule 11): MemoryLedgerStore.appendEvent is fork-safe by
// construction — its tail read (`events.at(-1)`) and push are synchronous with
// no await between them, so a single-threaded runtime cannot interleave two
// appends. These tests pin the Postgres side to that same linearity.
// ---------------------------------------------------------------------------

test("R15: migration 0006 schema pins — seq identity, fork-guard constraint, seq index", { skip }, async () => {
  if (!databaseUrl) return;
  const client = createPostgresClient({ connectionString: databaseUrl });
  try {
    // seq must be a bigint GENERATED ALWAYS identity. is_identity guards the
    // Rule 18 caveat: ADD COLUMN IF NOT EXISTS only checks the column name,
    // so a partial environment with a non-identity `seq` must fail loudly.
    const seqColumn = await client<
      Array<{ data_type: string; is_identity: string; identity_generation: string | null }>
    >`
      SELECT data_type, is_identity, identity_generation
      FROM information_schema.columns
      WHERE table_schema = 'ledger' AND table_name = 'events' AND column_name = 'seq'
    `;
    assert.equal(seqColumn[0]?.data_type, "bigint", "seq must be bigint (migration 0006)");
    assert.equal(seqColumn[0]?.is_identity, "YES", "seq must be an identity column (migration 0006)");
    assert.equal(seqColumn[0]?.identity_generation, "ALWAYS", "seq must be GENERATED ALWAYS");

    const constraint = await client<Array<{ def: string }>>`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'ledger.events'::regclass AND conname = 'ledger_events_chain_fork_key'
    `;
    assert.equal(
      constraint[0]?.def,
      "UNIQUE (organization_id, workspace_id, previous_hash)",
      "fork-guard unique constraint must exist (migration 0006)",
    );

    const index = await client<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'ledger' AND tablename = 'events' AND indexname = 'ledger_events_org_ws_seq_idx'
    `;
    assert.match(
      index[0]?.indexdef ?? "",
      /\(organization_id, workspace_id, seq\)/,
      "ORDER BY-stable (org, workspace, seq) index must exist (migration 0006)",
    );
  } finally {
    await closePostgresClient(client);
  }
});

test(
  "R15: a second event with the same previous_hash dies as 23505 on the fork-guard constraint",
  { skip },
  async () => {
    if (!databaseUrl) return;
    const orgId = `org_test_${Date.now().toString(36)}`;
    const wsId = `ws_${Math.random().toString(36).slice(2, 8)}`;
    const client = createPostgresClient({ connectionString: databaseUrl });
    const insertRaw = async (id: string, previousHash: string) => {
      const payload = { raw: id };
      await client`
      INSERT INTO ledger.events (
        id, organization_id, workspace_id, aggregate_type, aggregate_id, event_type,
        actor_id, occurred_at, payload, previous_hash, event_hash, digest_date
      ) VALUES (
        ${id}, ${orgId}, ${wsId}, ${"ledger"}, ${id}, ${"VoucherImported"},
        ${"user_test"}, ${new Date().toISOString()}, ${client.json(payload as never)},
        ${previousHash}, ${buildEventHash(previousHash, payload)}, ${new Date().toISOString().slice(0, 10)}
      )
    `;
    };
    try {
      await insertRaw(`evt_fork_a_${wsId}`, "GENESIS");
      // The would-be fork: same workspace, same predecessor. Structurally rejected.
      await assert.rejects(
        () => insertRaw(`evt_fork_b_${wsId}`, "GENESIS"),
        (error) => {
          assert.ok(error instanceof Error, "driver error expected");
          assert.equal(error.name, "PostgresError");
          const pg = error as Error & { code?: string; constraint_name?: string };
          assert.equal(pg.code, "23505", "fork must surface as a unique violation");
          assert.equal(pg.constraint_name, "ledger_events_chain_fork_key");
          return true;
        },
      );
      // A different workspace may of course start its own chain at GENESIS.
      const otherWs = `${wsId}_b`;
      const payload = { raw: "other-ws" };
      await client`
      INSERT INTO ledger.events (
        id, organization_id, workspace_id, aggregate_type, aggregate_id, event_type,
        actor_id, occurred_at, payload, previous_hash, event_hash, digest_date
      ) VALUES (
        ${`evt_fork_c_${wsId}`}, ${orgId}, ${otherWs}, ${"ledger"}, ${"agg"}, ${"VoucherImported"},
        ${"user_test"}, ${new Date().toISOString()}, ${client.json(payload as never)},
        ${"GENESIS"}, ${buildEventHash("GENESIS", payload)}, ${new Date().toISOString().slice(0, 10)}
      )
    `;
    } finally {
      await client`delete from ledger.events where organization_id = ${orgId}`;
      await closePostgresClient(client);
    }
  },
);

test("R15: two concurrent connections appending to one workspace produce a single linear chain", { skip }, async () => {
  if (!databaseUrl) return;
  const orgId = `org_test_${Date.now().toString(36)}`;
  const wsId = `ws_${Math.random().toString(36).slice(2, 8)}`;
  // Two real connections: separate postgres-js clients, one store each, SAME
  // workspace. Under the old FOR UPDATE serialization this interleaving forked
  // the chain (blocked waiter re-read a stale tail; nothing at all guarded
  // GENESIS) and duplicated voucher numbers off the racing COUNT(*).
  const clientA = createPostgresClient({ connectionString: databaseUrl });
  const clientB = createPostgresClient({ connectionString: databaseUrl });
  try {
    const storeA = new PostgresLedgerStore(clientA, { organizationId: orgId, workspaceId: wsId });
    const storeB = new PostgresLedgerStore(clientB, { organizationId: orgId, workspaceId: wsId });

    const appendLoop = async (store: PostgresLedgerStore, label: string, count: number) => {
      for (let index = 0; index < count; index += 1) {
        await store.createEvidence({
          organizationId: orgId,
          workspaceId: wsId,
          actorId: `user_${label}`,
          title: `Concurrent ${label} #${index}`,
          originalFilename: `concurrent-${label}-${index}.pdf`,
          mimeType: "application/pdf",
          modalities: ["pdf"],
        });
      }
    };

    // 4 createEvidence calls per connection × 4 events each = 32 events total,
    // with both connections racing from GENESIS onward.
    await Promise.all([appendLoop(storeA, "a", 4), appendLoop(storeB, "b", 4)]);

    const events = await storeA.getEvents();
    assert.equal(events.length, 32, "8 createEvidence transactions × 4 events");

    // getEvents order must equal seq order (seq is the final tiebreak), and
    // seq must be strictly increasing.
    const seqRows = await clientA<Array<{ id: string; seq: string }>>`
      SELECT id, seq::text AS seq FROM ledger.events
      WHERE organization_id = ${orgId} AND workspace_id = ${wsId}
      ORDER BY seq ASC
    `;
    assert.deepEqual(
      events.map((event) => event.id),
      seqRows.map((row) => row.id),
      "getEvents order must match insertion (seq) order",
    );
    for (let index = 1; index < seqRows.length; index += 1) {
      const previous = seqRows[index - 1];
      const current = seqRows[index];
      assert.ok(
        previous !== undefined && current !== undefined && BigInt(current.seq) > BigInt(previous.seq),
        "seq strictly increases",
      );
    }

    // The chain is LINEAR: exactly one GENESIS head, every previous_hash
    // appears exactly once, and each event links onto its predecessor.
    let prev = "GENESIS";
    for (const event of events) {
      assert.equal(event.previousHash, prev, `previousHash mismatch at ${event.id}`);
      prev = event.eventHash;
    }
    const previousHashes = events.map((event) => event.previousHash);
    assert.equal(new Set(previousHashes).size, previousHashes.length, "every previous_hash appears exactly once");
    assert.equal(previousHashes.filter((hash) => hash === "GENESIS").length, 1, "exactly one chain head");

    const summary = summarizeEventIntegrity(events, { verifiedAt: new Date().toISOString(), verifyPayloads: true });
    assert.equal(summary.chainLinked, true, "concurrent appends must never fork the chain");
    assert.equal(summary.payloadVerified, true);
    assert.equal(summary.payloadMismatchCount, 0);

    // Advisory-lock side benefit: the voucher-number COUNT(*) serialized too.
    const snapshot = await storeA.getSnapshot();
    const voucherNumbers = snapshot.vouchers.map((voucher) => voucher.voucherNumber);
    assert.equal(new Set(voucherNumbers).size, 8, "8 distinct voucher numbers under concurrency");
  } finally {
    await clientA`delete from ledger.events where organization_id = ${orgId}`;
    await clientA`delete from ledger.review_tasks where organization_id = ${orgId}`;
    await clientA`delete from ledger.vouchers where organization_id = ${orgId}`;
    await clientA`delete from ledger.evidence_packet_items
      where evidence_packet_id in (select id from ledger.evidence_packets where organization_id = ${orgId})`;
    await clientA`delete from ledger.evidence_packets where organization_id = ${orgId}`;
    await clientA`delete from ledger.evidence_objects where organization_id = ${orgId}`;
    await closePostgresClient(clientA);
    await closePostgresClient(clientB);
  }
});

test("R15: batched importSie chains hashes in JS order and seq preserves the batch order", { skip }, async () => {
  if (!databaseUrl) return;
  const orgId = `org_test_${Date.now().toString(36)}`;
  const wsId = `ws_${Math.random().toString(36).slice(2, 8)}`;
  const client = createPostgresClient({ connectionString: databaseUrl });
  try {
    const store = new PostgresLedgerStore(client, { organizationId: orgId, workspaceId: wsId });

    // 5 balanced vouchers → 5 VoucherImported events in ONE multi-row INSERT.
    const verBlocks = [42, 43, 44, 45, 46].map((num) =>
      [`#VER A ${num} 20260315 "Batch ${num}"`, "{", `#TRANS 6110 {} ${num}.00`, `#TRANS 1930 {} -${num}.00`, "}"].join(
        "\n",
      ),
    );
    const file = parseSie(["#SIETYP 4", '#KONTO 6110 "Kontorsmateriel"', ...verBlocks].join("\n"));

    const result = await store.importSie({ actorId: "user_test", file });
    assert.equal(result.importedVouchers, 5);
    assert.equal(result.importedTransactions, 10);

    const events = await store.getEvents();
    assert.equal(events.length, 5);
    assert.deepEqual(
      events.map((event) => event.aggregateId),
      ["sie_A_42", "sie_A_43", "sie_A_44", "sie_A_45", "sie_A_46"],
      "seq must reproduce the SIE file order for the single-statement batch",
    );

    // Per-event hash chaining survived the bulk insert: linkage AND payload
    // recomputation (the hashes were computed in JS BEFORE the insert).
    let prev = "GENESIS";
    for (const event of events) {
      assert.equal(event.previousHash, prev);
      assert.equal(buildEventHash(event.previousHash, event.payload), event.eventHash);
      prev = event.eventHash;
    }

    // Re-import is still a per-voucher duplicate skip, exactly like Memory.
    const replay = await store.importSie({ actorId: "user_test", file });
    assert.equal(replay.importedVouchers, 0);
    assert.equal(replay.skipped.filter((entry) => entry.reason === "duplicate").length, 5);

    // Memory/Postgres parity (Rule 11) on the same batched input.
    const memory = new MemoryLedgerStore();
    const memResult = await memory.importSie({ actorId: "user_test", file });
    assert.deepEqual(memResult, result);
    const memEvents = (await memory.getEvents()).filter((event) => event.eventType === "VoucherImported");
    assert.deepEqual(
      events.map((event) => event.aggregateId),
      memEvents.map((event) => event.aggregateId),
      "batch order parity Memory vs Postgres",
    );
  } finally {
    await client`delete from ledger.events where organization_id = ${orgId}`;
    await closePostgresClient(client);
  }
});

// Structural type for reaching the store's private tail-read seam from tests.
// TS `private` is compile-time only; the cast pins the CURRENT internal name so
// a rename fails these regression tests loudly instead of silently un-testing
// the retry path.
type TailReadSeam = {
  lockWorkspaceTail(tx: unknown): Promise<string>;
};

test("R15: a chain fork from an out-of-band writer is absorbed by one internal retry", { skip }, async () => {
  if (!databaseUrl) return;
  const orgId = `org_test_${Date.now().toString(36)}`;
  const wsId = `ws_${Math.random().toString(36).slice(2, 8)}`;
  const client = createPostgresClient({ connectionString: databaseUrl });
  const rogueClient = createPostgresClient({ connectionString: databaseUrl });
  try {
    const store = new PostgresLedgerStore(client, { organizationId: orgId, workspaceId: wsId });

    // Rogue writer: appends WITHOUT the advisory lock (models an out-of-band
    // process). It commits between the store's tail read and its insert — the
    // exact fork window the unique constraint guards.
    let injected = 0;
    const injectCompeting = async (previousHash: string) => {
      injected += 1;
      const payload = { rogue: true, index: injected };
      await rogueClient`
        INSERT INTO ledger.events (
          id, organization_id, workspace_id, aggregate_type, aggregate_id, event_type,
          actor_id, occurred_at, payload, previous_hash, event_hash, digest_date
        ) VALUES (
          ${`evt_rogue_${injected}_${wsId}`}, ${orgId}, ${wsId}, ${"ledger"}, ${`agg_rogue_${injected}`},
          ${"VoucherImported"}, ${"rogue-writer"}, ${new Date().toISOString()},
          ${rogueClient.json(payload as never)}, ${previousHash},
          ${buildEventHash(previousHash, payload)}, ${new Date().toISOString().slice(0, 10)}
        )
      `;
    };

    const seam = store as unknown as TailReadSeam;
    const originalTailRead = seam.lockWorkspaceTail.bind(store);
    let forksToInject = 1;
    seam.lockWorkspaceTail = async (tx) => {
      const tail = await originalTailRead(tx);
      if (forksToInject > 0) {
        forksToInject -= 1;
        await injectCompeting(tail); // committed out-of-band, fork armed…
      }
      return tail; // …and the store is handed the now-stale tail.
    };

    // First attempt hits 23505 on the fork guard; the internal retry re-reads
    // the fresh tail (now the rogue event) and succeeds — callers never see it.
    const created = await store.createEvidence({
      organizationId: orgId,
      workspaceId: wsId,
      actorId: "user_test",
      title: "Absorbed-fork evidence",
      originalFilename: "absorbed.pdf",
      mimeType: "application/pdf",
      modalities: ["pdf"],
    });
    assert.ok(created.voucher.id, "createEvidence must succeed after one internal retry");
    assert.equal(injected, 1, "exactly one competing append was injected");

    // 1 rogue event + 4 store events, ONE linear chain across both writers.
    const events = await store.getEvents();
    assert.equal(events.length, 5);
    assert.equal(events[0]?.actorId, "rogue-writer");
    let prev = "GENESIS";
    for (const event of events) {
      assert.equal(event.previousHash, prev, `previousHash mismatch at ${event.eventType}`);
      prev = event.eventHash;
    }
    const summary = summarizeEventIntegrity(events, { verifiedAt: new Date().toISOString(), verifyPayloads: true });
    assert.equal(summary.chainLinked, true);
    assert.equal(summary.payloadVerified, true);
  } finally {
    await client`delete from ledger.events where organization_id = ${orgId}`;
    await client`delete from ledger.review_tasks where organization_id = ${orgId}`;
    await client`delete from ledger.vouchers where organization_id = ${orgId}`;
    await client`delete from ledger.evidence_packet_items
      where evidence_packet_id in (select id from ledger.evidence_packets where organization_id = ${orgId})`;
    await client`delete from ledger.evidence_packets where organization_id = ${orgId}`;
    await client`delete from ledger.evidence_objects where organization_id = ${orgId}`;
    await closePostgresClient(client);
    await closePostgresClient(rogueClient);
  }
});

test("R15: a persistent forker exhausts the retry and surfaces the typed retryable conflict", { skip }, async () => {
  if (!databaseUrl) return;
  const orgId = `org_test_${Date.now().toString(36)}`;
  const wsId = `ws_${Math.random().toString(36).slice(2, 8)}`;
  const client = createPostgresClient({ connectionString: databaseUrl });
  const rogueClient = createPostgresClient({ connectionString: databaseUrl });
  try {
    const store = new PostgresLedgerStore(client, { organizationId: orgId, workspaceId: wsId });

    let injected = 0;
    const seam = store as unknown as TailReadSeam;
    const originalTailRead = seam.lockWorkspaceTail.bind(store);
    seam.lockWorkspaceTail = async (tx) => {
      const tail = await originalTailRead(tx);
      injected += 1;
      const payload = { rogue: true, index: injected };
      await rogueClient`
        INSERT INTO ledger.events (
          id, organization_id, workspace_id, aggregate_type, aggregate_id, event_type,
          actor_id, occurred_at, payload, previous_hash, event_hash, digest_date
        ) VALUES (
          ${`evt_rogue_${injected}_${wsId}`}, ${orgId}, ${wsId}, ${"ledger"}, ${`agg_rogue_${injected}`},
          ${"VoucherImported"}, ${"rogue-writer"}, ${new Date().toISOString()},
          ${rogueClient.json(payload as never)}, ${tail},
          ${buildEventHash(tail, payload)}, ${new Date().toISOString().slice(0, 10)}
        )
      `;
      return tail; // stale on EVERY attempt → both tries fork.
    };

    await assert.rejects(
      () =>
        store.createEvidence({
          organizationId: orgId,
          workspaceId: wsId,
          actorId: "user_test",
          title: "Exhausted-retry evidence",
          originalFilename: "exhausted.pdf",
          mimeType: "application/pdf",
          modalities: ["pdf"],
        }),
      (error) => {
        // HashChainForkError presents the PostgresError structural face on
        // purpose: services/api's app.onError matches `name` + `code` (never
        // driver imports, WS-A5) and W1 maps 23505 → HTTP 409 conflict. These
        // assertions pin that wire contract.
        assert.ok(error instanceof Error);
        assert.equal(error.name, "PostgresError");
        const fork = error as Error & { code?: string; constraint_name?: string; retryable?: boolean };
        assert.equal(fork.code, "23505");
        assert.equal(fork.constraint_name, "ledger_events_chain_fork_key");
        assert.equal(fork.retryable, true);
        assert.match(error.message, /fork/i);
        assert.ok(error.cause instanceof Error, "underlying driver error rides along as cause");
        return true;
      },
    );
    assert.equal(injected, 2, "one initial attempt + exactly one internal retry");

    // Both store attempts rolled back completely; only the rogue events remain
    // — and THEY still form a linear, verifiable chain.
    const evidenceCount = await client<Array<{ count: string }>>`
      SELECT COUNT(*)::text AS count FROM ledger.evidence_objects WHERE organization_id = ${orgId}
    `;
    assert.equal(evidenceCount[0]?.count, "0", "failed transactions must leave no read-model rows");
    const events = await store.getEvents();
    assert.equal(events.length, 2, "only the two rogue appends persist");
    const summary = summarizeEventIntegrity(events, { verifiedAt: new Date().toISOString(), verifyPayloads: true });
    assert.equal(summary.chainLinked, true, "the rejected forks never corrupted the persisted chain");
  } finally {
    await client`delete from ledger.events where organization_id = ${orgId}`;
    await client`delete from ledger.review_tasks where organization_id = ${orgId}`;
    await client`delete from ledger.vouchers where organization_id = ${orgId}`;
    await client`delete from ledger.evidence_packet_items
      where evidence_packet_id in (select id from ledger.evidence_packets where organization_id = ${orgId})`;
    await client`delete from ledger.evidence_packets where organization_id = ${orgId}`;
    await client`delete from ledger.evidence_objects where organization_id = ${orgId}`;
    await closePostgresClient(client);
    await closePostgresClient(rogueClient);
  }
});

test(
  "B5: edited approvals validate account/VAT against the registry and server-resolve accountName + Memory parity",
  { skip },
  async () => {
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
        title: "B5 validation receipt",
        originalFilename: "b5-validation.jpg",
        mimeType: "image/jpeg",
        modalities: ["camera"],
      });

      // Unknown account number → rejected before any mutation (rolled back).
      await assert.rejects(
        () =>
          store.applyReviewDecision(created.review.id, "approve", {
            actorId: "user_test",
            edited: { accountNumber: "9999", vatCode: "VAT25" },
          }),
        (error) => {
          assert.ok(error instanceof InvalidReviewEditError);
          assert.ok(error.issues.some((issue) => issue.includes("chart of accounts")));
          return true;
        },
      );

      // Out-of-vocabulary vatCode (incl. the system marker VAT-REVIEW) → rejected.
      for (const vatCode of ["VAT99", "VAT-REVIEW"]) {
        await assert.rejects(
          () =>
            store.applyReviewDecision(created.review.id, "approve", {
              actorId: "user_test",
              edited: { accountNumber: "6110", vatCode },
            }),
          (error) =>
            error instanceof InvalidReviewEditError &&
            error.issues.some((issue) => issue.includes("VAT regime vocabulary")),
        );
      }
      assert.equal(
        (await store.findReviewByVoucher(created.voucher.id))?.status,
        "needs-review",
        "rejected edits leave the review decidable",
      );

      // Valid edit with a FORGED accountName: the registry name wins everywhere.
      const decided = await store.applyReviewDecision(created.review.id, "approve", {
        actorId: "user_test",
        edited: { accountNumber: "6110", accountName: "Totally Forged Name AB", vatCode: "VAT25" },
      });
      assert.equal(decided?.status, "approved");
      assert.equal(decided.suggestion?.accountName, "Kontorsmateriel", "registry truth wins over the client name");

      const journal = (await store.getReports()).journal;
      const expense = journal.at(-3);
      assert.equal(expense?.accountNumber, "6110");
      assert.equal(expense?.accountName, "Kontorsmateriel", "posted line carries the registry name");
      assert.ok(journal.every((entry) => entry.accountName !== "Totally Forged Name AB"));

      // The decision event records the SUBMITTED edit verbatim (audit input);
      // the posted lines in PostedToLedger carry the resolved registry truth.
      const events = await store.getEvents();
      const approvedEvt = events.find((event) => event.eventType === "ReviewApproved");
      assert.equal(
        (approvedEvt?.payload.edited as { accountName?: string } | undefined)?.accountName,
        "Totally Forged Name AB",
      );
      const postedEvt = events.find((event) => event.eventType === "PostedToLedger");
      const postedLines = postedEvt?.payload.lines as Array<{ accountName: string }>;
      assert.equal(postedLines[0]?.accountName, "Kontorsmateriel");

      // Memory parity (Rule 11): identical decision on Memory resolves the same name.
      const memory = new MemoryLedgerStore();
      const memCreated = await memory.createEvidence({
        organizationId: "org_jpx",
        workspaceId: "workspace_main",
        actorId: "user_test",
        title: "B5 validation receipt",
        originalFilename: "b5-validation.jpg",
        mimeType: "image/jpeg",
        modalities: ["camera"],
      });
      const memDecided = await memory.applyReviewDecision(memCreated.review.id, "approve", {
        actorId: "user_test",
        edited: { accountNumber: "6110", accountName: "Totally Forged Name AB", vatCode: "VAT25" },
      });
      assert.equal(memDecided?.suggestion?.accountName, decided.suggestion?.accountName, "server-resolved name parity");
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

test(
  "B6a: book-without-vat emits ReviewBookedWithoutVat; legacy ReviewRejected+PostedToLedger streams still project",
  { skip },
  async () => {
    if (!databaseUrl) return;
    const orgId = `org_test_${Date.now().toString(36)}`;
    const wsId = `ws_${Math.random().toString(36).slice(2, 8)}`;
    const wsLegacy = `ws_legacy_${Math.random().toString(36).slice(2, 8)}`;
    const client = createPostgresClient({ connectionString: databaseUrl });
    try {
      const store = new PostgresLedgerStore(client, { organizationId: orgId, workspaceId: wsId });
      const created = await store.createEvidence({
        organizationId: orgId,
        workspaceId: wsId,
        actorId: "user_test",
        title: "B6a vocabulary receipt",
        originalFilename: "b6a-vocabulary.jpg",
        mimeType: "image/jpeg",
        modalities: ["camera"],
      });

      const journalBefore = (await store.getReports()).journal.length;
      const decided = await store.applyReviewDecision(created.review.id, "book-without-vat", { actorId: "user_test" });
      assert.equal(decided?.status, "booked-without-vat");
      assert.equal((await store.getReports()).journal.length, journalBefore + 3);

      const events = await store.getEvents();
      const decisionEvt = events.find((event) => event.eventType === "ReviewBookedWithoutVat");
      assert.ok(decisionEvt, "decision event uses the honest vocabulary");
      assert.equal(decisionEvt.aggregateType, "review");
      assert.equal(decisionEvt.aggregateId, created.review.id);
      assert.equal(decisionEvt.payload.action, "book-without-vat");
      assert.ok(!events.some((event) => event.eventType === "ReviewRejected"), "no misleading ReviewRejected");
      const postedEvt = events.find((event) => event.eventType === "PostedToLedger");
      assert.ok(postedEvt, "PostedToLedger still emitted");
      assert.equal(postedEvt.payload.action, "book-without-vat");
      // Chain stays linear and verifiable with the new vocabulary in it.
      const summary = summarizeEventIntegrity(events, { verifiedAt: new Date().toISOString(), verifyPayloads: true });
      assert.equal(summary.chainLinked, true);

      // Memory parity (Rule 11): same decision, same vocabulary.
      const memory = new MemoryLedgerStore();
      const memCreated = await memory.createEvidence({
        organizationId: "org_jpx",
        workspaceId: "workspace_main",
        actorId: "user_test",
        title: "B6a vocabulary receipt",
        originalFilename: "b6a-vocabulary.jpg",
        mimeType: "image/jpeg",
        modalities: ["camera"],
      });
      await memory.applyReviewDecision(memCreated.review.id, "book-without-vat", { actorId: "user_test" });
      const memEvents = await memory.getEvents();
      assert.ok(memEvents.some((event) => event.eventType === "ReviewBookedWithoutVat"));
      assert.ok(!memEvents.some((event) => event.eventType === "ReviewRejected"));

      // Backward compatibility: a LEGACY persisted stream (pre-B6a vocabulary:
      // ReviewRejected + PostedToLedger for a book-without-vat decision) must
      // still replay into reports — projections key on PostedToLedger lines,
      // never on the decision-event name.
      const legacyStore = new PostgresLedgerStore(client, { organizationId: orgId, workspaceId: wsLegacy });
      const occurredAt = new Date().toISOString();
      const digestDate = occurredAt.slice(0, 10);
      const legacyDecisionPayload = { action: "book-without-vat", notes: "legacy vocabulary stream" };
      const legacyDecisionHash = buildEventHash("GENESIS", legacyDecisionPayload);
      const legacyLines = [
        {
          voucherId: "voucher_legacy_1",
          accountNumber: "6110",
          accountName: "Kontorsmateriel",
          description: "Legacy booked-without-vat",
          debit: 100,
          credit: 0,
          vatCode: "VAT25",
          bookedAt: digestDate,
          deductible: false,
        },
        {
          voucherId: "voucher_legacy_1",
          accountNumber: "1930",
          accountName: "Företagskonto",
          description: "Legacy booked-without-vat",
          debit: 0,
          credit: 100,
          vatCode: "NA",
          bookedAt: digestDate,
          deductible: false,
        },
      ];
      const legacyPostedPayload = { action: "book-without-vat", lines: legacyLines };
      const legacyPostedHash = buildEventHash(legacyDecisionHash, legacyPostedPayload);
      await client`
        INSERT INTO ledger.events (
          id, organization_id, workspace_id, aggregate_type, aggregate_id, event_type,
          actor_id, occurred_at, payload, previous_hash, event_hash, digest_date
        ) VALUES
          (${`evt_legacy_1_${wsLegacy}`}, ${orgId}, ${wsLegacy}, 'review', 'review_legacy_1', 'ReviewRejected',
           ${"user_legacy"}, ${occurredAt}, ${client.json(legacyDecisionPayload as never)}, 'GENESIS',
           ${legacyDecisionHash}, ${digestDate}),
          (${`evt_legacy_2_${wsLegacy}`}, ${orgId}, ${wsLegacy}, 'ledger', 'voucher_legacy_1', 'PostedToLedger',
           ${"user_legacy"}, ${occurredAt}, ${client.json(legacyPostedPayload as never)}, ${legacyDecisionHash},
           ${legacyPostedHash}, ${digestDate})
      `;

      const legacyJournal = (await legacyStore.getReports()).journal;
      assert.equal(legacyJournal.length, 3 + 2, "seed lines + the legacy stream's posted lines");
      const [legacyExpense, legacyBank] = legacyJournal.slice(-2);
      assert.equal(legacyExpense?.accountNumber, "6110");
      assert.equal(legacyExpense?.debit, 100);
      assert.equal(legacyBank?.credit, 100);
      const legacySummary = summarizeEventIntegrity(await legacyStore.getEvents(), {
        verifiedAt: new Date().toISOString(),
        verifyPayloads: true,
      });
      assert.equal(legacySummary.chainLinked, true, "the legacy-vocabulary chain still verifies");
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

test(
  "B7a: alert re-detection preserves acknowledged/dismissed and first detected_at; auto-reopen clears resolution metadata",
  { skip },
  async () => {
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
        title: "B7a alert receipt",
        originalFilename: "b7a-alert.jpg",
        mimeType: "image/jpeg",
        modalities: ["camera"],
      });
      await store.applyReviewDecision(created.review.id, "approve", { actorId: "user_test" });

      // Strip the supplier VAT number so missing-supplier-vat fires on refresh
      // (the extraction paths always seed one; mirrors the unit test's
      // white-box strip on MemoryLedgerStore — same condition, same detector).
      await client`
        UPDATE ledger.vouchers SET voucher_fields = voucher_fields - 'supplierVatNumber'
        WHERE id = ${created.voucher.id}
      `;

      const first = await store.refreshComplianceAlerts();
      const alert = first.find(
        (entry) => entry.kind === "missing-supplier-vat" && entry.targetId === created.voucher.id,
      );
      assert.ok(alert, "missing-supplier-vat alert detected");
      assert.equal(alert.status, "open");

      // Backdate detected_at so preservation is observable across refreshes
      // (Memory keeps the FIRST detection time on re-detection — Rule 11).
      const firstDetection = "2026-01-01T00:00:00.000Z";
      await client`
        UPDATE ledger.compliance_alerts SET detected_at = ${firstDetection} WHERE id = ${alert.id}
      `;

      // User acknowledges (no acknowledge UI yet — pinned via SQL, the exact
      // state an acknowledge endpoint will write).
      await client`
        UPDATE ledger.compliance_alerts SET status = 'acknowledged' WHERE id = ${alert.id}
      `;
      const second = await store.refreshComplianceAlerts();
      const acknowledged = second.find((entry) => entry.id === alert.id);
      assert.equal(acknowledged?.status, "acknowledged", "re-detection must not force-reopen an acknowledged alert");
      assert.equal(
        new Date(acknowledged?.detectedAt as unknown as string | Date).toISOString(),
        firstDetection,
        "first-detection time preserved on re-detection",
      );

      // User dismisses with attribution: both survive re-detection untouched.
      await client`
        UPDATE ledger.compliance_alerts
        SET status = 'dismissed', resolved_at = now(), resolved_by = 'user_test'
        WHERE id = ${alert.id}
      `;
      const third = await store.refreshComplianceAlerts();
      assert.equal(third.find((entry) => entry.id === alert.id)?.status, "dismissed");
      const dismissedRow = await client<Array<{ resolved_by: string | null }>>`
        SELECT resolved_by FROM ledger.compliance_alerts WHERE id = ${alert.id}
      `;
      assert.equal(dismissedRow[0]?.resolved_by, "user_test", "user dismissal attribution preserved");

      // AUTO state still flips: a resolved alert whose condition re-fires
      // reopens, and the reopened row carries no stale resolution metadata
      // (CONVENTIONS Rule 18).
      await client`
        UPDATE ledger.compliance_alerts
        SET status = 'resolved', resolved_at = now(), resolved_by = 'system:auto-resolver'
        WHERE id = ${alert.id}
      `;
      const fourth = await store.refreshComplianceAlerts();
      assert.equal(fourth.find((entry) => entry.id === alert.id)?.status, "open", "auto-resolved alerts still reopen");
      const reopenedRow = await client<Array<{ resolved_at: Date | null; resolved_by: string | null }>>`
        SELECT resolved_at, resolved_by FROM ledger.compliance_alerts WHERE id = ${alert.id}
      `;
      assert.equal(reopenedRow[0]?.resolved_at, null, "reopen clears resolved_at");
      assert.equal(reopenedRow[0]?.resolved_by, null, "reopen clears resolved_by");
    } finally {
      await client`delete from ledger.compliance_alerts where organization_id = ${orgId}`;
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

test(
  "B7b: suggestVoucher updates the pending review read model but never clobbers a decided one + Memory parity",
  { skip },
  async () => {
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
        title: "B7b suggest receipt",
        originalFilename: "b7b-suggest.jpg",
        mimeType: "image/jpeg",
        modalities: ["camera"],
      });

      // Pending review: regeneration lands on the review read model.
      const regenerated = await store.suggestVoucher(created.voucher.id);
      assert.ok(regenerated);
      const pending = await store.findReviewByVoucher(created.voucher.id);
      assert.deepEqual(pending?.suggestion, regenerated, "pending review carries the regenerated suggestion");

      // Memory parity (Rule 11): same flow, same read-model behavior.
      const memory = new MemoryLedgerStore();
      const memCreated = await memory.createEvidence({
        organizationId: "org_jpx",
        workspaceId: "workspace_main",
        actorId: "user_test",
        title: "B7b suggest receipt",
        originalFilename: "b7b-suggest.jpg",
        mimeType: "image/jpeg",
        modalities: ["camera"],
      });
      const memRegenerated = await memory.suggestVoucher(memCreated.voucher.id);
      const memPending = await memory.findReviewByVoucher(memCreated.voucher.id);
      assert.deepEqual(memPending?.suggestion, memRegenerated, "Memory persists onto the pending review identically");

      // Decide with an edit: the review's suggestion now records what was POSTED.
      const decided = await store.applyReviewDecision(created.review.id, "approve", {
        actorId: "user_test",
        edited: { accountNumber: "6110", vatCode: "VAT25" },
      });
      assert.equal(decided?.suggestion?.accountNumber, "6110");

      const afterDecision = await store.suggestVoucher(created.voucher.id);
      assert.ok(afterDecision, "regeneration still returns a fresh suggestion");
      const decidedReview = await store.findReviewByVoucher(created.voucher.id);
      assert.equal(
        decidedReview?.suggestion?.accountNumber,
        "6110",
        "the decided review's posted suggestion is never clobbered by regeneration",
      );

      await memory.applyReviewDecision(memCreated.review.id, "approve", {
        actorId: "user_test",
        edited: { accountNumber: "6110", vatCode: "VAT25" },
      });
      await memory.suggestVoucher(memCreated.voucher.id);
      assert.equal(
        (await memory.findReviewByVoucher(memCreated.voucher.id))?.suggestion?.accountNumber,
        "6110",
        "Memory decided-review guard parity",
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
  },
);

test("R15 follow-up: appends survive a wall-clock inversion (seq-primary tail pick)", { skip }, async () => {
  if (!databaseUrl) return;
  const orgId = `org_test_${Date.now().toString(36)}`;
  const wsId = `ws_${Math.random().toString(36).slice(2, 8)}`;
  const client = createPostgresClient({ connectionString: databaseUrl });
  try {
    const store = new PostgresLedgerStore(client, { organizationId: orgId, workspaceId: wsId });

    // 1. Normal append establishes a chain tail at wall-clock "now".
    await store.createEvidence({
      organizationId: orgId,
      workspaceId: wsId,
      actorId: "user_test",
      title: "Pre-inversion evidence",
      originalFilename: "pre-inversion.pdf",
      mimeType: "application/pdf",
      modalities: ["pdf"],
    });
    const beforeInversion = await store.getEvents();
    const tail = beforeInversion.at(-1)!;

    // 2. Simulate an NTP step-back: the NEXT append chains correctly onto the
    //    tail but carries an occurred_at 30 minutes in the PAST. Written raw,
    //    exactly as the store's own append would during a clock excursion.
    const backdatedPayload = { evidenceId: "ev_backdated", title: "Clock-inversion append" };
    const backdatedHash = buildEventHash(tail.eventHash, backdatedPayload);
    const backdatedAt = new Date(Date.now() - 30 * 60_000).toISOString();
    await client`
      INSERT INTO ledger.events (
        id, organization_id, workspace_id, aggregate_type, aggregate_id, event_type,
        actor_id, occurred_at, payload, previous_hash, event_hash, digest_date
      ) VALUES (
        ${`evt_backdated_${wsId}`}, ${orgId}, ${wsId}, ${"evidence"}, ${"ev_backdated"},
        ${"EvidenceReceived"}, ${"user_test"}, ${backdatedAt}, ${client.json(backdatedPayload as never)},
        ${tail.eventHash}, ${backdatedHash}, ${backdatedAt.slice(0, 10)}
      )
    `;

    // 3. With an occurred_at-keyed tail pick this next append is permanently
    //    wedged: the pick returns the pre-inversion tail, the fork constraint
    //    23505s, and the single retry re-picks the same wrong tail. With the
    //    seq-primary pick it chains onto the backdated event and succeeds.
    const after = await store.createEvidence({
      organizationId: orgId,
      workspaceId: wsId,
      actorId: "user_test",
      title: "Post-inversion evidence",
      originalFilename: "post-inversion.pdf",
      mimeType: "application/pdf",
      modalities: ["pdf"],
    });
    assert.ok(after.evidence.id, "append after a clock inversion must not wedge on the fork constraint");

    // 4. getEvents returns true chain order (seq), so integrity holds even
    //    though occurred_at is non-monotonic across the chain.
    const events = await store.getEvents();
    const backdatedIndex = events.findIndex((e) => e.eventHash === backdatedHash);
    assert.ok(backdatedIndex > 0, "backdated event present");
    assert.equal(events[backdatedIndex]!.previousHash, tail.eventHash);
    assert.equal(
      events[backdatedIndex + 1]!.previousHash,
      backdatedHash,
      "post-inversion append must chain onto the backdated tail",
    );
    const summary = summarizeEventIntegrity(events, { verifiedAt: new Date().toISOString(), verifyPayloads: true });
    assert.equal(summary.chainLinked, true, "chain must verify in seq order despite occurred_at inversion");
    assert.equal(summary.payloadMismatchCount, 0);
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
