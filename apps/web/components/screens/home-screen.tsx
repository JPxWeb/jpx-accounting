"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EvidenceCreateInput, ReviewTask, Voucher, WorkspaceSnapshot } from "@jpx-accounting/contracts";
import { motion } from "motion/react";

import { apiClient } from "../../lib/client";
import { ScreenHeader } from "../ui/screen-header";

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

function formatAmount(value?: number) {
  return `${Math.round(value ?? 0)} SEK`;
}

function formatShortDate(value?: string) {
  if (!value) return "Today";
  return new Date(value).toLocaleDateString("sv-SE", { month: "short", day: "numeric" });
}

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

export function HomeScreen() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["workspace"],
    queryFn: () => apiClient.getSnapshot(),
  });

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

  return (
    <div className="page-shell space-y-6">
      <ScreenHeader
        eyebrow="Inbox / Needs Review"
        title="Review-ready bookkeeping, shaped for the phone first."
        description="Evidence arrives once, suggestions stay explainable, and the queue keeps the real accounting work above the fold instead of hiding it under dashboard chrome."
        aside={
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Pending reviews", value: `${pendingReviews.length}` },
              { label: "Blocked VAT", value: `${blockedReviews.length}` },
              { label: "Close-ready tasks", value: `${closeRun?.checklist.filter((item) => item.status === "ready").length ?? 0}` },
              { label: "Policy alerts", value: `${alerts.length}` },
            ].map((item) => (
              <div key={item.label} className="glass-panel-soft rounded-[24px] p-4">
                <div className="text-[0.7rem] uppercase tracking-[0.2em] text-[var(--color-text-muted)]">{item.label}</div>
                <div className="mt-3 text-3xl font-semibold text-[var(--color-text)]">{item.value}</div>
              </div>
            ))}
          </div>
        }
      />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.2fr)_23rem]">
        <section className="space-y-4">
          <div className="glass-chrome rounded-[28px] px-4 py-4 sm:px-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-[0.7rem] uppercase tracking-[0.24em] text-[var(--color-text-muted)]">Review queue</p>
                <h2 className="mt-2 text-2xl font-semibold">Keep the next accounting decision obvious.</h2>
                <p className="mt-2 max-w-2xl text-sm text-[var(--color-text-muted)]">
                  Cards stay compact on mobile, expand on larger screens, and keep AI reasoning behind secondary disclosure until it is needed.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => createEvidence.mutate()}
                  data-testid="simulate-upload"
                  className="rounded-full bg-white/76 px-4 py-2.5 text-sm font-medium text-[var(--color-text)] shadow-[0_8px_18px_rgba(11,20,28,0.08)]"
                >
                  Create sample receipt
                </button>
                <button
                  type="button"
                  onClick={() => approveFirst.mutate()}
                  data-testid="approve-first"
                  disabled={!firstPendingReview || approveFirst.isPending}
                  className="rounded-full bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white shadow-[0_16px_30px_rgba(10,143,130,0.22)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Approve next review
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {reviews.map((review, index) => {
              const voucher = findVoucher(vouchers, review);
              const confidence = Math.round((review.suggestion?.confidence ?? 0) * 100);
              const citation = review.suggestion?.citations[0];
              const supplier = voucher?.voucherFields.supplierName ?? review.title;

              return (
                <motion.article
                  key={review.id}
                  data-testid="review-card"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="glass-panel rounded-[30px] p-4 sm:p-5"
                >
                  <div className="review-card-layout">
                    <div className="review-card-preview glass-panel-soft rounded-[26px] p-4">
                      <div className="flex h-full flex-col justify-between gap-4">
                        <div className="flex items-center justify-between gap-3">
                          <span
                            className={`rounded-full px-3 py-1 text-[0.72rem] font-semibold ${
                              review.status === "needs-review"
                                ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                                : review.status === "approved"
                                  ? "bg-[rgba(10,143,130,0.16)] text-[var(--color-accent-strong)]"
                                  : review.status === "rejected"
                                    ? "bg-[rgba(191,78,99,0.12)] text-[var(--color-danger)]"
                                    : "bg-[rgba(200,138,24,0.14)] text-[var(--color-warning)]"
                            }`}
                            data-testid="review-status"
                          >
                            {review.status}
                          </span>
                          <span className="text-sm font-semibold text-[var(--color-text-muted)]">{confidence}%</span>
                        </div>
                        <div>
                          <div className="inline-flex rounded-[20px] bg-[linear-gradient(135deg,rgba(10,143,130,0.18),rgba(47,121,168,0.16))] px-4 py-3 text-xl font-semibold tracking-[0.08em] text-[var(--color-text)]">
                            {initialsFromTitle(supplier)}
                          </div>
                          <p className="mt-3 text-sm font-semibold text-[var(--color-text)]">{supplier}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
                            {voucher?.accountingMethod === "invoice" ? "Invoice method" : "Cash method"}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <p className="text-[0.7rem] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">
                            {voucher?.voucherNumber ?? "Pending voucher"}
                          </p>
                          <h3 className="mt-2 text-xl font-semibold text-[var(--color-text)]">{review.title}</h3>
                          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-text-muted)]">{review.suggestedAction}</p>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-sm lg:w-[17rem]">
                          <div className="glass-panel-inset rounded-[20px] px-3 py-3">
                            <div className="text-[0.68rem] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">Date</div>
                            <div className="mt-2 font-semibold">{formatShortDate(voucher?.voucherFields.receiptDate)}</div>
                          </div>
                          <div className="glass-panel-inset rounded-[20px] px-3 py-3">
                            <div className="text-[0.68rem] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">Gross</div>
                            <div className="mt-2 font-semibold">{formatAmount(voucher?.voucherFields.grossAmount)}</div>
                          </div>
                          <div className="glass-panel-inset rounded-[20px] px-3 py-3">
                            <div className="text-[0.68rem] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">VAT</div>
                            <div className="mt-2 font-semibold">{formatAmount(voucher?.voucherFields.vatAmount)}</div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <span className="rounded-full bg-[var(--color-surface-muted)] px-3 py-2 text-sm font-semibold text-[var(--color-text)]">
                          {review.suggestion?.accountNumber} {review.suggestion?.accountName}
                        </span>
                        <span className="rounded-full bg-[var(--color-accent-soft)] px-3 py-2 text-sm font-semibold text-[var(--color-accent)]">
                          {review.suggestion?.vatCode}
                        </span>
                        {citation ? (
                          <span className="rounded-full bg-[rgba(47,121,168,0.1)] px-3 py-2 text-sm font-medium text-[var(--color-info)]">
                            Cited: {citation.title}
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
                        <div className="glass-panel-soft rounded-[24px] p-4">
                          <div className="text-[0.7rem] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">AI suggestion</div>
                          <p className="mt-3 text-sm leading-6 text-[var(--color-text-muted)]">{review.suggestion?.reasoning}</p>
                        </div>

                        <details className="glass-panel-soft rounded-[24px] p-4">
                          <summary className="cursor-pointer list-none text-[0.7rem] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
                            Rule hits and provenance
                          </summary>
                          <div className="mt-4 space-y-3">
                            {review.suggestion?.ruleHits.map((rule) => (
                              <div key={rule.id} className="glass-panel-inset rounded-[18px] px-3 py-3 text-sm">
                                <p className="font-semibold text-[var(--color-text)]">{rule.title}</p>
                                <p className="mt-1 text-[var(--color-text-muted)]">{rule.message}</p>
                              </div>
                            ))}
                            <div className="grid gap-2">
                              {review.provenanceTimeline.map((item) => (
                                <div key={item.id} className="flex items-center justify-between gap-4 text-sm text-[var(--color-text-muted)]">
                                  <span>{item.label}</span>
                                  <span className="text-[0.72rem] uppercase tracking-[0.16em]">{item.actor}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </details>
                      </div>

                      {review.blockedReason ? (
                        <p className="mt-4 rounded-[22px] bg-[rgba(200,138,24,0.12)] px-4 py-3 text-sm text-[var(--color-warning)]">
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
          <section className="glass-panel rounded-[30px] p-5" data-testid="close-copilot-panel">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[0.7rem] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">Close Copilot</p>
                <h2 className="mt-2 text-xl font-semibold">Month-end stays visible while the queue moves.</h2>
              </div>
              <span className="rounded-full bg-[var(--color-accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--color-accent)]">
                Advisory only
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {closeRun?.checklist.map((item) => (
                <div key={item.id} className="glass-panel-soft rounded-[22px] px-4 py-4">
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm font-medium text-[var(--color-text)]">{item.label}</p>
                    <span
                      className={`rounded-full px-3 py-1 text-[0.72rem] font-semibold ${
                        item.status === "ready"
                          ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                          : item.status === "blocked"
                            ? "bg-[rgba(191,78,99,0.12)] text-[var(--color-danger)]"
                            : "bg-[rgba(47,121,168,0.1)] text-[var(--color-info)]"
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="glass-panel rounded-[30px] p-5" data-testid="balances-panel">
            <p className="text-[0.7rem] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">Balance pulse</p>
            <div className="mt-4 space-y-3">
              {balances.slice(0, 5).map((balance) => (
                <div key={balance.accountNumber} className="glass-panel-soft rounded-[22px] px-4 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-[var(--color-text)]">{balance.accountName}</p>
                      <p className="mt-1 text-xs text-mono text-[var(--color-text-muted)]">{balance.accountNumber}</p>
                    </div>
                    <p className="text-sm font-semibold text-[var(--color-text)]">{balance.balance.toFixed(0)} SEK</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="glass-panel rounded-[30px] p-5" data-testid="alerts-panel">
            <p className="text-[0.7rem] uppercase tracking-[0.22em] text-[var(--color-text-muted)]">Compliance watch</p>
            <div className="mt-4 space-y-3">
              {alerts.map((alert) => (
                <div key={alert.id} className="glass-panel-soft rounded-[22px] px-4 py-4">
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm font-semibold text-[var(--color-text)]">{alert.title}</p>
                    <span className="rounded-full bg-[rgba(200,138,24,0.14)] px-3 py-1 text-[0.72rem] font-semibold text-[var(--color-warning)]">
                      {alert.source}
                    </span>
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
