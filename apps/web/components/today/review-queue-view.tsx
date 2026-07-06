"use client";

import type { ReviewTask, Voucher, WorkspaceSnapshot } from "@jpx-accounting/contracts";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { parseAsString, parseAsStringEnum, useQueryState } from "nuqs";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "./filter-types";
import { ReviewCard } from "./review-card";
import { ReviewEditSheet } from "./review-edit-sheet";
import { ReviewFilters } from "./review-filters";
import { HotkeyStrip } from "../onboarding/hotkey-strip";
import { MetricCard } from "../ui/metric-card";
import { ScreenHeader } from "../ui/screen-header";
import { SectionLabel } from "../ui/section-label";
import { ScreenSkeleton } from "../ui/skeleton";
import { UnavailableState } from "../ui/unavailable-state";

/**
 * The full review queue, extracted VERBATIM from the pre-dashboard
 * `today-screen.tsx` (Task 5.8): filters, cards, edit sheet, J/K/Y/N/E/B
 * hotkeys, and `?review=` deep-link focus are unchanged — the queue simply
 * lives at `/today?view=queue` now. The review gate stays the ONLY path to a
 * posted voucher.
 */

const ACTOR_ID = "user_founder";

function applyOptimisticUpdate(current: WorkspaceSnapshot | undefined, review: ReviewTask | undefined) {
  if (!current || !review) return current;
  // Shallow-clone the mutated review so React Query's structural sharing can't
  // dedupe the new array element back to the previous reference. Without this,
  // demo mode (MemoryLedgerStore mutates objects in place) leaves the reviews
  // array reference unchanged after a status flip, which keeps useMemo-derived
  // counts like `pendingReviews.length` stale.
  const clonedReview = { ...review };
  return {
    ...current,
    reviews: current.reviews.map((item) => (item.id === review.id ? clonedReview : item)),
    vouchers: current.vouchers.map((voucher) =>
      voucher.id === review.voucherId ? { ...voucher, status: review.status } : voucher,
    ),
  };
}

/**
 * Push a decided review into the cached workspace snapshot. Shared with the
 * dashboard's review-queue widget so a widget approval and a queue approval
 * update the cache identically.
 */
export function applyReviewSnapshotUpdate(queryClient: QueryClient, review: ReviewTask | undefined) {
  queryClient.setQueryData<WorkspaceSnapshot>(["workspace"], (current) => applyOptimisticUpdate(current, review));
}

function reviewMatchesStatus(review: ReviewTask, statusFilter: StatusFilter): boolean {
  if (statusFilter === "all") return true;
  if (statusFilter === "blocked") return Boolean(review.blockedReason);
  return review.status === statusFilter;
}

export function ReviewQueueView({ viewToggle }: { viewToggle?: ReactNode }) {
  const t = useTranslations("today");
  const queryClient = useQueryClient();
  const [manualFocusId, setManualFocusId] = useState<string | null>(null);
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null);

  const workspaceQuery = useQuery({
    queryKey: ["workspace"],
    queryFn: () => apiClient.getSnapshot(),
    // Disable structural sharing: the demo MemoryLedgerStore returns reviews by
    // reference and mutates them in place, which collapses optimistic updates
    // back to the previous array reference.
    structuralSharing: false,
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
  const [reviewParam, setReviewParam] = useQueryState("review", parseAsString);

  const onMutationSuccess = useCallback(
    (review: ReviewTask | undefined) => {
      applyReviewSnapshotUpdate(queryClient, review);
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

  // Deep links (/today?review=<id>, e.g. from the command palette) drive focus while
  // the param is present; manual focus takes over once the user picks another card.
  // Focus is derived from the param instead of set in an effect (react-hooks/set-state-in-effect).
  const paramFocusId = reviewParam && reviews.some((review) => review.id === reviewParam) ? reviewParam : null;
  const focusedId = paramFocusId ?? manualFocusId;

  const setFocusedId = useCallback(
    (id: string | null) => {
      setManualFocusId(id);
      // Keep the URL truthful: drop the deep-link param when focus moves elsewhere.
      if (reviewParam && id !== reviewParam) void setReviewParam(null);
    },
    [reviewParam, setReviewParam],
  );

  const focusedCardRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!paramFocusId) return;
    focusedCardRef.current?.scrollIntoView({ block: "center" });
  }, [paramFocusId]);

  const voucherById = useMemo(() => {
    const map = new Map<string, Voucher>();
    for (const voucher of vouchers) map.set(voucher.id, voucher);
    return map;
  }, [vouchers]);

  const pendingReviews = useMemo(() => reviews.filter((r) => r.status === "needs-review"), [reviews]);
  const blockedReviews = useMemo(() => reviews.filter((r) => r.blockedReason), [reviews]);

  const editingReview = editingReviewId ? (reviews.find((review) => review.id === editingReviewId) ?? null) : null;

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
      // The edit sheet is modal: while it is open the review hotkeys (Y/N/E/B/Enter)
      // must not fire competing decisions underneath it.
      if (editingReviewId) return;
      if (action === "accept") approveReview.mutate(id);
      else if (action === "reject") rejectReview.mutate(id);
      else if (action === "book-without-vat") bookWithoutVatReview.mutate(id);
      // "edit" opens the editor sheet (button click or hotkey E — both route here).
      else setEditingReviewId(id);
    },
    [approveReview, rejectReview, bookWithoutVatReview, editingReviewId],
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
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        aside={
          <div className="flex flex-col gap-3 lg:items-end">
            {viewToggle}
            <div className="grid w-full grid-cols-2 gap-3">
              <MetricCard label={t("metricPending")} value={pendingReviews.length} />
              <MetricCard label={t("metricBlocked")} value={blockedReviews.length} />
            </div>
          </div>
        }
      />

      <section className="space-y-4">
        <div className="glass-chrome rounded-xl px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-4">
            <div>
              <SectionLabel>{t("reviewQueue")}</SectionLabel>
              <h2 className="mt-2 text-2xl font-semibold">{t("queueTitle")}</h2>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t("queueDescription")}</p>
            </div>
            <ReviewFilters />
          </div>
          {pendingReviews.length > 0 ? (
            <div className="mt-4">
              <HotkeyStrip />
            </div>
          ) : null}
          {actionError ? (
            <p className="mt-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">{actionError}</p>
          ) : null}
        </div>

        <div className="space-y-4">
          {filteredReviews.length === 0 ? (
            <div className="glass-panel rounded-xl p-8 text-center">
              <p className="text-sm text-muted-foreground">{hasActiveFilters ? t("emptyFiltered") : t("emptyQueue")}</p>
              {hasActiveFilters ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-3 text-sm font-medium text-primary hover:underline"
                >
                  {t("clearFilters")}
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
                ref={review.id === paramFocusId ? focusedCardRef : undefined}
                onFocus={() => setFocusedId(review.id)}
                onAction={(action) => handleAction(review.id, action)}
              />
            ))
          )}
        </div>
      </section>

      {editingReview ? (
        <ReviewEditSheet
          key={editingReview.id}
          review={editingReview}
          voucher={voucherById.get(editingReview.voucherId)}
          onClose={() => setEditingReviewId(null)}
          onSuccess={(review) => {
            onMutationSuccess(review);
            setEditingReviewId(null);
          }}
        />
      ) : null}
    </div>
  );
}
