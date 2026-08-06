import type { ReviewDecisionEdit, WorkspaceSnapshot } from "@jpx-accounting/contracts";

import { defaultCoaTemplate, findCoaAccount } from "./coa/registry";
import { getVatRegime } from "./vat/regime";
import { validEditVatCodes } from "./store";

/**
 * Structural twin of the advisor package's `ReviewActionProposal` / the API
 * `reviewActionProposalSchema`. Domain stays zod-free; callers validate wire
 * shapes before invoking. Wave E′ / P1-7 — shared R21 re-validation for both
 * Memory and Postgres snapshots (and the local demo transport).
 */
export type ReviewActionProposalLike = {
  reviewId: string;
  voucherId: string;
  reviewTitle: string;
  action: string;
  edited: Pick<ReviewDecisionEdit, "accountNumber" | "vatCode">;
};

/**
 * Pure execute-time re-validation of a model-authored review-action proposal
 * against a workspace snapshot (WS-D R21). Returns a human-readable Swedish
 * rejection reason, or `undefined` when the proposal is still valid.
 *
 * Read-only over the snapshot — never mutates. Both ledger stores answer via
 * `getSnapshot()`; the API's `validateProposalAgainstStore` and the web demo
 * transport share this ONE check so a stale offline approval cannot report
 * success when the server would stream `tool-output-denied`.
 */
export function rejectReviewProposal(
  snapshot: WorkspaceSnapshot,
  proposal: ReviewActionProposalLike,
): string | undefined {
  const review = snapshot.reviews.find((item) => item.id === proposal.reviewId);
  if (!review) {
    return `Granskningen "${proposal.reviewTitle}" (${proposal.reviewId}) finns inte i arbetsytan — ingenting bokfördes.`;
  }
  if (review.voucherId !== proposal.voucherId) {
    return `Förslaget pekar på fel verifikat (${proposal.voucherId}, granskningen gäller ${review.voucherId}) — ingenting bokfördes.`;
  }
  if (review.status !== "needs-review") {
    return `Granskningen "${proposal.reviewTitle}" är redan avgjord (${review.status}) — ingenting bokfördes.`;
  }
  const voucher = snapshot.vouchers.find((item) => item.id === review.voucherId);
  if (!voucher) {
    return `Verifikatet (${review.voucherId}) för granskningen finns inte — ingenting bokfördes.`;
  }
  if (proposal.action !== "approve") {
    return `Åtgärden "${String(proposal.action)}" stöds inte — ingenting bokfördes.`;
  }
  if (!findCoaAccount(defaultCoaTemplate, proposal.edited.accountNumber)) {
    return `Konto ${proposal.edited.accountNumber} finns inte i kontoplanen (${defaultCoaTemplate.id}) — ingenting bokfördes.`;
  }
  const vatVocabulary = validEditVatCodes(getVatRegime(defaultCoaTemplate.country));
  if (!vatVocabulary.has(proposal.edited.vatCode)) {
    return `Momskoden ${proposal.edited.vatCode} är inte giltig (tillåtna: ${[...vatVocabulary].join(", ")}) — ingenting bokfördes.`;
  }
  return undefined;
}
