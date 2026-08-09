import type { WorkspaceSnapshot } from "@jpx-accounting/contracts";
import type { VoucherLookup } from "../../components/reports/voucher-link";
import type { VoucherJournalGroup } from "./group-vouchers";

export type LedgerSlotState = "disabled" | "active";
export type LedgerVoucherViewModel = {
  voucherId: string;
  voucherNumber: string;
  supplierName: string;
  bookedAt: string;
  lines: VoucherJournalGroup["lines"];
  evidenceIds: string[];
  provenanceSummary: string;
  slots: Record<
    "workItemConfirm" | "externalRefs" | "tags" | "lineId" | "vatDeductibility" | "workflows",
    LedgerSlotState
  >;
};

export function buildLedgerVoucherViewModel(
  group: VoucherJournalGroup,
  snapshot: Pick<WorkspaceSnapshot, "vouchers" | "packets"> | undefined,
  lookup: VoucherLookup,
): LedgerVoucherViewModel {
  const voucher = lookup.vouchersById.get(group.voucherId);
  const packet = voucher ? lookup.packetsById.get(voucher.evidencePacketId) : undefined;
  return {
    voucherId: group.voucherId,
    voucherNumber: voucher?.voucherNumber ?? group.voucherId,
    supplierName: voucher?.voucherFields.supplierName ?? "",
    bookedAt: group.bookedAt,
    lines: group.lines,
    evidenceIds: packet?.evidenceIds ?? [],
    provenanceSummary: "",
    slots: {
      workItemConfirm: "disabled",
      externalRefs: "disabled",
      tags: "disabled",
      lineId: "disabled",
      vatDeductibility: "disabled",
      workflows: "disabled",
    },
  };
}
