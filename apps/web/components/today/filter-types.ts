import type { ReviewTask } from "@jpx-accounting/contracts";
import { confidenceBand } from "@jpx-accounting/domain";

export const statusFilters = ["all", "needs-review", "blocked", "approved"] as const;
export type StatusFilter = (typeof statusFilters)[number];

export const confidenceFilters = ["all", "high", "medium", "low"] as const;
export type ConfidenceFilter = (typeof confidenceFilters)[number];

export type ReviewAction = "accept" | "reject" | "edit" | "book-without-vat";

/**
 * Confidence filtering delegates to the ONE shared `confidenceBand()`
 * (0.85/0.6 — Task 5.10). The old local 0.95/0.80 thresholds are gone, so the
 * queue filters, the review-card chip, and the dashboard widget can never
 * disagree about what "high confidence" means.
 */
export function matchesConfidence(review: ReviewTask, filter: ConfidenceFilter): boolean {
  if (filter === "all") return true;
  return confidenceBand(review.suggestion?.confidence ?? 0) === filter;
}
