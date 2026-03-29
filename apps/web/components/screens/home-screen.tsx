"use client";

import type { EvidenceCreateInput, ReviewTask, Voucher, WorkspaceSnapshot } from "@jpx-accounting/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { apiClient } from "../../lib/client";
import { formatMoney, formatPercent, formatShortDate } from "../../lib/presentation";
import { getErrorMessage } from "../../lib/request-errors";
import { MetricCard } from "../ui/metric-card";
import { ScreenHeader } from "../ui/screen-header";
import { SectionLabel } from "../ui/section-label";
import { ScreenSkeleton } from "../ui/skeleton";
import { StatusBadge } from "../ui/status-badge";
import { UnavailableState } from "../ui/unavailable-state";

const seedEvidenceInput: EvidenceCreateInput = {
  organizationId: "org_jpx",
  workspaceId: "workspace_main",
  actorId: "user_founder",
  title: "Mobile captured taxi receipt",
  originalFilename: "taxi-receipt.jpg",
  mimeType: "image/jpeg",
  modalities: ["camera", "screenshot"],
  extractedText: "Taxi receipt from airport to client meeting",
};

function initialsFromTitle(value: string) {
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function findVoucher(vouchers: Voucher[], review: ReviewTask) {
  return vouchers.find((voucher) => voucher.id === review.voucherId);
}

function reviewStatusVariant(status: string) {
  if (status === "needs-review") return "accent" as const;
  if (status === "approved") return "success" as const;
  if (status === "rejected") return "danger" as const;
  return "warning" as const;
}

function closeItemVariant(status: string) {
  if (status === "ready") return "accent" as const;
  if (status === "blocked") return "danger" as const;
  return "info" as const;
}

export function HomeScreen() {
  const queryClient = useQueryClient();
  const workspaceQuery = useQuery({
    queryKey: ["workspace"],
    queryFn: () => apiClient.getSnapshot(),
  });
  const { data } = workspaceQuery;

  const createEvidence = useMutation({
    mutationFn: () => apiClient.createEvidence(seedEvidenceInput),
    onSuccess: (result) => {
      queryClient.setQueryData<WorkspaceSnapshot>(["workspace"], (current) => {
        if (!current) return current;

        return {
          ...current,
          evidence: [result.evidence, ...current.evidence],
          vouchers: [result.voucher, ...current.vouchers],
          reviews: [result.review, ...current.reviews],
        };
      });
      void queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });

  const approveFirst = useMutation({
    mutationFn: async () => {
      const firstReview = data?.reviews.find((review) => review.status === "needs-review");
      if (!firstReview) return undefined;
      return apiClient.approveReview(firstReview.id, { actorId: "user_founder" });
    },
    onSuccess: (review) => {
      queryClient.setQueryData<WorkspaceSnapshot>(["workspace"], (current) => {
        if (!current || !review) return current;

        return {
          ...current,
          reviews: current.reviews.map((item) => (item.id === review.id ? review : item)),
          vouchers: current.vouchers.map((voucher) =>
            voucher.id === review.voucherId ? { ...voucher, status: review.status } : voucher,
          ),
        };
      });
      void queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });

  const reviews = data?.reviews ?? [];
  const vouchers = data?.vouchers ?? [];
  const balances = data?.reports.balances ?? [];
  const alerts = data?.alerts ?? [];
  const closeRun = data?.closeRun;
  const pendingReviews = reviews.filter((review) => review.status === "needs-review");
  const blockedReviews = reviews.filter((review) => review.blockedReason);
  const firstPendingReview = pendingReviews[0];
  const actionError =
    createEvidence.error || approveFirst.error
      ? getErrorMessage(createEvidence.error ?? approveFirst.error, "A workspace action could not be completed.")
      : null;

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
        eyebrow="Inbox / Needs Review"
        title="Review-ready bookkeeping, shaped for the phone first."
        description="Evidence arrives once, suggestions stay explainable, and the queue keeps the real accounting work above the fold instead of hiding it under dashboard chrome."
        aside={
          <div className="grid grid-cols-2 gap-3">
            <MetricCard label="Pending reviews" value={pendingReviews.length} />
            <MetricCard label="Blocked VAT" value={blockedReviews.length} />
            <MetricCard
              label="Close-ready tasks"
              value={closeRun?.checklist.filter((item) => item.status === "ready").length ?? 0}
            />
            <MetricCard label="Policy alerts" value={alerts.length} />
          </div>
        }
      />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.2fr)_23rem]">
        <section className="space-y-4">
          <div className="glass-chrome rounded-3xl px-4 py-4 sm:px-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <SectionLabel>Review queue</SectionLabel>
                <h2 className="mt-2 text-2xl font-semibold">Keep the next accounting decision obvious.</h2>
                <p className="mt-2 max-w-2xl text-sm text-[var(--color-text-muted)]">
                  Cards stay compact on mobile, expand on larger screens, and keep AI reasoning behind secondary
                  disclosure until it is needed.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => createEvidence.mutate()}
                  data-testid="simulate-upload"
                  className="glass-panel-soft rounded-xl px-4 py-2.5 text-sm font-medium text-[var(--color-text)]"
                >
                  Create sample receipt
                </button>
                <button
                  type="button"
                  onClick={() => approveFirst.mutate()}
                  data-testid="approve-first"
                  disabled={!firstPendingReview || approveFirst.isPending}
                  className="rounded-xl bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white shadow-[var(--shadow-accent)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Approve next review
                </button>
              </div>
            </div>
            {actionError ? (
              <p className="mt-4 rounded-2xl bg-[var(--color-danger-soft)] px-4 py-3 text-sm text-[var(--color-danger)]">
                {actionError}
              </p>
            ) : null}
          </div>

          <div className="space-y-4">
            {reviews.map((review, index) => {
              const voucher = findVoucher(vouchers, review);
              const confidence = formatPercent(review.suggestion?.confidence ?? 0);
              const citation = review.suggestion?.citations[0];
              const supplier = voucher?.voucherFields.supplierName ?? review.title;

              return (
                <motion.article
                  key={review.id}
                  data-testid="review-card"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="glass-panel rounded-3xl p-4 sm:p-5"
                >
                  <div className="review-card-layout">
                    <div className="review-card-preview glass-panel-soft rounded-2xl p-4">
                      <div className="flex h-full flex-col justify-between gap-4">
                        <div className="flex items-center justify-between gap-3">
                          <StatusBadge
                            status={review.status}
                            variant={reviewStatusVariant(review.status)}
                            testId="review-status"
                          />
                          <span className="text-sm font-semibold tabular-nums text-[var(--color-text-muted)]">
                            {confidence}
                          </span>
                        </div>
                        <div>
                          <div className="inline-flex rounded-xl bg-[var(--color-accent-soft)] px-4 py-3 text-xl font-semibold tracking-[0.08em] text-[var(--color-text)]">
                            {initialsFromTitle(supplier)}
                          </div>
                          <p className="mt-3 text-sm font-semibold text-[var(--color-text)]">{supplier}</p>
                          <p className="text-eyebrow mt-1">
                            {voucher?.accountingMethod === "invoice" ? "Invoice method" : "Cash method"}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <SectionLabel>{voucher?.voucherNumber ?? "Pending voucher"}</SectionLabel>
                          <h3 className="mt-2 text-xl font-semibold text-[var(--color-text)]">{review.title}</h3>
                          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-text-muted)]">
                            {review.suggestedAction}
                          </p>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-sm lg:w-[17rem]">
                          <div className="glass-panel-inset rounded-xl px-3 py-3">
                            <div className="text-eyebrow">Date</div>
                            <div className="mt-2 font-semibold">
                              {formatShortDate(voucher?.voucherFields.receiptDate)}
                            </div>
                          </div>
                          <div className="glass-panel-inset rounded-xl px-3 py-3">
                            <div className="text-eyebrow">Gross</div>
                            <div className="mt-2 font-semibold tabular-nums">
                              {formatMoney(voucher?.voucherFields.grossAmount)}
                            </div>
                          </div>
                          <div className="glass-panel-inset rounded-xl px-3 py-3">
                            <div className="text-eyebrow">VAT</div>
                            <div className="mt-2 font-semibold tabular-nums">
                              {formatMoney(voucher?.voucherFields.vatAmount)}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <span className="rounded-lg bg-[var(--color-surface-muted)] px-3 py-2 text-sm font-semibold text-[var(--color-text)]">
                          {review.suggestion?.accountNumber} {review.suggestion?.accountName}
                        </span>
                        <span className="rounded-lg bg-[var(--color-accent-soft)] px-3 py-2 text-sm font-semibold text-[var(--color-accent)]">
                          {review.suggestion?.vatCode}
                        </span>
                        {citation ? (
                          <span className="rounded-lg bg-[var(--color-info-soft)] px-3 py-2 text-sm font-medium text-[var(--color-info)]">
                            Cited: {citation.title}
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
                        <div className="glass-panel-soft rounded-2xl p-4">
                          <SectionLabel>AI suggestion</SectionLabel>
                          <p className="mt-3 text-sm leading-6 text-[var(--color-text-muted)]">
                            {review.suggestion?.reasoning}
                          </p>
                        </div>

                        <details className="glass-panel-soft rounded-2xl p-4">
                          <summary className="text-eyebrow cursor-pointer list-none">Rule hits and provenance</summary>
                          <div className="mt-4 space-y-3">
                            {review.suggestion?.ruleHits.map((rule) => (
                              <div key={rule.id} className="glass-panel-inset rounded-xl px-3 py-3 text-sm">
                                <p className="font-semibold text-[var(--color-text)]">{rule.title}</p>
                                <p className="mt-1 text-[var(--color-text-muted)]">{rule.message}</p>
                              </div>
                            ))}
                            <div className="grid gap-2">
                              {review.provenanceTimeline.map((item) => (
                                <div
                                  key={item.id}
                                  className="flex items-center justify-between gap-4 text-sm text-[var(--color-text-muted)]"
                                >
                                  <span>{item.label}</span>
                                  <span className="text-eyebrow">{item.actor}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </details>
                      </div>

                      {review.blockedReason ? (
                        <p className="mt-4 rounded-2xl bg-[var(--color-warning-soft)] px-4 py-3 text-sm text-[var(--color-warning)]">
                          {review.blockedReason}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </motion.article>
              );
            })}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="glass-panel rounded-3xl p-5" data-testid="close-copilot-panel">
            <div className="flex items-center justify-between gap-3">
              <div>
                <SectionLabel>Close Copilot</SectionLabel>
                <h2 className="mt-2 text-xl font-semibold">Month-end stays visible while the queue moves.</h2>
              </div>
              <StatusBadge status="Advisory only" variant="accent" />
            </div>
            <div className="mt-4 space-y-3">
              {closeRun?.checklist.map((item) => (
                <div key={item.id} className="glass-panel-soft rounded-2xl px-4 py-4">
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm font-medium text-[var(--color-text)]">{item.label}</p>
                    <StatusBadge status={item.status} variant={closeItemVariant(item.status)} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="glass-panel rounded-3xl p-5" data-testid="balances-panel">
            <SectionLabel>Balance pulse</SectionLabel>
            <div className="mt-4 space-y-3">
              {balances.slice(0, 5).map((balance) => (
                <div key={balance.accountNumber} className="glass-panel-soft rounded-2xl px-4 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-[var(--color-text)]">{balance.accountName}</p>
                      <p className="mt-1 text-xs text-mono text-[var(--color-text-muted)]">{balance.accountNumber}</p>
                    </div>
                    <p className="text-sm font-semibold tabular-nums text-[var(--color-text)]">
                      {formatMoney(balance.balance)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="glass-panel rounded-3xl p-5" data-testid="alerts-panel">
            <SectionLabel>Compliance watch</SectionLabel>
            <div className="mt-4 space-y-3">
              {alerts.map((alert) => (
                <div key={alert.id} className="glass-panel-soft rounded-2xl px-4 py-4">
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm font-semibold text-[var(--color-text)]">{alert.title}</p>
                    <StatusBadge status={alert.source} variant="warning" />
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">{alert.impactSummary}</p>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
