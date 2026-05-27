"use client";

import type { ReviewTask, Voucher, WorkspaceSnapshot } from "@jpx-accounting/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseAsString, parseAsStringEnum, useQueryState } from "nuqs";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useReviewKeyboard } from "../../hooks/use-review-keyboard";
import { apiClient } from "../../lib/client";
import { getErrorMessage } from "../../lib/request-errors";
import {
  type ConfidenceFilter,
  confidenceFilters,
  matchesConfidence,
  type ReviewAction,
  type StatusFilter,
  statusFilters,
} from "../today/filter-types";
import { ReviewCard } from "../today/review-card";
import { ReviewFilters } from "../today/review-filters";
import { MetricCard } from "../ui/metric-card";
import { ScreenHeader } from "../ui/screen-header";
import { SectionLabel } from "../ui/section-label";
import { ScreenSkeleton } from "../ui/skeleton";
import { UnavailableState } from "../ui/unavailable-state";

const ACTOR_ID = "user_founder";

function applyOptimisticUpdate(current: WorkspaceSnapshot | undefined, review: ReviewTask | undefined) {
  if (!current || !review) return current;
  return {
    ...current,
    reviews: current.reviews.map((item) => (item.id === review.id ? review : item)),
    vouchers: current.vouchers.map((voucher) =>
      voucher.id === review.voucherId ? { ...voucher, status: review.status } : voucher,
    ),
  };
}

function reviewMatchesStatus(review: ReviewTask, statusFilter: StatusFilter): boolean {
  if (statusFilter === "all") return true;
  if (statusFilter === "blocked") return Boolean(review.blockedReason);
  return review.status === statusFilter;
}

export function TodayScreen() {
  const queryClient = useQueryClient();
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const workspaceQuery = useQuery({
    queryKey: ["workspace"],
    queryFn: () => apiClient.getSnapshot(),
  });
  const { data } = workspaceQuery;

  const [statusFilter, setStatus] = useQueryState(
    "status",
    parseAsStringEnum<StatusFilter>([...statusFilters]).withDefault("all"),
  );
  const [supplierFilter, setSupplier] = useQueryState("supplier", parseAsString.withDefault(""));
  const [confidenceFilter, setConfidence] = useQueryState(
    "confidence",
    parseAsStringEnum<ConfidenceFilter>([...confidenceFilters]).withDefault("all"),
  );

  const onMutationSuccess = useCallback(
    (review: ReviewTask | undefined) => {
      queryClient.setQueryData<WorkspaceSnapshot>(["workspace"], (current) => applyOptimisticUpdate(current, review));
    },
    [queryClient],
  );

  const approveReview = useMutation({
    mutationFn: (id: string) => apiClient.approveReview(id, { actorId: ACTOR_ID }),
    onSuccess: onMutationSuccess,
  });
  const rejectReview = useMutation({
    mutationFn: (id: string) => apiClient.rejectReview(id, { actorId: ACTOR_ID }),
    onSuccess: onMutationSuccess,
  });
  const bookWithoutVatReview = useMutation({
    mutationFn: (id: string) => apiClient.bookWithoutVatReview(id, { actorId: ACTOR_ID }),
    onSuccess: onMutationSuccess,
  });

  const reviews = useMemo(() => data?.reviews ?? [], [data?.reviews]);
  const vouchers = useMemo(() => data?.vouchers ?? [], [data?.vouchers]);

  const voucherById = useMemo(() => {
    const map = new Map<string, Voucher>();
    for (const voucher of vouchers) map.set(voucher.id, voucher);
    return map;
  }, [vouchers]);

  const pendingReviews = useMemo(() => reviews.filter((r) => r.status === "needs-review"), [reviews]);
  const blockedReviews = useMemo(() => reviews.filter((r) => r.blockedReason), [reviews]);

  const filteredReviews = useMemo(() => {
    const supplierNeedle = supplierFilter.toLowerCase();
    return reviews.filter((review) => {
      if (!reviewMatchesStatus(review, statusFilter)) return false;

      if (supplierNeedle) {
        const voucher = voucherById.get(review.voucherId);
        const supplier = (voucher?.voucherFields.supplierName ?? review.title ?? "").toLowerCase();
        if (!supplier.includes(supplierNeedle)) return false;
      }

      return matchesConfidence(review, confidenceFilter);
    });
  }, [reviews, voucherById, statusFilter, supplierFilter, confidenceFilter]);

  const hasActiveFilters = statusFilter !== "all" || supplierFilter !== "" || confidenceFilter !== "all";

  const clearFilters = useCallback(() => {
    void setStatus("all");
    void setSupplier(null);
    void setConfidence("all");
  }, [setStatus, setSupplier, setConfidence]);

  const actionError =
    approveReview.error || rejectReview.error || bookWithoutVatReview.error
      ? getErrorMessage(
          approveReview.error ?? rejectReview.error ?? bookWithoutVatReview.error,
          "A review action could not be completed.",
        )
      : null;

  const handleAction = useCallback(
    (id: string, action: ReviewAction) => {
      if (action === "accept") approveReview.mutate(id);
      else if (action === "reject") rejectReview.mutate(id);
      else if (action === "book-without-vat") bookWithoutVatReview.mutate(id);
      else toast.info("Edit will be available in a future release.");
    },
    [approveReview, rejectReview, bookWithoutVatReview],
  );

  const onAccept = useCallback((id: string) => handleAction(id, "accept"), [handleAction]);
  const onReject = useCallback((id: string) => handleAction(id, "reject"), [handleAction]);
  const onEdit = useCallback((id: string) => handleAction(id, "edit"), [handleAction]);
  const onBookWithoutVat = useCallback((id: string) => handleAction(id, "book-without-vat"), [handleAction]);

  useReviewKeyboard({
    reviews: filteredReviews,
    focusedId,
    setFocusedId,
    onAccept,
    onReject,
    onEdit,
    onBookWithoutVat,
  });

  if (workspaceQuery.error && !data) {
    return (
      <UnavailableState
        testId="workspace-unavailable"
        title="Workspace unavailable"
        message={getErrorMessage(
          workspaceQuery.error,
          "The accounting workspace could not be loaded. Check the runtime configuration and API availability.",
        )}
      />
    );
  }

  if (!data) {
    return <ScreenSkeleton />;
  }

  return (
    <div className="page-shell space-y-6">
      <ScreenHeader
        eyebrow="Today / Needs Review"
        title="Review-ready bookkeeping, shaped for the phone first."
        description="Evidence arrives once, suggestions stay explainable, and the queue keeps the real accounting work above the fold instead of hiding it under dashboard chrome."
        aside={
          <div className="grid grid-cols-2 gap-3">
            <MetricCard label="Pending reviews" value={pendingReviews.length} />
            <MetricCard label="Blocked VAT" value={blockedReviews.length} />
          </div>
        }
      />

      <section className="space-y-4">
        <div className="glass-chrome rounded-xl px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-4">
            <div>
              <SectionLabel>Review queue</SectionLabel>
              <h2 className="mt-2 text-2xl font-semibold">Keep the next accounting decision obvious.</h2>
              <p className="mt-2 max-w-2xl text-sm text-[var(--color-text-muted)]">
                Cards stay compact on mobile, expand on larger screens, and keep AI reasoning behind secondary
                disclosure until it is needed.
              </p>
            </div>
            <ReviewFilters />
          </div>
          {actionError ? (
            <p className="mt-4 rounded-lg bg-[var(--color-danger-soft)] px-4 py-3 text-sm text-[var(--color-danger)]">
              {actionError}
            </p>
          ) : null}
        </div>

        <div className="space-y-4">
          {filteredReviews.length === 0 ? (
            <div className="glass-panel rounded-xl p-8 text-center">
              <p className="text-sm text-[var(--color-text-muted)]">
                {hasActiveFilters ? "No reviews match these filters." : "No reviews in the queue."}
              </p>
              {hasActiveFilters ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-3 text-sm font-medium text-[var(--color-accent)] hover:underline"
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          ) : (
            filteredReviews.map((review, index) => (
              <ReviewCard
                key={review.id}
                review={review}
                voucher={voucherById.get(review.voucherId)}
                index={index}
                focused={focusedId === review.id}
                onFocus={() => setFocusedId(review.id)}
                onAction={(action) => handleAction(review.id, action)}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}
