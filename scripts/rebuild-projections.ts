#!/usr/bin/env -S tsx

// Replay ledger.events into projections.journal_entries. Dry-run by default.
//
// Usage:
//   tsx scripts/rebuild-projections.ts [--org <id>] [--workspace <id>] [--apply]
//
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY (required even for dry-run; refusal
// without them prevents anon-key footguns).
//
// Writes only to projections.* — never touches ledger.* (the legal record).

import { buildPostingLines } from "@jpx-accounting/domain";
import { createClient } from "@supabase/supabase-js";

type EventRow = {
  event_type: string;
  payload: {
    action?: "approve" | "book-without-vat";
    suggestion?: Parameters<typeof buildPostingLines>[1];
  };
  aggregate_id?: string;
  occurred_at: string;
  organization_id: string;
  workspace_id: string;
};

type VoucherLite = {
  id: string;
  voucherFields: Parameters<typeof buildPostingLines>[0]["voucherFields"];
};

export function replayJournalLinesFromEvents(events: EventRow[], vouchersById: Map<string, VoucherLite>) {
  const lines: Array<Record<string, unknown>> = [];
  for (const event of events) {
    if (event.event_type !== "PostedToLedger") continue;
    const action = event.payload.action;
    const suggestion = event.payload.suggestion;
    if (!action || !suggestion || !event.aggregate_id) continue;
    const voucher = vouchersById.get(event.aggregate_id);
    if (!voucher) continue;
    const postingLines = buildPostingLines(
      voucher as Parameters<typeof buildPostingLines>[0],
      suggestion,
      action,
      event.occurred_at,
    );
    for (const line of postingLines) {
      lines.push({
        organization_id: event.organization_id,
        workspace_id: event.workspace_id,
        voucher_id: line.voucherId,
        account_number: line.accountNumber,
        account_name: line.accountName,
        description: line.description,
        debit: line.debit,
        credit: line.credit,
        vat_code: line.vatCode,
        deductible: line.deductible,
        booked_at: line.bookedAt,
      });
    }
  }
  return lines;
}

function parseArgs(argv: string[]) {
  const args: { org?: string; workspace?: string; apply: boolean } = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--org") {
      const next = argv[++i];
      if (next) args.org = next;
    } else if (argv[i] === "--workspace") {
      const next = argv[++i];
      if (next) args.workspace = next;
    } else if (argv[i] === "--apply") {
      args.apply = true;
    }
  }
  return args;
}

async function main() {
  const { org, workspace, apply } = parseArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");
    process.exit(2);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const eventsQuery = supabase
    .schema("ledger")
    .from("events")
    .select("*")
    .order("sequence_number", { ascending: true });
  if (org) eventsQuery.eq("organization_id", org);
  if (workspace) eventsQuery.eq("workspace_id", workspace);
  const { data: events, error: eErr } = await eventsQuery;
  if (eErr) {
    console.error(`Failed to read events: ${eErr.message}`);
    process.exit(3);
  }

  const vouchersQuery = supabase.schema("ledger").from("vouchers").select("*");
  if (org) vouchersQuery.eq("organization_id", org);
  if (workspace) vouchersQuery.eq("workspace_id", workspace);
  const { data: vouchers, error: vErr } = await vouchersQuery;
  if (vErr) {
    console.error(`Failed to read vouchers: ${vErr.message}`);
    process.exit(3);
  }
  const vouchersById = new Map<string, VoucherLite>(
    (vouchers ?? []).map((v) => [v.id as string, { id: v.id as string, voucherFields: v.voucher_fields }]),
  );

  const lines = replayJournalLinesFromEvents((events ?? []) as EventRow[], vouchersById);

  const byScope = new Map<string, Array<Record<string, unknown>>>();
  for (const line of lines) {
    const k = `${line.organization_id}/${line.workspace_id}`;
    if (!byScope.has(k)) byScope.set(k, []);
    byScope.get(k)!.push(line);
  }

  console.log(`Replayed ${lines.length} journal lines across ${byScope.size} scope(s).`);
  for (const [scope, scopeLines] of byScope) console.log(`  ${scope}: ${scopeLines.length} lines`);

  if (!apply) {
    console.log("Dry-run (no --apply): no rows written.");
    return;
  }

  for (const [scope, scopeLines] of byScope) {
    const [orgId, wsId] = scope.split("/");
    const del1 = await supabase
      .schema("projections")
      .from("journal_entries")
      .delete()
      .eq("organization_id", orgId)
      .eq("workspace_id", wsId);
    if (del1.error) {
      console.error(`Failed to clear journal_entries for ${scope}: ${del1.error.message}`);
      process.exit(4);
    }
    const del2 = await supabase
      .schema("projections")
      .from("account_balances")
      .delete()
      .eq("organization_id", orgId)
      .eq("workspace_id", wsId);
    if (del2.error) {
      console.error(`Failed to clear account_balances for ${scope}: ${del2.error.message}`);
      process.exit(4);
    }
    const del3 = await supabase
      .schema("projections")
      .from("vat_summary")
      .delete()
      .eq("organization_id", orgId)
      .eq("workspace_id", wsId);
    if (del3.error) {
      console.error(`Failed to clear vat_summary for ${scope}: ${del3.error.message}`);
      process.exit(4);
    }
    if (scopeLines.length > 0) {
      const ins = await supabase.schema("projections").from("journal_entries").insert(scopeLines);
      if (ins.error) {
        console.error(`Failed to insert ${scope}: ${ins.error.message}`);
        process.exit(4);
      }
    }
    console.log(`  ${scope}: applied ${scopeLines.length} lines`);
  }
}

const argv1 = process.argv[1] ?? "";
const isMain = import.meta.url === `file://${argv1.replace(/\\/g, "/")}`;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
