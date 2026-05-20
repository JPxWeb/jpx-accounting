import assert from "node:assert/strict";
import { test } from "node:test";
import { SupabaseLedgerStore } from "@jpx-accounting/domain";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

test("supabase ledger integration", { skip: !supabaseUrl || !secretKey }, async () => {
  const supabase = createClient(supabaseUrl as string, secretKey as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const organizationId = `org_test_${Date.now()}`;
  const store = new SupabaseLedgerStore(supabase, {
    organizationId,
    workspaceId: "workspace_main",
    userId: "user_integration",
  });

  const created = await store.createEvidence({
    organizationId,
    workspaceId: "workspace_main",
    actorId: "user_integration",
    title: "Integration receipt",
    originalFilename: "integration.pdf",
    mimeType: "application/pdf",
    modalities: ["pdf", "upload"],
  });

  const feed = await store.getReviewFeed();
  assert.ok(feed.some((r) => r.id === created.review.id));

  const approved = await store.applyReviewDecision(created.review.id, "approve", {
    actorId: "user_integration",
    notes: "integration approve",
  });
  assert.ok(approved);

  const reports = await store.getReports();
  assert.ok(reports.journal.length > 0);

  const events = await store.getEvents();
  const previousHashes = events.map((e) => e.previousHash);
  assert.equal(new Set(previousHashes).size, previousHashes.length);
});
