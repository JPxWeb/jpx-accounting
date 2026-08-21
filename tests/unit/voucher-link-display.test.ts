import assert from "node:assert/strict";
import test from "node:test";

import type { EvidencePacket, Voucher } from "@jpx-accounting/contracts";

import { DRAFT_VOUCHER_NUMBER } from "@jpx-accounting/domain";

import {
  buildVoucherLookup,
  isDraftVoucherNumber,
  resolveVoucherLinkDisplay,
} from "../../apps/web/lib/voucher-link-display";

function voucher(overrides: Partial<Voucher> & Pick<Voucher, "id" | "voucherNumber">): Voucher {
  return {
    organizationId: "org_jpx",
    workspaceId: "workspace_main",
    evidencePacketId: null,
    status: "posted",
    origin: "capture",
    accountingMethod: "invoice",
    extractedFields: [],
    voucherFields: { currency: "SEK" },
    createdAt: "2026-03-01T00:00:00.000Z",
    createdBy: "user_test",
    ...overrides,
  };
}

function packet(overrides: Partial<EvidencePacket> & Pick<EvidencePacket, "id">): EvidencePacket {
  return { evidenceIds: [], ...overrides };
}

test("imported voucher with no attached evidence: imported-badge with the real series+number", () => {
  const lookup = buildVoucherLookup({
    vouchers: [voucher({ id: "sie_A_90", voucherNumber: "A 90", origin: "import", evidencePacketId: null })],
    packets: [],
  });
  const display = resolveVoucherLinkDisplay("sie_A_90", lookup);
  assert.deepEqual(display, { kind: "imported-badge", label: "A 90" });
});

test("imported voucher WITH attached evidence: a real link, still flagged imported", () => {
  const lookup = buildVoucherLookup({
    vouchers: [voucher({ id: "sie_A_90", voucherNumber: "A 90", origin: "import", evidencePacketId: "packet_1" })],
    packets: [packet({ id: "packet_1", evidenceIds: ["evidence_1"] })],
  });
  const display = resolveVoucherLinkDisplay("sie_A_90", lookup);
  assert.deepEqual(display, { kind: "link", href: "/capture/evidence/evidence_1", label: "A 90", imported: true });
});

test("native (capture-origin) voucher with evidence: a real link, not flagged imported", () => {
  const lookup = buildVoucherLookup({
    vouchers: [voucher({ id: "voucher_1", voucherNumber: "V-1001", origin: "capture", evidencePacketId: "packet_1" })],
    packets: [packet({ id: "packet_1", evidenceIds: ["evidence_1"] })],
  });
  const display = resolveVoucherLinkDisplay("voucher_1", lookup);
  assert.deepEqual(display, { kind: "link", href: "/capture/evidence/evidence_1", label: "V-1001", imported: false });
});

test("no materialized voucher row (pre-migration data): falls back to the raw sie_ id", () => {
  const lookup = buildVoucherLookup({ vouchers: [], packets: [] });
  const display = resolveVoucherLinkDisplay("sie_A_1", lookup);
  assert.deepEqual(display, { kind: "imported-badge", label: "sie_A_1" });
});

test("unresolvable, non-sie_ id: plain muted text", () => {
  const lookup = buildVoucherLookup({ vouchers: [], packets: [] });
  const display = resolveVoucherLinkDisplay("voucher_seed_1", lookup);
  assert.deepEqual(display, { kind: "plain", label: "voucher_seed_1" });
});

test("imported voucher whose packet resolves but holds no evidence yet: badge, never a dead link", () => {
  const lookup = buildVoucherLookup({
    vouchers: [voucher({ id: "sie_A_90", voucherNumber: "A 90", origin: "import", evidencePacketId: "packet_1" })],
    packets: [packet({ id: "packet_1", evidenceIds: [] })],
  });
  const display = resolveVoucherLinkDisplay("sie_A_90", lookup);
  assert.deepEqual(display, { kind: "imported-badge", label: "A 90" });
});

test("native voucher whose packet is missing from the snapshot: plain text with its real number", () => {
  const lookup = buildVoucherLookup({
    vouchers: [voucher({ id: "voucher_1", voucherNumber: "V-1001", evidencePacketId: "packet_missing" })],
    packets: [],
  });
  const display = resolveVoucherLinkDisplay("voucher_1", lookup);
  assert.deepEqual(display, { kind: "plain", label: "V-1001" });
});

test("unposted (draft) voucher with evidence: a linked Draft chip, never the raw Swedish sentinel", () => {
  const lookup = buildVoucherLookup({
    vouchers: [
      voucher({
        id: "voucher_1",
        voucherNumber: DRAFT_VOUCHER_NUMBER,
        status: "needs-review",
        evidencePacketId: "packet_1",
      }),
    ],
    packets: [packet({ id: "packet_1", evidenceIds: ["evidence_1"] })],
  });
  const display = resolveVoucherLinkDisplay("voucher_1", lookup);
  assert.deepEqual(display, { kind: "draft", href: "/capture/evidence/evidence_1" });
});

test("unposted (draft) voucher with no evidence (manual entry): an unlinked Draft chip", () => {
  const lookup = buildVoucherLookup({
    vouchers: [
      voucher({
        id: "voucher_1",
        voucherNumber: DRAFT_VOUCHER_NUMBER,
        status: "needs-review",
        origin: "manual",
        evidencePacketId: null,
      }),
    ],
    packets: [],
  });
  assert.deepEqual(resolveVoucherLinkDisplay("voucher_1", lookup), { kind: "draft" });
});

test("isDraftVoucherNumber only matches the shared sentinel", () => {
  assert.equal(isDraftVoucherNumber(DRAFT_VOUCHER_NUMBER), true);
  assert.equal(isDraftVoucherNumber("V-1001"), false);
  assert.equal(isDraftVoucherNumber("A 90"), false);
  assert.equal(isDraftVoucherNumber(undefined), false);
});

test("buildVoucherLookup tolerates an absent snapshot (loading state)", () => {
  const lookup = buildVoucherLookup(undefined);
  assert.equal(lookup.vouchersById.size, 0);
  assert.equal(lookup.packetsById.size, 0);
  assert.deepEqual(resolveVoucherLinkDisplay("sie_A_1", lookup), { kind: "imported-badge", label: "sie_A_1" });
});
