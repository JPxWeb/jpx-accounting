import type { ExternalReferenceProjection, WorkspaceSnapshot } from "@jpx-accounting/contracts";
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
  externalReferences: ExternalReferenceProjection[];
  provenanceSummary: string;
  slots: Record<
    "workItemConfirm" | "externalRefs" | "tags" | "lineId" | "vatDeductibility" | "workflows",
    LedgerSlotState
  >;
};

type LedgerSnapshot = Pick<WorkspaceSnapshot, "vouchers" | "packets"> &
  Partial<Pick<WorkspaceSnapshot, "externalReferences">>;
type LedgerVoucherViewModelOptions = {
  activateExternalRefs?: boolean;
};

export function buildLedgerVoucherViewModel(group: VoucherJournalGroup, lookup: VoucherLookup): LedgerVoucherViewModel;
export function buildLedgerVoucherViewModel(
  group: VoucherJournalGroup,
  snapshot: LedgerSnapshot | undefined,
  lookup: VoucherLookup,
  options?: LedgerVoucherViewModelOptions,
): LedgerVoucherViewModel;
export function buildLedgerVoucherViewModel(
  group: VoucherJournalGroup,
  snapshotOrLookup: LedgerSnapshot | VoucherLookup | undefined,
  lookup?: VoucherLookup,
  options: LedgerVoucherViewModelOptions = {},
): LedgerVoucherViewModel {
  const resolvedLookup = lookup ?? snapshotOrLookup;
  if (!resolvedLookup || !("vouchersById" in resolvedLookup)) {
    throw new TypeError("Voucher lookup is required");
  }

  const voucher = resolvedLookup.vouchersById.get(group.voucherId);
  const packet = voucher ? resolvedLookup.packetsById.get(voucher.evidencePacketId) : undefined;
  return {
    voucherId: group.voucherId,
    voucherNumber: voucher?.voucherNumber ?? group.voucherId,
    supplierName: voucher?.voucherFields.supplierName ?? "",
    bookedAt: group.bookedAt,
    lines: group.lines,
    evidenceIds: packet?.evidenceIds ?? [],
    externalReferences: (snapshotOrLookup && "vouchers" in snapshotOrLookup
      ? (snapshotOrLookup.externalReferences ?? [])
      : []
    ).filter((reference) => reference.voucherId === group.voucherId && !reference.removed),
    provenanceSummary: "",
    slots: {
      workItemConfirm: "disabled",
      externalRefs: options.activateExternalRefs ? "active" : "disabled",
      tags: "disabled",
      lineId: "disabled",
      vatDeductibility: "disabled",
      workflows: "disabled",
    },
  };
}
