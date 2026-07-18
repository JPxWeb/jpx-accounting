import assert from "node:assert/strict";
import test from "node:test";

import type { ExtractionResult, ReportPack } from "@jpx-accounting/contracts";
import {
  deriveDeterministicExtraction,
  InvalidPeriodTokenError,
  InvalidReviewEditError,
  MemoryLedgerStore,
  parseSie,
  ReviewNotFoundError,
  today,
} from "@jpx-accounting/domain";
import { closePostgresClient, createPostgresClient, PostgresLedgerStore } from "@jpx-accounting/persistence-postgres";

// Integration test: gated on `SUPABASE_DB_URL`. Skips silently when not set so CI without a live DB
// still passes. Requires migrations 0001–0005 applied in order — see scripts/integration-db.md for
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

      // Read-model UPDATE only — composeEvidence must not append hash-chain events.
      const events = await store.getEvents();
      assert.equal(events.length, 4, "composeEvidence relink is not an append-only event");
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
