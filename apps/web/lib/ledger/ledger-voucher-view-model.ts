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
  tagIds: string[];
  provenanceSummary: string;
  slots: Record<
    "workItemConfirm" | "externalRefs" | "tags" | "lineId" | "vatDeductibility" | "workflows",
    LedgerSlotState
  >;
};

type LedgerSnapshot = Pick<WorkspaceSnapshot, "vouchers" | "packets" | "voucherTags"> &
  Partial<Pick<WorkspaceSnapshot, "externalReferences">>;
type LedgerVoucherViewModelOptions = {
  activateExternalRefs?: boolean;
  activateTags?: boolean;
  activateWorkflows?: boolean;
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
  const hasStableLineTarget = group.lines.some((line) => line.lineId !== undefined);
  const hasVatDeductibility = group.lines.some((line) => line.vatCode !== undefined || line.deductible !== undefined);
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
    tagIds:
      snapshotOrLookup && "vouchers" in snapshotOrLookup
        ? ((snapshotOrLookup.voucherTags ?? []).find((projection) => projection.voucherId === group.voucherId)
            ?.tagIds ?? [])
        : [],
    provenanceSummary: "",
    slots: {
      workItemConfirm: "disabled",
      externalRefs: options.activateExternalRefs ? "active" : "disabled",
      tags: options.activateTags ? "active" : "disabled",
      lineId: hasStableLineTarget ? "active" : "disabled",
      vatDeductibility: hasVatDeductibility ? "active" : "disabled",
      workflows: options.activateWorkflows ? "active" : "disabled",
    },
  };
}
