import type { ComplianceAlert, ReviewTask, Voucher } from "@jpx-accounting/contracts";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Floored day-difference between two ISO timestamps. Both are parsed to ms
 * and compared at the same precision so the 7-day threshold doesn't drift
 * by ±1 day based on the time-of-day component. Throws on malformed input
 * rather than returning NaN — silent NaN propagation flips the comparison
 * result to false and hides genuine bugs upstream.
 */
function daysBetween(from: string, to: string): number {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (Number.isNaN(fromMs)) throw new Error(`daysBetween: unparseable timestamp ${JSON.stringify(from)}`);
  if (Number.isNaN(toMs)) throw new Error(`daysBetween: unparseable timestamp ${JSON.stringify(to)}`);
  return Math.floor((toMs - fromMs) / DAY_MS);
}

/**
 * Stable alert ID derived from the dedup key, so re-running detection
 * produces the same ID for the same condition across both stores
 * (MemoryLedgerStore re-detects in memory; SupabaseLedgerStore upserts).
 * Pre-fix: createId('alert') minted a fresh random ID on every refresh,
 * causing identity drift between the two store implementations.
 */
function deterministicAlertId(kind: string, targetId: string): string {
  return `alert_${kind}_${targetId}`;
}

/**
 * Detect compliance issues across a workspace's reviews + vouchers.
 *
 * Per-record error isolation (CONVENTIONS Rule 21): each voucher/review is
 * processed in a try/catch so one malformed row (e.g. corrupted createdAt
 * timestamp) doesn't abort the whole batch — the bad record is logged and
 * skipped, the rest of the workspace's alerts still surface.
 *
 * `skipped` is exposed in the return value so callers can log/surface the
 * count if they want operator visibility.
 */
export function detectComplianceIssues(reviews: ReviewTask[], vouchers: Voucher[], today: string): ComplianceAlert[] {
  return detectComplianceIssuesDetailed(reviews, vouchers, today).alerts;
}

export type ComplianceDetectionResult = {
  alerts: ComplianceAlert[];
  skipped: Array<{ kind: "review" | "voucher"; id: string; reason: string }>;
};

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
      // Normalize timestamps to UTC dates (CONVENTIONS Rule 22): roundtrip
      // through Date so non-UTC offsets are converted before slicing, otherwise
      // a voucher with a +02:00 offset would bucket to its local date.
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
      skipped.push({ kind: "review", id: review.id, reason: err instanceof Error ? err.message : String(err) });
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
      skipped.push({ kind: "voucher", id: voucher.id, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  return { alerts, skipped };
}
