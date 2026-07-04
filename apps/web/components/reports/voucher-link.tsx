"use client";

import type { EvidencePacket, Voucher, WorkspaceSnapshot } from "@jpx-accounting/contracts";
import { useTranslations } from "next-intl";
import Link from "next/link";

import { StatusBadge } from "../ui/status-badge";

/**
 * The honest voucher chip (advisory-pivot Phase 4, Task 4.8 — plan finding 4).
 * No voucher route exists, so the drill grammar terminates at evidence:
 *
 * (a) voucher + packet resolve via the snapshot → a real link to
 *     `/capture/evidence/<first evidence id>` showing the voucher number;
 * (b) `sie_*` ledger lines (SIE imports have no voucher/evidence entities) →
 *     mono text + an "Imported" badge;
 * (c) anything else (e.g. `voucher_seed_1`) → plain muted mono text.
 *
 * NEVER a dead link — if the evidence join doesn't resolve, we render text.
 */

export type VoucherLookup = {
  vouchersById: Map<string, Voucher>;
  packetsById: Map<string, EvidencePacket>;
};

/** Build the id→entity maps once per snapshot; don't rebuild per row. */
export function buildVoucherLookup(snapshot?: Pick<WorkspaceSnapshot, "vouchers" | "packets">): VoucherLookup {
  return {
    vouchersById: new Map((snapshot?.vouchers ?? []).map((voucher) => [voucher.id, voucher])),
    packetsById: new Map((snapshot?.packets ?? []).map((packet) => [packet.id, packet])),
  };
}

export function VoucherLink({ voucherId, lookup }: { voucherId: string; lookup: VoucherLookup }) {
  const t = useTranslations("reports.drill");
  const voucher = lookup.vouchersById.get(voucherId);
  const packet = voucher ? lookup.packetsById.get(voucher.evidencePacketId) : undefined;
  const evidenceId = packet?.evidenceIds[0];

  if (voucher && evidenceId) {
    return (
      <Link
        data-testid="drill-voucher-link"
        href={`/capture/evidence/${evidenceId}`}
        className="text-mono text-sm text-primary underline underline-offset-2"
      >
        {voucher.voucherNumber}
      </Link>
    );
  }

  if (voucherId.startsWith("sie_")) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-mono text-sm">{voucherId}</span>
        <StatusBadge testId="drill-imported-badge" status={t("importedBadge")} variant="info" />
      </span>
    );
  }

  return <span className="text-mono text-sm text-muted-foreground">{voucher?.voucherNumber ?? voucherId}</span>;
}
