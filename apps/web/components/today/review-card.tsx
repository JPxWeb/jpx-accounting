"use client";

import type { ReviewTask, Voucher } from "@jpx-accounting/contracts";
import { motion } from "motion/react";
import { formatMoney, formatPercent, formatShortDate } from "../../lib/presentation";
import { SectionLabel } from "../ui/section-label";
import { StatusBadge } from "../ui/status-badge";
import { ReviewCardActions } from "./review-card-actions";

function initialsFromTitle(value: string) {
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function reviewStatusVariant(status: string) {
  if (status === "needs-review") return "accent" as const;
  if (status === "approved") return "success" as const;
  if (status === "rejected") return "danger" as const;
  return "warning" as const;
}

type ReviewCardProps = {
  review: ReviewTask;
  voucher: Voucher | undefined;
  index: number;
  focused: boolean;
  onFocus: () => void;
  onAccept: () => void;
  onReject: () => void;
  onEdit: () => void;
  onBookWithoutVat: () => void;
};

export function ReviewCard({
  review,
  voucher,
  index,
  focused,
  onFocus,
  onAccept,
  onReject,
  onEdit,
  onBookWithoutVat,
}: ReviewCardProps) {
  const confidence = formatPercent(review.suggestion?.confidence ?? 0);
  const citation = review.suggestion?.citations[0];
  const supplier = voucher?.voucherFields.supplierName ?? review.title;
  const isActionable = review.status === "needs-review";

  return (
    <motion.article
      key={review.id}
      data-testid="review-card"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      tabIndex={0}
      onClick={onFocus}
      onFocus={onFocus}
      className={[
        "glass-panel rounded-xl p-4 sm:p-5 outline-none cursor-default",
        focused ? "ring-2 ring-[var(--color-accent)]" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="review-card-layout">
        <div className="review-card-preview glass-panel-soft rounded-lg p-4">
          <div className="flex h-full flex-col justify-between gap-4">
            <div className="flex items-center justify-between gap-3">
              <StatusBadge status={review.status} variant={reviewStatusVariant(review.status)} testId="review-status" />
              <span className="text-sm font-semibold tabular-nums text-[var(--color-text-muted)]">{confidence}</span>
            </div>
            <div>
              <div className="inline-flex rounded-lg bg-[var(--color-accent-soft)] px-4 py-3 text-xl font-semibold tracking-[0.08em] text-[var(--color-text)]">
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
              <div className="glass-panel-inset rounded-lg px-3 py-3">
                <div className="text-eyebrow">Date</div>
                <div className="mt-2 font-semibold">{formatShortDate(voucher?.voucherFields.receiptDate)}</div>
              </div>
              <div className="glass-panel-inset rounded-lg px-3 py-3">
                <div className="text-eyebrow">Gross</div>
                <div className="mt-2 font-semibold tabular-nums">{formatMoney(voucher?.voucherFields.grossAmount)}</div>
              </div>
              <div className="glass-panel-inset rounded-lg px-3 py-3">
                <div className="text-eyebrow">VAT</div>
                <div className="mt-2 font-semibold tabular-nums">{formatMoney(voucher?.voucherFields.vatAmount)}</div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-md bg-[var(--color-surface-muted)] px-3 py-2 text-sm font-semibold text-[var(--color-text)]">
              {review.suggestion?.accountNumber} {review.suggestion?.accountName}
            </span>
            <span className="rounded-md bg-[var(--color-accent-soft)] px-3 py-2 text-sm font-semibold text-[var(--color-accent)]">
              {review.suggestion?.vatCode}
            </span>
            {citation ? (
              <span className="rounded-md bg-[var(--color-info-soft)] px-3 py-2 text-sm font-medium text-[var(--color-info)]">
                Cited: {citation.title}
              </span>
            ) : null}
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
            <div className="glass-panel-soft rounded-lg p-4">
              <SectionLabel>AI suggestion</SectionLabel>
              <p className="mt-3 text-sm leading-6 text-[var(--color-text-muted)]">{review.suggestion?.reasoning}</p>
            </div>

            <details className="glass-panel-soft rounded-lg p-4">
              <summary className="text-eyebrow cursor-pointer list-none">Rule hits and provenance</summary>
              <div className="mt-4 space-y-3">
                {review.suggestion?.ruleHits.map((rule) => (
                  <div key={rule.id} className="glass-panel-inset rounded-lg px-3 py-3 text-sm">
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
            <p className="mt-4 rounded-lg bg-[var(--color-warning-soft)] px-4 py-3 text-sm text-[var(--color-warning)]">
              {review.blockedReason}
            </p>
          ) : null}

          <ReviewCardActions
            onAccept={onAccept}
            onReject={onReject}
            onEdit={onEdit}
            onBookWithoutVat={onBookWithoutVat}
            disabled={!isActionable}
          />
        </div>
      </div>
    </motion.article>
  );
}
