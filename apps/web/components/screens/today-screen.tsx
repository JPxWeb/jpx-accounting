"use client";

import type { ReviewTask, Voucher, WorkspaceSnapshot } from "@jpx-accounting/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseAsStringEnum, useQueryState } from "nuqs";
import { useState } from "react";
import { toast } from "sonner";
import { useReviewKeyboard } from "../../hooks/use-review-keyboard";
import { apiClient } from "../../lib/client";
import { getErrorMessage } from "../../lib/request-errors";
import { ReviewCard } from "../today/review-card";
import { ReviewFilters } from "../today/review-filters";
import { MetricCard } from "../ui/metric-card";
import { ScreenHeader } from "../ui/screen-header";
import { SectionLabel } from "../ui/section-label";
import { ScreenSkeleton } from "../ui/skeleton";
import { UnavailableState } from "../ui/unavailable-state";

const ACTOR_ID = "user_founder";

const statuses = ["all", "needs-review", "blocked", "approved"] as const;
type Status = (typeof statuses)[number];

const confidences = ["all", "high", "medium", "low"] as const;
type Confidence = (typeof confidences)[number];

function findVoucher(vouchers: Voucher[], review: ReviewTask) {
  return vouchers.find((voucher) => voucher.id === review.voucherId);
}

function matchesConfidence(review: ReviewTask, confidence: Confidence): boolean {
  if (confidence === "all") return true;
  const pct = (review.suggestion?.confidence ?? 0) * 100;
  if (confidence === "high") return pct >= 95;
  if (confidence === "medium") return pct >= 80 && pct < 95;
  return pct < 80;
}

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

export function TodayScreen() {
  const queryClient = useQueryClient();
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const workspaceQuery = useQuery({
    queryKey: ["workspace"],
    queryFn: () => apiClient.getSnapshot(),
  });
  const { data } = workspaceQuery;

  // Filter URL state (read here so we can filter reviews)
  const [statusFilter] = useQueryState("status", parseAsStringEnum<Status>([...statuses]).withDefault("all"));
  const [supplierFilter] = useQueryState("supplier", { defaultValue: "" });
  const [confidenceFilter] = useQueryState(
    "confidence",
    parseAsStringEnum<Confidence>([...confidences]).withDefault("all"),
  );

  // Mutations
  const approveReview = useMutation({
    mutationFn: (id: string) => apiClient.approveReview(id, { actorId: ACTOR_ID }),
    onSuccess: (review) => {
      queryClient.setQueryData<WorkspaceSnapshot>(["workspace"], (current) => applyOptimisticUpdate(current, review));
      void queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });

  const rejectReview = useMutation({
    mutationFn: (id: string) => apiClient.rejectReview(id, { actorId: ACTOR_ID }),
    onSuccess: (review) => {
      queryClient.setQueryData<WorkspaceSnapshot>(["workspace"], (current) => applyOptimisticUpdate(current, review));
      void queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });

  const bookWithoutVatReview = useMutation({
    mutationFn: (id: string) => apiClient.bookWithoutVatReview(id, { actorId: ACTOR_ID }),
    onSuccess: (review) => {
      queryClient.setQueryData<WorkspaceSnapshot>(["workspace"], (current) => applyOptimisticUpdate(current, review));
      void queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });

  const reviews = data?.reviews ?? [];
  const vouchers = data?.vouchers ?? [];
  const pendingReviews = reviews.filter((review) => review.status === "needs-review");
  const blockedReviews = reviews.filter((review) => review.blockedReason);

  // Client-side filtering
  const filteredReviews = reviews.filter((review) => {
    const voucher = findVoucher(vouchers, review);
    const supplier = voucher?.voucherFields.supplierName ?? review.title ?? "";

    if (statusFilter === "blocked") {
      if (!review.blockedReason) return false;
    } else if (statusFilter !== "all") {
      if (review.status !== statusFilter) return false;
    }

    if (supplierFilter && !supplier.toLowerCase().includes(supplierFilter.toLowerCase())) {
      return false;
    }

    if (!matchesConfidence(review, confidenceFilter)) return false;

    return true;
  });

  const hasActiveFilters = statusFilter !== "all" || supplierFilter !== "" || confidenceFilter !== "all";

  const actionError =
    approveReview.error || rejectReview.error || bookWithoutVatReview.error
      ? getErrorMessage(
          approveReview.error ?? rejectReview.error ?? bookWithoutVatReview.error,
          "A review action could not be completed.",
        )
      : null;

  // Keyboard navigation
  useReviewKeyboard({
    reviews: filteredReviews,
    focusedId,
    setFocusedId,
    onAccept: (id) => approveReview.mutate(id),
    onReject: (id) => rejectReview.mutate(id),
    onEdit: (_id) => {
      toast.info("Edit will be available in a future release.");
    },
    onBookWithoutVat: (id) => bookWithoutVatReview.mutate(id),
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
                <a
                  href="/today"
                  className="mt-3 inline-block text-sm font-medium text-[var(--color-accent)] hover:underline"
                >
                  Clear filters
                </a>
              ) : null}
            </div>
          ) : (
            filteredReviews.map((review, index) => {
              const voucher = findVoucher(vouchers, review);
              return (
                <ReviewCard
                  key={review.id}
                  review={review}
                  voucher={voucher}
                  index={index}
                  focused={focusedId === review.id}
                  onFocus={() => setFocusedId(review.id)}
                  onAccept={() => approveReview.mutate(review.id)}
                  onReject={() => rejectReview.mutate(review.id)}
                  onEdit={() => toast.info("Edit will be available in a future release.")}
                  onBookWithoutVat={() => bookWithoutVatReview.mutate(review.id)}
                />
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
