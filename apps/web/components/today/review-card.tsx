"use client";

import type { ReviewTask, Voucher } from "@jpx-accounting/contracts";
import { confidenceBand, type ConfidenceBand } from "@jpx-accounting/domain";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { Ref } from "react";
import { apiClient } from "../../lib/client";
import { formatPercent, formatShortDate } from "../../lib/presentation";
import { useWorkspaceProfile } from "../providers/workspace-profile-provider";
import { Money } from "../ui/money";
import { SectionLabel } from "../ui/section-label";
import { StatusBadge } from "../ui/status-badge";
import type { ReviewAction } from "./filter-types";
import { ReviewCardActions } from "./review-card-actions";

const MAX_STAGGER_DELAY_S = 0.4;

/**
 * Shared H/M/L confidence bands (Task 5.10): same `confidenceBand()` mapping
 * and `confidence-band` testid conventions as the dashboard review-queue
 * widget, colored via the `--confidence-*` tokens. Text + color, never color
 * alone.
 */
const BAND_STYLES: Record<ConfidenceBand, string> = {
  high: "bg-surface-muted text-confidence-high",
  medium: "bg-surface-muted text-confidence-medium",
  low: "bg-surface-muted text-confidence-low",
};

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
  onAction: (action: ReviewAction) => void;
  /** Attached by TodayScreen to scroll a deep-linked (?review=<id>) card into view. */
  ref?: Ref<HTMLElement | null> | undefined;
};

export function ReviewCard({ review, voucher, index, focused, onFocus, onAction, ref }: ReviewCardProps) {
  const t = useTranslations("today.card");
  const { locale } = useWorkspaceProfile();
  // Shared `company-settings` cache entry (same key as the settings forms and
  // the dashboard widgets) — flipping the AI-posture toggle updates every
  // rendered card live. Unset settings fall back to the contract default.
  const settingsQuery = useQuery({
    queryKey: ["company-settings"],
    queryFn: () => apiClient.getCompanySettings(),
  });
  const suggestionsEnabled = settingsQuery.data?.aiPosture?.suggestionsEnabled ?? true;

  const confidence = formatPercent(review.suggestion?.confidence ?? 0, locale);
  const band = confidenceBand(review.suggestion?.confidence ?? 0);
  const citation = review.suggestion?.citations[0];
  const supplier = voucher?.voucherFields.supplierName ?? review.title;
  const isActionable = review.status === "needs-review";

  return (
    <motion.article
      ref={ref}
      data-testid="review-card"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.05, MAX_STAGGER_DELAY_S) }}
      tabIndex={0}
      onClick={onFocus}
      onFocus={onFocus}
      className={["glass-panel rounded-xl p-4 sm:p-5 outline-none cursor-default", focused ? "ring-2 ring-primary" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="review-card-layout">
        <div className="review-card-preview glass-panel-soft rounded-lg p-4">
          <div className="flex h-full flex-col justify-between gap-4">
            <div className="flex items-center justify-between gap-3">
              <StatusBadge status={review.status} variant={reviewStatusVariant(review.status)} testId="review-status" />
              {suggestionsEnabled ? (
                <span className="flex items-center gap-2">
                  <span className="text-sm font-semibold tabular-nums text-muted-foreground">{confidence}</span>
                  <span
                    data-testid="confidence-band"
                    data-band={band}
                    className={`rounded-lg px-2 py-1 text-caption font-semibold ${BAND_STYLES[band]}`}
                  >
                    {t(`band.${band}`)}
                  </span>
                </span>
              ) : null}
            </div>
            <div>
              <div className="inline-flex rounded-lg bg-primary-soft px-4 py-3 text-xl font-semibold tracking-[0.08em] text-foreground">
                {initialsFromTitle(supplier)}
              </div>
              <p className="mt-3 text-sm font-semibold text-foreground">{supplier}</p>
              <p className="text-eyebrow mt-1">
                {voucher?.accountingMethod === "invoice" ? t("invoiceMethod") : t("cashMethod")}
              </p>
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <SectionLabel>{voucher?.voucherNumber ?? t("pendingVoucher")}</SectionLabel>
              <h3 className="mt-2 text-xl font-semibold text-foreground">{review.title}</h3>
              {suggestionsEnabled ? (
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{review.suggestedAction}</p>
              ) : null}
            </div>
            <div className="grid grid-cols-3 gap-2 text-sm lg:w-[17rem]">
              <div className="glass-panel-inset rounded-lg px-3 py-3">
                <div className="text-eyebrow">{t("date")}</div>
                <div className="mt-2 font-semibold">{formatShortDate(voucher?.voucherFields.receiptDate, locale)}</div>
              </div>
              <div className="glass-panel-inset rounded-lg px-3 py-3">
                <div className="text-eyebrow">{t("gross")}</div>
                <div className="mt-2 font-semibold">
                  <Money value={voucher?.voucherFields.grossAmount} />
                </div>
              </div>
              <div className="glass-panel-inset rounded-lg px-3 py-3">
                <div className="text-eyebrow">{t("vat")}</div>
                <div className="mt-2 font-semibold">
                  <Money value={voucher?.voucherFields.vatAmount} />
                </div>
              </div>
            </div>
          </div>

          {suggestionsEnabled ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-md bg-surface-muted px-3 py-2 text-sm font-semibold text-foreground">
                {review.suggestion?.accountNumber} {review.suggestion?.accountName}
              </span>
              <span className="rounded-md bg-primary-soft px-3 py-2 text-sm font-semibold text-primary">
                {review.suggestion?.vatCode}
              </span>
              {citation ? (
                <span className="rounded-md bg-info-soft px-3 py-2 text-sm font-medium text-info">
                  {t("cited", { title: citation.title })}
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
            {suggestionsEnabled ? (
              <div className="glass-panel-soft rounded-lg p-4">
                <SectionLabel>{t("aiSuggestion")}</SectionLabel>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{review.suggestion?.reasoning}</p>
              </div>
            ) : (
              // Honest notice instead of the AI block (Task 5.10): suggestions
              // are off by workspace AI posture — the evidence and every human
              // review action below stay fully operable.
              <div className="glass-panel-soft rounded-lg p-4" data-testid="suggestions-disabled-notice">
                <SectionLabel>{t("aiSuggestion")}</SectionLabel>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("suggestionsOff")}</p>
                <Link
                  href="/settings/ai-posture"
                  className="mt-3 inline-flex text-sm font-medium text-primary hover:underline"
                >
                  {t("suggestionsOffCta")}
                </Link>
              </div>
            )}

            <details className="glass-panel-soft rounded-lg p-4">
              <summary className="text-eyebrow cursor-pointer list-none">{t("ruleHits")}</summary>
              <div className="mt-4 space-y-3">
                {review.suggestion?.ruleHits.map((rule) => (
                  <div key={rule.id} className="glass-panel-inset rounded-lg px-3 py-3 text-sm">
                    <p className="font-semibold text-foreground">{rule.title}</p>
                    <p className="mt-1 text-muted-foreground">{rule.message}</p>
                  </div>
                ))}
                <div className="grid gap-2">
                  {review.provenanceTimeline.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-4 text-sm text-muted-foreground"
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
            <p className="mt-4 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning">{review.blockedReason}</p>
          ) : null}

          <ReviewCardActions onAction={onAction} disabled={!isActionable} />
        </div>
      </div>
    </motion.article>
  );
}
