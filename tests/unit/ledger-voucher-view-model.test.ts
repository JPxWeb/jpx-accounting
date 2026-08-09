import assert from "node:assert/strict";
import { test } from "node:test";

import type { EvidencePacket, Voucher, WorkspaceSnapshot } from "@jpx-accounting/contracts";
import { buildVoucherLookup } from "../../apps/web/components/reports/voucher-link.tsx";
import { buildLedgerVoucherViewModel } from "../../apps/web/lib/ledger/ledger-voucher-view-model.ts";

const voucher: Voucher = {
  id: "voucher_1",
  organizationId: "org_jpx",
  workspaceId: "workspace_main",
  evidencePacketId: "packet_1",
  voucherNumber: "A-1",
  status: "approved",
  accountingMethod: "invoice",
  extractedFields: [],
  voucherFields: { supplierName: "Acme AB", currency: "SEK" },
  createdAt: "2026-03-01T10:00:00.000Z",
  createdBy: "user:demo",
};

const packet: EvidencePacket = {
  id: "packet_1",
  evidenceIds: ["evidence_a", "evidence_b"],
};

const snapshot: Pick<WorkspaceSnapshot, "vouchers" | "packets"> = {
  vouchers: [voucher],
  packets: [packet],
};

test("view-model lists every evidenceIds entry on the packet", () => {
  const lookup = buildVoucherLookup(snapshot);
  const vm = buildLedgerVoucherViewModel(
    {
      voucherId: "voucher_1",
      bookedAt: "2026-03-01T10:00:00.000Z",
      lines: [],
      totalDebit: 0,
      totalCredit: 0,
    },
    snapshot,
    lookup,
  );
  assert.deepEqual(vm.evidenceIds, ["evidence_a", "evidence_b"]);
  assert.equal(vm.slots.lineId, "disabled");
});
