import type { EvidencePacket, Voucher, WorkspaceSnapshot } from "@jpx-accounting/contracts";
import { DRAFT_VOUCHER_NUMBER } from "@jpx-accounting/domain";

/**
 * Pure voucher-chip resolution (KFR Phase D, Task 5), extracted from
 * `components/reports/voucher-link.tsx` so it's testable without a DOM — this
 * codebase tests UI via Playwright E2E and keeps decision logic in
 * framework-free `lib/*.ts` modules (see `dashboard-layout-core.ts`).
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

export type VoucherLinkDisplay =
  | { kind: "link"; href: string; label: string; imported: boolean }
  | { kind: "imported-badge"; label: string }
  | { kind: "draft"; href?: string }
  | { kind: "plain"; label: string };

/**
 * True when a voucher has not posted yet and therefore carries the shared
 * draft sentinel instead of a real `V-<n>` (KFR E.1). The sentinel's literal
 * value is Swedish ("Utkast") but `en` is the default UI locale, so every
 * render site must translate it rather than print it — this predicate is the
 * ONE place that recognises it.
 */
export function isDraftVoucherNumber(voucherNumber: string | undefined | null): boolean {
  return voucherNumber === DRAFT_VOUCHER_NUMBER;
}

/**
 * Resolve how a voucher chip should render:
 *
 * (a) voucher + packet + evidence all resolve → a real link to
 *     `/capture/evidence/<first evidence id>` (the drill grammar terminates at
 *     evidence; no voucher route exists). The `imported` flag rides along so a
 *     SIE-imported voucher that later got evidence attached (Task 2) keeps its
 *     badge;
 * (b) a materialized voucher with `origin: "import"` but no evidence yet
 *     (Task 1) → the real "<series> <number>" + Imported badge, no link;
 * (c) no materialized voucher row at all (defensive fallback for pre-migration
 *     projections that only carried the id) → derive from the `sie_*` id
 *     prefix;
 * (d) anything else (e.g. `voucher_seed_1`) → plain muted text.
 *
 * An unposted voucher (KFR E.1 draft sentinel) short-circuits ahead of all of
 * them: it has no number to print, so it renders as a translated Draft chip
 * (still linked when its evidence resolves) rather than leaking the raw
 * Swedish sentinel into an English UI.
 *
 * NEVER a dead link — if the evidence join doesn't resolve, we render text.
 */
export function resolveVoucherLinkDisplay(voucherId: string, lookup: VoucherLookup): VoucherLinkDisplay {
  const voucher = lookup.vouchersById.get(voucherId);
  const packet = voucher?.evidencePacketId ? lookup.packetsById.get(voucher.evidencePacketId) : undefined;
  const evidenceId = packet?.evidenceIds[0];
  const imported = voucher?.origin === "import";

  if (voucher && isDraftVoucherNumber(voucher.voucherNumber)) {
    return evidenceId ? { kind: "draft", href: `/capture/evidence/${evidenceId}` } : { kind: "draft" };
  }
  if (voucher && evidenceId) {
    return { kind: "link", href: `/capture/evidence/${evidenceId}`, label: voucher.voucherNumber, imported };
  }
  if (voucher && imported) {
    return { kind: "imported-badge", label: voucher.voucherNumber };
  }
  if (voucherId.startsWith("sie_")) {
    return { kind: "imported-badge", label: voucherId };
  }
  return { kind: "plain", label: voucher?.voucherNumber ?? voucherId };
}
