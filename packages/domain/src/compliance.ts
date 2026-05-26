import type { ComplianceAlert, ReviewTask, Voucher } from "@jpx-accounting/contracts";

import { createId } from "./ids";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

export function detectComplianceIssues(reviews: ReviewTask[], vouchers: Voucher[], today: string): ComplianceAlert[] {
  const vouchersById = new Map(vouchers.map((v) => [v.id, v]));
  const alerts: ComplianceAlert[] = [];
  const detectedAt = `${today}T00:00:00.000Z`;

  // Rule 1: stale-blocked — needs-review with blocking rule hit, voucher older than 7 days.
  for (const review of reviews) {
    if (review.status !== "needs-review") continue;
    const ruleHits = review.suggestion?.ruleHits ?? [];
    if (!ruleHits.some((h) => h.severity === "blocking")) continue;
    const voucher = vouchersById.get(review.voucherId);
    if (!voucher) continue;
    if (daysBetween(voucher.createdAt, detectedAt) <= 7) continue;
    alerts.push({
      id: createId("alert"),
      title: `Blocked voucher unresolved for >7 days (${voucher.voucherNumber})`,
      source: "internal/compliance",
      detectedAt,
      impactSummary:
        "A voucher with mandatory missing data has been sitting in review for over a week. Resolve or book without VAT.",
      kind: "stale-blocked",
      severity: "warning",
      status: "open",
      targetId: voucher.id,
    });
  }

  // Rule 2: missing-supplier-vat — approved voucher without supplierVatNumber.
  for (const voucher of vouchers) {
    if (voucher.status !== "approved") continue;
    if (voucher.voucherFields.supplierVatNumber && voucher.voucherFields.supplierVatNumber.length > 0) continue;
    alerts.push({
      id: createId("alert"),
      title: `Approved voucher missing supplier VAT number (${voucher.voucherNumber})`,
      source: "Bokföringslagen / VAT requirement",
      detectedAt,
      impactSummary:
        "Posted voucher has no supplier VAT number. Required for input-VAT deduction documentation under Skatteverket rules.",
      kind: "missing-supplier-vat",
      severity: "warning",
      status: "open",
      targetId: voucher.id,
    });
  }

  return alerts;
}
