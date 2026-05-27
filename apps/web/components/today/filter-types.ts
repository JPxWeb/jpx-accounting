import type { ReviewTask } from "@jpx-accounting/contracts";

export const statusFilters = ["all", "needs-review", "blocked", "approved"] as const;
export type StatusFilter = (typeof statusFilters)[number];

export const confidenceFilters = ["all", "high", "medium", "low"] as const;
export type ConfidenceFilter = (typeof confidenceFilters)[number];

export type ReviewAction = "accept" | "reject" | "edit" | "book-without-vat";

export function matchesConfidence(review: ReviewTask, filter: ConfidenceFilter): boolean {
  if (filter === "all") return true;
  const pct = (review.suggestion?.confidence ?? 0) * 100;
  if (filter === "high") return pct >= 95;
  if (filter === "medium") return pct >= 80 && pct < 95;
  return pct < 80;
}
