import type { Observation, ReportPack, TaxDeadline, Voucher, WorkspaceSnapshot } from "@jpx-accounting/contracts";

/**
 * Deterministic observation engine (advisory pivot Phase 5). Six pure
 * detectors over data the dashboard ALREADY fetches — the current-month
 * `ReportPack`, the workspace snapshot, and the statutory tax timeline. No
 * endpoint, no LLM, no re-computation: every number in `params` is copied
 * (or arithmetically derived) from those inputs, so observations reconcile
 * with the reports by construction (the reconciliation-guard tests pin this).
 *
 * `titleKey`/`labelKey` resolve in the web's `observations` message namespace
 * via `t(titleKey, params)` — the engine ships keys, never prose.
 *
 * Documented caveat (plan finding 5): SIE-imported vouchers create no voucher
 * rows, so `detectMissingEvidence` covers captured vouchers only.
 */

export const CASH_RUNWAY_CRITICAL_MONTHS = 1.5;
export const CASH_RUNWAY_WARNING_MONTHS = 3;
export const CASH_RUNWAY_TRAILING_POINTS = 3;
export const CASH_RUNWAY_MIN_HISTORY = 2;
export const EXPENSE_ANOMALY_Z_THRESHOLD = 2;
export const EXPENSE_ANOMALY_MIN_HISTORY_MONTHS = 4;
export const DEADLINE_PROXIMITY_DAYS = 14;
export const SUPPLIER_SPIKE_FACTOR = 2;
export const SUPPLIER_SPIKE_MIN_AMOUNT = 500;
export const OBSERVATION_LIMIT = 5;

/** Ranking after severity: the order detectors are listed in the contract. */
const DETECTOR_PRIORITY: Record<Observation["detector"], number> = {
  "cash-runway": 0,
  "expense-anomaly": 1,
  "vat-set-aside": 2,
  "deadline-proximity": 3,
  "missing-evidence": 4,
  "supplier-spike": 5,
};

const SEVERITY_PRIORITY: Record<Observation["severity"], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const MONTH_TOKEN = /^\d{4}-\d{2}$/;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The pack's calendar month (`YYYY-MM`) — the dashboard feeds month packs. */
function packMonth(pack: ReportPack): string {
  return MONTH_TOKEN.test(pack.period.token) ? pack.period.token : pack.period.to.slice(0, 7);
}

/** Zero-based month index for `YYYY-MM` arithmetic without Date objects. */
function monthTokenIndex(token: string): number {
  return Number(token.slice(0, 4)) * 12 + (Number(token.slice(5, 7)) - 1);
}

/** Whole days from `from` to `to` (YYYY-MM-DD, UTC-anchored → timezone-free). */
function daysBetween(from: string, to: string): number {
  const parse = (day: string) =>
    Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

/** The month a voucher belongs to: transaction date, receipt date, then creation. */
function voucherMonth(voucher: Voucher): string {
  const day = voucher.voucherFields.transactionDate ?? voucher.voucherFields.receiptDate ?? voucher.createdAt;
  return day.slice(0, 7);
}

function supplierSlug(supplier: string): string {
  return supplier
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Cash runway from the pack's monthly series. Trailing net burn = average of
 * `cashOut − cashIn` over the last ≤3 ACTIVE points (a point is active when
 * any cash moved). Fewer than 2 active months of history → nothing (too
 * sparse to phrase honestly). Non-burning → a positive info observation.
 */
export function detectCashRunway(pack: ReportPack): Observation[] {
  const active = pack.monthly.filter((point) => point.cashIn !== 0 || point.cashOut !== 0);
  if (active.length < CASH_RUNWAY_MIN_HISTORY) return [];

  const trailing = active.slice(-CASH_RUNWAY_TRAILING_POINTS);
  const burn = trailing.reduce((sum, point) => sum + (point.cashOut - point.cashIn), 0) / trailing.length;
  const cash = pack.monthly.at(-1)!.cashClosing;

  const provenance = [{ kind: "report" as const, target: "cash-bridge" }];
  const action = { labelKey: "cashRunway.action", href: "/reports#cash-bridge" };

  if (burn <= 0) {
    return [
      {
        id: "obs_cash-runway",
        detector: "cash-runway",
        severity: "info",
        titleKey: "cashRunway.positive",
        params: { cash: round2(cash), monthlyNet: round2(-burn) },
        provenance,
        action,
      },
    ];
  }

  const runwayMonths = cash > 0 ? round1(cash / burn) : 0;
  const severity =
    runwayMonths < CASH_RUNWAY_CRITICAL_MONTHS
      ? "critical"
      : runwayMonths < CASH_RUNWAY_WARNING_MONTHS
        ? "warning"
        : "info";

  return [
    {
      id: "obs_cash-runway",
      detector: "cash-runway",
      severity,
      titleKey: "cashRunway.burning",
      params: { runwayMonths, cash: round2(cash), monthlyBurn: round2(burn) },
      provenance,
      action,
    },
  ];
}

/**
 * Expense anomaly per account on cost classes 4–7 (BAS first digit), from the
 * snapshot journal. An account whose current-month total sits ≥2σ above its
 * own history (≥4 prior active months, σ > 0) is a warning. Both the spike
 * and the typical amount are in `params` so the phrasing stays factual.
 */
export function detectExpenseAnomaly(snapshot: WorkspaceSnapshot, pack: ReportPack): Observation[] {
  const currentMonth = packMonth(pack);
  const totals = new Map<string, { accountName: string; byMonth: Map<string, number> }>();

  for (const line of snapshot.reports.journal) {
    const firstDigit = line.accountNumber[0];
    if (firstDigit === undefined || firstDigit < "4" || firstDigit > "7") continue;
    const month = line.bookedAt.slice(0, 7);
    const entry = totals.get(line.accountNumber) ?? {
      accountName: line.accountName,
      byMonth: new Map<string, number>(),
    };
    entry.accountName = line.accountName;
    entry.byMonth.set(month, (entry.byMonth.get(month) ?? 0) + (line.debit - line.credit));
    totals.set(line.accountNumber, entry);
  }

  const observations: Observation[] = [];
  for (const accountNumber of [...totals.keys()].sort()) {
    const entry = totals.get(accountNumber)!;
    const amount = entry.byMonth.get(currentMonth);
    if (amount === undefined) continue;

    const history = [...entry.byMonth.entries()].filter(([month]) => month < currentMonth).map(([, total]) => total);
    if (history.length < EXPENSE_ANOMALY_MIN_HISTORY_MONTHS) continue;

    const mean = history.reduce((sum, value) => sum + value, 0) / history.length;
    const variance = history.reduce((sum, value) => sum + (value - mean) ** 2, 0) / history.length;
    const sigma = Math.sqrt(variance);
    if (sigma <= 0) continue;

    const z = (amount - mean) / sigma;
    if (z < EXPENSE_ANOMALY_Z_THRESHOLD) continue;

    observations.push({
      id: `obs_expense-anomaly_${accountNumber}`,
      detector: "expense-anomaly",
      severity: "warning",
      titleKey: "expenseAnomaly.spike",
      params: {
        account: accountNumber,
        accountName: entry.accountName,
        amount: round2(amount),
        typicalAmount: round2(mean),
        month: currentMonth,
      },
      provenance: [{ kind: "account", target: accountNumber }],
      action: {
        labelKey: "expenseAnomaly.action",
        href: `/books?view=general-ledger&period=${currentMonth}`,
      },
    });
  }
  return observations;
}

/**
 * VAT set-aside: a positive box 49 is money to reserve for Skatteverket
 * (negative = att få tillbaka → nothing to set aside).
 */
export function detectVatSetAside(pack: ReportPack): Observation[] {
  const box49 = pack.vatReturn.find((entry) => entry.box === "49");
  if (!box49 || box49.amount <= 0) return [];
  return [
    {
      id: "obs_vat-set-aside",
      detector: "vat-set-aside",
      severity: "info",
      titleKey: "vatSetAside.setAside",
      params: { amount: round2(box49.amount), periodLabel: pack.period.token },
      provenance: [{ kind: "report", target: "vat-preparation" }],
      action: { labelKey: "vatSetAside.action", href: "/reports#vat-preparation" },
    },
  ];
}

/** Statutory deadlines due within 14 days — calm phrasing, one per deadline. */
export function detectDeadlineProximity(deadlines: TaxDeadline[], today: string): Observation[] {
  const observations: Observation[] = [];
  for (const deadline of deadlines) {
    const daysUntil = daysBetween(today, deadline.dueDate);
    if (daysUntil < 0 || daysUntil > DEADLINE_PROXIMITY_DAYS) continue;
    observations.push({
      id: `obs_deadline-proximity_${deadline.id}`,
      detector: "deadline-proximity",
      severity: "warning",
      titleKey: "deadlineProximity.due",
      params: { kind: deadline.kind, dueDate: deadline.dueDate, daysUntil },
      provenance: [{ kind: "deadline", target: deadline.id }],
      action: { labelKey: "deadlineProximity.action", href: "/reports#tax-timeline" },
    });
  }
  return observations;
}

/**
 * Vouchers whose evidence packet is missing or empty (Bokföringslagen wants a
 * verification behind every posting). One aggregate warning; the first ≤3
 * vouchers land in provenance as drill targets. SIE-imported vouchers have no
 * voucher rows → captured vouchers only (documented).
 */
export function detectMissingEvidence(snapshot: WorkspaceSnapshot): Observation[] {
  const packetsById = new Map(snapshot.packets.map((packet) => [packet.id, packet]));
  const missing = snapshot.vouchers.filter((voucher) => {
    const packet = packetsById.get(voucher.evidencePacketId);
    return !packet || packet.evidenceIds.length === 0;
  });
  if (missing.length === 0) return [];
  return [
    {
      id: "obs_missing-evidence",
      detector: "missing-evidence",
      severity: "warning",
      titleKey: "missingEvidence.count",
      params: { count: missing.length },
      provenance: missing.slice(0, 3).map((voucher) => ({ kind: "voucher" as const, target: voucher.id })),
      action: { labelKey: "missingEvidence.action", href: "/capture" },
    },
  ];
}

/**
 * Supplier spike: gross this month ≥2× the trailing-3-month average AND
 * ≥500. A positive trailing average is required — without history there is no
 * "typical" to spike against (new suppliers are not spikes; documented).
 */
export function detectSupplierSpike(snapshot: WorkspaceSnapshot, pack: ReportPack): Observation[] {
  const currentMonth = packMonth(pack);
  const currentIndex = monthTokenIndex(currentMonth);
  const bySupplier = new Map<string, { byMonth: Map<string, number>; currentVouchers: string[] }>();

  for (const voucher of snapshot.vouchers) {
    const supplier = voucher.voucherFields.supplierName;
    const gross = voucher.voucherFields.grossAmount;
    if (!supplier || gross === undefined) continue;
    const month = voucherMonth(voucher);
    const entry = bySupplier.get(supplier) ?? { byMonth: new Map<string, number>(), currentVouchers: [] as string[] };
    entry.byMonth.set(month, (entry.byMonth.get(month) ?? 0) + gross);
    if (month === currentMonth) entry.currentVouchers.push(voucher.id);
    bySupplier.set(supplier, entry);
  }

  const observations: Observation[] = [];
  for (const supplier of [...bySupplier.keys()].sort()) {
    const entry = bySupplier.get(supplier)!;
    const amount = entry.byMonth.get(currentMonth);
    if (amount === undefined || amount < SUPPLIER_SPIKE_MIN_AMOUNT) continue;

    let trailingTotal = 0;
    for (const [month, total] of entry.byMonth) {
      const offset = currentIndex - monthTokenIndex(month);
      if (offset >= 1 && offset <= 3) trailingTotal += total;
    }
    const typical = trailingTotal / 3;
    if (typical <= 0) continue;
    if (amount < SUPPLIER_SPIKE_FACTOR * typical) continue;

    observations.push({
      id: `obs_supplier-spike_${supplierSlug(supplier)}`,
      detector: "supplier-spike",
      severity: "warning",
      titleKey: "supplierSpike.spike",
      params: { supplier, amount: round2(amount), typicalAmount: round2(typical) },
      provenance: entry.currentVouchers.slice(0, 3).map((target) => ({ kind: "voucher" as const, target })),
      action: { labelKey: "supplierSpike.action", href: "/books?view=suppliers" },
    });
  }
  return observations;
}

export type BuildObservationsInput = {
  pack: ReportPack;
  snapshot: WorkspaceSnapshot;
  deadlines: TaxDeadline[];
  /** Injected local day (YYYY-MM-DD) — determinism by construction. */
  today: string;
};

/**
 * Run all six detectors, rank (severity → detector priority → id), and bound
 * the result. Pure and deterministic for identical inputs.
 */
export function buildObservations(input: BuildObservationsInput, options: { limit?: number } = {}): Observation[] {
  const limit = options.limit ?? OBSERVATION_LIMIT;
  const observations = [
    ...detectCashRunway(input.pack),
    ...detectExpenseAnomaly(input.snapshot, input.pack),
    ...detectVatSetAside(input.pack),
    ...detectDeadlineProximity(input.deadlines, input.today),
    ...detectMissingEvidence(input.snapshot),
    ...detectSupplierSpike(input.snapshot, input.pack),
  ];
  observations.sort((left, right) => {
    const severity = SEVERITY_PRIORITY[left.severity] - SEVERITY_PRIORITY[right.severity];
    if (severity !== 0) return severity;
    const detector = DETECTOR_PRIORITY[left.detector] - DETECTOR_PRIORITY[right.detector];
    if (detector !== 0) return detector;
    return left.id.localeCompare(right.id);
  });
  return observations.slice(0, limit);
}
