import assert from "node:assert/strict";
import { test } from "node:test";

import type { EvidencePacket, JournalEntryProjection, Voucher, WorkspaceSnapshot } from "@jpx-accounting/contracts";
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

const snapshot: Pick<WorkspaceSnapshot, "vouchers" | "packets" | "voucherTags"> = {
  vouchers: [voucher],
  packets: [packet],
  voucherTags: [],
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
  assert.deepEqual(vm, {
    voucherId: "voucher_1",
    voucherNumber: "A-1",
    supplierName: "Acme AB",
    bookedAt: "2026-03-01T10:00:00.000Z",
    lines: [],
    evidenceIds: ["evidence_a", "evidence_b"],
    externalReferences: [],
    tagIds: [],
    provenanceSummary: "",
    slots: {
      workItemConfirm: "disabled",
      externalRefs: "disabled",
      tags: "disabled",
      lineId: "disabled",
      vatDeductibility: "disabled",
      workflows: "disabled",
    },
  });
});

test("view-model activates externalRefs slot when Wave 3 data path is enabled", () => {
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
    { activateExternalRefs: true },
  );

  assert.equal(vm.slots.externalRefs, "active");
});

test("view-model activates line targeting and VAT slots only from projected line fields", () => {
  const lookup = buildVoucherLookup(snapshot);
  const postedLine: JournalEntryProjection = {
    id: "journal_9",
    lineId: "ln_posted",
    voucherId: "voucher_1",
    accountNumber: "6110",
    accountName: "Office supplies",
    description: "Paper",
    debit: 125,
    credit: 0,
    bookedAt: "2026-03-01T10:00:00.000Z",
    vatCode: "VAT25",
    deductible: true,
  };
  const vm = buildLedgerVoucherViewModel(
    {
      voucherId: "voucher_1",
      bookedAt: postedLine.bookedAt,
      lines: [postedLine],
      totalDebit: 125,
      totalCredit: 0,
    },
    snapshot,
    lookup,
  );

  assert.equal(vm.slots.lineId, "active");
  assert.equal(vm.slots.vatDeductibility, "active");
  assert.equal(vm.lines[0]?.lineId, "ln_posted");
});

test("view-model never promotes positional journal ids to enrichment targets", () => {
  const lookup = buildVoucherLookup(snapshot);
  const seedLine: JournalEntryProjection = {
    id: "journal_1",
    voucherId: "voucher_1",
    accountNumber: "1930",
    accountName: "Bank",
    description: "Opening balance",
    debit: 100,
    credit: 0,
    bookedAt: "2026-03-01T10:00:00.000Z",
  };
  const vm = buildLedgerVoucherViewModel(
    {
      voucherId: "voucher_1",
      bookedAt: seedLine.bookedAt,
      lines: [seedLine],
      totalDebit: 100,
      totalCredit: 0,
    },
    snapshot,
    lookup,
  );

  assert.equal(vm.slots.lineId, "disabled");
  assert.equal(vm.slots.vatDeductibility, "disabled");
  assert.equal(vm.lines[0]?.lineId, undefined);
});

test("view-model falls back honestly when voucher joins are unavailable", () => {
  const vm = buildLedgerVoucherViewModel(
    {
      voucherId: "sie_1",
      bookedAt: "2026-03-02T10:00:00.000Z",
      lines: [],
      totalDebit: 0,
      totalCredit: 0,
    },
    buildVoucherLookup(),
  );

  assert.equal(vm.voucherNumber, "sie_1");
  assert.equal(vm.supplierName, "");
  assert.deepEqual(vm.evidenceIds, []);
  assert.deepEqual(vm.externalReferences, []);
});
