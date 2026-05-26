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

export function detectComplianceIssues(reviews: ReviewTask[], vouchers: Voucher[], today: string): ComplianceAlert[] {
  const vouchersById = new Map(vouchers.map((v) => [v.id, v]));
  const alerts: ComplianceAlert[] = [];
  const detectedAt = `${today}T00:00:00.000Z`;

  // Rule 1: stale-blocked — needs-review with blocking rule hit, voucher older than 7 days.
  // The voucher's createdAt is normalized to its date component so time-of-day
  // doesn't shift the boundary (a voucher created at 18:00 vs 06:00 on the same
  // day should hit the threshold on the same calendar day).
  for (const review of reviews) {
    if (review.status !== "needs-review") continue;
    const ruleHits = review.suggestion?.ruleHits ?? [];
    if (!ruleHits.some((h) => h.severity === "blocking")) continue;
    const voucher = vouchersById.get(review.voucherId);
    if (!voucher) continue;
    const voucherDate = voucher.createdAt.slice(0, 10);
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
  }

  // Rule 2: missing-supplier-vat — approved voucher without supplierVatNumber.
  for (const voucher of vouchers) {
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
  }

  return alerts;
}
