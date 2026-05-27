import type { ComplianceAlert, ReviewTask, Voucher } from "@jpx-accounting/contracts";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Floored day-difference. Both timestamps normalized to UTC before compare.
 * Throws on malformed input; callers (refreshComplianceAlerts in both stores)
 * isolate per-record via try/catch so one bad voucher doesn't abort the batch.
 */
function daysBetween(from: string, to: string): number {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (Number.isNaN(fromMs)) throw new Error(`daysBetween: unparseable timestamp ${JSON.stringify(from)}`);
  if (Number.isNaN(toMs)) throw new Error(`daysBetween: unparseable timestamp ${JSON.stringify(to)}`);
  return Math.floor((toMs - fromMs) / DAY_MS);
}

/**
 * Stable alert ID derived from the dedup key, so re-detection produces the
 * same ID for the same condition across both store implementations. Required
 * for Memory<->Postgres identity parity (CONVENTIONS Rule 11).
 */
function deterministicAlertId(kind: string, targetId: string): string {
  return `alert_${kind}_${targetId}`;
}

export type ComplianceDetectionResult = {
  alerts: ComplianceAlert[];
  skipped: Array<{ kind: "review" | "voucher"; id: string; reason: string }>;
};

export function detectComplianceIssues(reviews: ReviewTask[], vouchers: Voucher[], today: string): ComplianceAlert[] {
  return detectComplianceIssuesDetailed(reviews, vouchers, today).alerts;
}

export function detectComplianceIssuesDetailed(
  reviews: ReviewTask[],
  vouchers: Voucher[],
  today: string,
): ComplianceDetectionResult {
  const vouchersById = new Map(vouchers.map((v) => [v.id, v]));
  const alerts: ComplianceAlert[] = [];
  const skipped: ComplianceDetectionResult["skipped"] = [];
  const detectedAt = `${today}T00:00:00.000Z`;

  // Rule 1: stale-blocked — needs-review with blocking rule hit, voucher older than 7 days.
  for (const review of reviews) {
    try {
      if (review.status !== "needs-review") continue;
      const ruleHits = review.suggestion?.ruleHits ?? [];
      if (!ruleHits.some((h) => h.severity === "blocking")) continue;
      const voucher = vouchersById.get(review.voucherId);
      if (!voucher) continue;
      // Normalize via UTC roundtrip (CONVENTIONS Rule 22) so non-UTC timestamps
      // bucket to the correct UTC calendar day, not their local-string date.
      const voucherDate = new Date(voucher.createdAt).toISOString().slice(0, 10);
      if (daysBetween(`${voucherDate}T00:00:00.000Z`, detectedAt) <= 7) continue;
      alerts.push({
        id: deterministicAlertId("stale-blocked", voucher.id),
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
    } catch (err) {
      skipped.push({
        kind: "review",
        id: review.id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Rule 2: missing-supplier-vat — approved voucher without supplierVatNumber.
  for (const voucher of vouchers) {
    try {
      if (voucher.status !== "approved") continue;
      if (voucher.voucherFields.supplierVatNumber && voucher.voucherFields.supplierVatNumber.length > 0) continue;
      alerts.push({
        id: deterministicAlertId("missing-supplier-vat", voucher.id),
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
    } catch (err) {
      skipped.push({
        kind: "voucher",
        id: voucher.id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { alerts, skipped };
}
