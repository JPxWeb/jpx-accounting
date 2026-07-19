"use client";

import type { ReviewTask } from "@jpx-accounting/contracts";
import { confidenceBand, type ConfidenceBand } from "@jpx-accounting/domain";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { apiClient } from "../../../lib/client";
import { invalidateLedgerDerived } from "../../../lib/query-invalidation";
import { applyReviewSnapshotUpdate } from "../../today/review-queue-view";
import { Money } from "../../ui/money";
import type { DashboardData } from "../use-dashboard-data";

const BATCH_POPOVER_ID = "review-widget-batch-popover";

const BAND_STYLES: Record<ConfidenceBand, string> = {
  high: "bg-success-soft text-success",
  medium: "bg-warning-soft text-warning",
  low: "bg-danger-soft text-danger",
};

/**
 * Review queue widget: pending count, the top pending item with its shared
 * confidence band (0.85/0.6 — `confidenceBand()` from domain), a one-tap
 * approve, and a confirmed batch approve for high-band items. Every approval —
 * single or batch — goes through the ordinary `applyReviewDecision` review
 * gate on the server; the batch is just sequential ordinary approvals.
 */
export function ReviewQueueWidget({ data }: { data: DashboardData }) {
  const t = useTranslations("dashboard.widgets.review-queue");
  const tDashboard = useTranslations("dashboard");
  const queryClient = useQueryClient();
  const [batchRunning, setBatchRunning] = useState(false);

  // No actorId in the payload (WS-C R5): attribution is server-derived.
  const approveReview = useMutation({
    mutationFn: (id: string) => apiClient.approveReview(id),
    onSuccess: (review) => {
      applyReviewSnapshotUpdate(queryClient, review);
      invalidateLedgerDerived(queryClient);
    },
  });

  const reviews = data.snapshot?.reviews;
  if (!reviews) {
    return <p className="text-sm text-muted-foreground">{tDashboard("loading")}</p>;
  }

  const suggestionsEnabled = data.settings?.aiPosture?.suggestionsEnabled ?? true;
  const pending = reviews.filter((review) => review.status === "needs-review");
  const top = pending[0];
  const batchTargets = pending.filter(
    (review) => !review.blockedReason && confidenceBand(review.suggestion?.confidence ?? 0) === "high",
  );

  async function runBatch(targets: ReviewTask[]) {
    setBatchRunning(true);
    let approved = 0;
    try {
      for (const review of targets) {
        // Sequential on purpose: each approval is an ordinary review decision
        // appended to the hash chain — no bulk mutation exists, by design.
        const updated = await apiClient.approveReview(review.id);
        applyReviewSnapshotUpdate(queryClient, updated);
        approved += 1;
      }
      toast.success(t("batchDone", { count: approved }));
    } catch {
      toast.error(t("batchError", { completed: approved, total: targets.length }));
    } finally {
      setBatchRunning(false);
      invalidateLedgerDerived(queryClient);
    }
  }

  if (pending.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  }

  const topVoucher = top ? data.snapshot?.vouchers.find((voucher) => voucher.id === top.voucherId) : undefined;
  const topBand = top ? confidenceBand(top.suggestion?.confidence ?? 0) : null;

  return (
    <div className="space-y-3">
      <p data-testid="review-widget-pending-count" className="text-2xl font-semibold tabular-nums">
        {t("pending", { count: pending.length })}
      </p>

      {top ? (
        <div className="glass-panel-soft rounded-lg p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{top.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                <Money value={topVoucher?.voucherFields.grossAmount} />
              </p>
            </div>
            {suggestionsEnabled && topBand ? (
              <span
                data-testid="confidence-band"
                data-band={topBand}
                className={`shrink-0 rounded-lg px-2 py-1 text-caption font-semibold ${BAND_STYLES[topBand]}`}
              >
                {t(`band.${topBand}`)}
              </span>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="review-widget-approve"
              disabled={approveReview.isPending || batchRunning}
              onClick={() => approveReview.mutate(top.id)}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
            >
              {t("approve")}
            </button>
            {suggestionsEnabled && batchTargets.length > 0 ? (
              <>
                <button
                  type="button"
                  data-testid="review-widget-batch"
                  disabled={batchRunning}
                  popoverTarget={BATCH_POPOVER_ID}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-muted disabled:opacity-60"
                >
                  {t("batch", { count: batchTargets.length })}
                </button>
                <div
                  id={BATCH_POPOVER_ID}
                  popover="auto"
                  role="dialog"
                  aria-label={t("batchTitle", { count: batchTargets.length })}
                  className="glass-panel m-auto w-80 max-w-[calc(100vw-2rem)] rounded-2xl p-4 text-foreground opacity-0 transition-[opacity,display,overlay] transition-discrete duration-150 open:opacity-100 starting:open:opacity-0"
                >
                  <p className="text-sm font-semibold">{t("batchTitle", { count: batchTargets.length })}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{t("batchDescription")}</p>
                  <div className="mt-4 flex justify-end gap-2">
                    <button
                      type="button"
                      popoverTarget={BATCH_POPOVER_ID}
                      popoverTargetAction="hide"
                      className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-surface-muted"
                    >
                      {t("batchCancel")}
                    </button>
                    <button
                      type="button"
                      data-testid="batch-approve-confirm"
                      popoverTarget={BATCH_POPOVER_ID}
                      popoverTargetAction="hide"
                      onClick={() => void runBatch(batchTargets)}
                      className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white shadow-sm"
                    >
                      {t("batchConfirm", { count: batchTargets.length })}
                    </button>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
