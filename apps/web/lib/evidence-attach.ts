import type { EvidencePacket, ReviewTask, Voucher } from "@jpx-accounting/contracts";

/**
 * Pure decision logic for the evidence-detail "Attach to voucher" picker (KFR
 * Phase E / Task E.5). Framework-free on purpose — this repo tests UI through
 * Playwright and keeps the decisions in plain `lib/*.ts` modules so they can be
 * pinned by unit tests without a DOM (same shape as `voucher-link-display.ts`).
 */

/** The voucher fields the picker searches, sorts, and renders. */
export type AttachCandidate = Pick<Voucher, "id" | "voucherNumber" | "status" | "createdAt" | "voucherFields">;

/**
 * The date a candidate is filed under: the business event first (transaction,
 * then receipt date), falling back to the row's creation timestamp. Same order
 * as `deriveBookedAt` — a voucher is dated by what happened, not by the click.
 */
export function attachCandidateDate(voucher: AttachCandidate): string {
  return voucher.voucherFields.transactionDate ?? voucher.voucherFields.receiptDate ?? voucher.createdAt;
}

/** Human label for a candidate row: the description, else the supplier, else nothing. */
export function attachCandidateLabel(voucher: AttachCandidate): string {
  return voucher.voucherFields.description ?? voucher.voucherFields.supplierName ?? "";
}

/**
 * Candidate list for the picker, off the workspace snapshot the journal view
 * and command palette already read — no new endpoint.
 *
 * - the evidence's currently linked voucher is excluded (attaching evidence to
 *   the voucher it already backs is a no-op with an audit event behind it);
 * - rejected vouchers are excluded: they are dead ends, and this is also what
 *   keeps a just-discarded orphan draft from reappearing as a target;
 * - matching is a case-insensitive substring over number, date, description
 *   and supplier — what a human actually recognises a voucher by;
 * - newest business date first, then capped, so a long history degrades into
 *   "search for it" instead of a thousand-row list.
 */
export function selectAttachCandidates<T extends AttachCandidate>(
  vouchers: readonly T[],
  options: { excludeVoucherId: string | undefined; query: string; limit: number },
): T[] {
  const needle = options.query.trim().toLowerCase();
  return (
    vouchers
      .filter((voucher) => voucher.id !== options.excludeVoucherId && voucher.status !== "rejected")
      .filter((voucher) => needle === "" || attachHaystack(voucher).includes(needle))
      // `.filter()` already returned a fresh array — sorting it mutates nothing
      // the snapshot cache owns (Rule 17).
      .sort((a, b) => attachCandidateDate(b).localeCompare(attachCandidateDate(a)))
      .slice(0, options.limit)
  );
}

function attachHaystack(voucher: AttachCandidate): string {
  return [
    voucher.voucherNumber,
    attachCandidateDate(voucher),
    attachCandidateLabel(voucher),
    voucher.voucherFields.supplierName ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * The review that must be auto-rejected when this evidence is attached
 * elsewhere, or `undefined` when the attach orphans nothing.
 *
 * Every captured receipt auto-creates its OWN draft voucher + review. Moving
 * the evidence onto an existing voucher leaves that draft behind with nothing
 * backing it — a double-booking trap sitting in the review queue, one approval
 * away from booking the same cost twice. Rejecting it posts no lines and burns
 * no voucher number (KFR E.1 mints numbers at posting time), so the discard is
 * cheap and reversible only in the sense that matters: the ledger never moved.
 *
 * Deliberately narrow — all four conditions must hold:
 * 1. the review is still undecided (a decided review is history, never touched);
 * 2. the voucher is `origin: "capture"` — it exists *because* of this evidence.
 *    Manual and imported vouchers legitimately stand alone with no evidence, so
 *    detaching never orphans them;
 * 3. the voucher is currently backed by exactly the packet this evidence sits
 *    in (a voucher re-pointed at some newer packet keeps that one);
 * 4. that packet holds this evidence alone — a multi-evidence packet still
 *    backs the voucher after this one leaves.
 */
export function findOrphanedDraftReviewId(context: {
  evidenceId: string;
  packet: Pick<EvidencePacket, "id" | "evidenceIds"> | undefined;
  voucher: Pick<Voucher, "origin" | "evidencePacketId"> | undefined;
  review: Pick<ReviewTask, "id" | "status"> | undefined;
}): string | undefined {
  const { evidenceId, packet, voucher, review } = context;
  if (!review || review.status !== "needs-review") return undefined;
  if (!voucher || voucher.origin !== "capture") return undefined;
  if (!packet || voucher.evidencePacketId !== packet.id) return undefined;
  if (packet.evidenceIds.length !== 1 || packet.evidenceIds[0] !== evidenceId) return undefined;
  return review.id;
}
