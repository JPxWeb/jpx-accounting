import type { TaxDeadline, VatPeriod, WorkspaceProfile } from "@jpx-accounting/contracts";

import { localTodayIso, resolvePeriodToken } from "../reports/period";

/**
 * Swedish statutory tax calendar (advisory pivot Phase 5, plan finding 8 —
 * verified against Skatteverket 2026-07-04; yearly-moms branch and INK2
 * corrected/added 2026-08-20 — see docs/findings.md). Deadlines are encoded
 * as DATA with verbatim source strings; every date is computed from LOCAL
 * calendar parts (never `toISOString().slice`).
 *
 * Scope (documented limitations):
 * - SMB rules only (turnover ≤ 40 MSEK): monthly AND quarterly moms are due
 *   the 12th of the SECOND month after the period (17th when the due month is
 *   January or August). The > 40 MSEK variant (26th of the next month) is NOT
 *   encoded.
 * - Quarterly moms periods are CALENDAR quarters (kalenderkvartal, 26 kap.
 *   skatteförfarandelagen (2011:1244)) — statutory momsredovisning periods are
 *   calendar-anchored regardless of the company's fiscal year. For broken
 *   fiscal years that are not calendar-quarter-aligned, the statutory window
 *   has no token in the unified period grammar (fiscal quarters only), so
 *   those deadline rows are date-only: no `periodToken`, `amountRef: null` —
 *   honest over approximate.
 * - Yearly moms branches on `profile.euTrade` (Skatteverket "När ska jag
 *   deklarera moms"): `true` (EU-handel, or no inkomstdeklaration filed) →
 *   the 26th of the second month after the fiscal-year end (27th when the
 *   due month is December); `false` (no EU trade, an inkomstdeklaration is
 *   filed — the common AB case) → the digital date is instead COUPLED to the
 *   income declaration, keyed by the fiscal-year-end month bucket (see
 *   `YEARLY_VAT_NON_EU_DUE_TABLE`). A prior version of this module applied
 *   the 26th-rule unconditionally, which is wrong for any non-EU-trade AB —
 *   see docs/findings.md 2026-08-20.
 * - Income tax return (INK2, aktiebolag, Skatteverket "Deklarera åt ett
 *   aktiebolag"): digital filing date keyed by the same fiscal-year-end month
 *   bucket (see `INK2_DUE_TABLE`), weekend-shifted like every other
 *   Skatteverket deadline below.
 * - Arbetsgivardeklaration + debiterad preliminärskatt (F-skatt): the 12th of
 *   every month (17th in January and August).
 * - Årsredovisning (AB): in by the end of the seventh month after the
 *   fiscal-year end (ÅRL 8 kap. 3 §) — rendered as the statutory month-end
 *   date, deliberately NOT weekend-shifted (the shift is a filing grace, and
 *   showing a later date than the statute would be dishonest).
 * - Weekend shift (Saturday/Sunday → next Monday) applies to the Skatteverket
 *   declaration/payment deadlines. Public-holiday shifts are out of scope.
 */

export const TAX_DEADLINE_SOURCES: Record<string, string> = {
  "sv-vat-12":
    "Skatteverket: Momsdeklaration för företag med beskattningsunderlag om högst 40 miljoner kronor lämnas senast den 12:e i andra månaden efter redovisningsperiodens utgång (den 17:e i januari och augusti).",
  "sv-vat-yearly-26":
    "Skatteverket: Momsdeklaration för helt beskattningsår med EU-handel (eller utan krav på inkomstdeklaration) lämnas senast den 26:e i andra månaden efter beskattningsårets utgång (den 27:e om månaden är december).",
  "sv-vat-yearly-coupled":
    'Skatteverket ("När ska jag deklarera moms"): för helårsmoms utan EU-handel knyts deklarationstidpunkten i stället till inkomstdeklarationen — digitalt senast den 17 augusti (bokslut september–december), den 12 december (bokslut januari–april, samma år), den 17 januari (bokslut maj–juni) eller den 12 april (bokslut juli–augusti), i förekommande fall flyttat till närmast följande vardag.',
  "sv-employer-12":
    "Skatteverket: Arbetsgivardeklaration lämnas senast den 12:e i månaden efter löneutbetalningen (den 17:e i januari och augusti).",
  "sv-fskatt-12":
    "Skatteverket: Debiterad preliminärskatt (F-skatt) ska vara bokförd på Skatteverkets konto senast den 12:e varje månad (den 17:e i januari och augusti).",
  "sv-arsredovisning-7m":
    "Årsredovisningslagen (1995:1554) 8 kap. 3 §: Årsredovisningen ska ha kommit in till Bolagsverket senast sju månader efter räkenskapsårets utgång.",
  "sv-ink2-digital":
    'Skatteverket ("Deklarera åt ett aktiebolag"): digital inkomstdeklaration 2 (INK2) lämnas senast den 1 augusti (bokslut september–december), den 1 december (bokslut januari–april, samma år), den 15 januari (bokslut maj–juni) eller den 1 april (bokslut juli–augusti), i förekommande fall flyttat till närmast följande vardag.',
};

/** Month is 1-based (1 = January). */
type CalendarDate = { year: number; month: number; day: number };

const DAY_STRING = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1]!;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDay(date: CalendarDate): string {
  return `${date.year}-${pad2(date.month)}-${pad2(date.day)}`;
}

function parseDay(value: string): CalendarDate {
  const match = DAY_STRING.exec(value);
  if (!match) {
    throw new Error(`Invalid day string "${value}" — expected YYYY-MM-DD.`);
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** Zero-based month index helpers for month arithmetic without Date objects. */
function monthIndex(date: { year: number; month: number }): number {
  return date.year * 12 + (date.month - 1);
}

function monthFromIndex(index: number): { year: number; month: number } {
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function addDays(date: CalendarDate, days: number): CalendarDate {
  let { year, month, day } = date;
  day += days;
  while (day > daysInMonth(year, month)) {
    day -= daysInMonth(year, month);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return { year, month, day };
}

/** Day of week (0 = Sunday … 6 = Saturday) — UTC-anchored, timezone-free. */
function weekday(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/** Saturday/Sunday → next Monday (Skatteverket deadlines only). */
function shiftWeekendToMonday(date: CalendarDate): CalendarDate {
  const dow = weekday(date);
  if (dow === 6) return addDays(date, 2);
  if (dow === 0) return addDays(date, 1);
  return date;
}

/** The 12th, or the 17th when the due month is January or August. */
function twelfthRuleDay(dueMonth: number): number {
  return dueMonth === 1 || dueMonth === 8 ? 17 : 12;
}

/** The 26th, or the 27th when the due month is December (yearly moms). */
function twentySixthRuleDay(dueMonth: number): number {
  return dueMonth === 12 ? 27 : 26;
}

/**
 * The fiscal-year-end month bucket Skatteverket uses for both the INK2
 * filing date and the non-EU-trade yearly-moms date — both are "coupled to
 * the income declaration": same four windows, different day-of-month tables.
 */
type FyeMonthBucket = "sepDec" | "janApr" | "majJun" | "julAug";

function fyeMonthBucket(month: number): FyeMonthBucket {
  if (month >= 9) return "sepDec"; // September–December
  if (month <= 4) return "janApr"; // January–April
  if (month <= 6) return "majJun"; // May–June
  return "julAug"; // July–August
}

/** One bucketed due date: `yearOffset` 0 keeps the fiscal-year-end's calendar year, 1 moves to the next. */
type BucketedDueRule = { yearOffset: 0 | 1; month: number; day: number };

/** Digital INK2 filing dates by fiscal-year-end month bucket (Skatteverket "Deklarera åt ett aktiebolag"). */
const INK2_DUE_TABLE: Record<FyeMonthBucket, BucketedDueRule> = {
  sepDec: { yearOffset: 1, month: 8, day: 1 },
  janApr: { yearOffset: 0, month: 12, day: 1 },
  majJun: { yearOffset: 1, month: 1, day: 15 },
  julAug: { yearOffset: 1, month: 4, day: 1 },
};

/** Digital non-EU-trade yearly-moms dates, coupled to the INK2 windows (Skatteverket "När ska jag deklarera moms"). */
const YEARLY_VAT_NON_EU_DUE_TABLE: Record<FyeMonthBucket, BucketedDueRule> = {
  sepDec: { yearOffset: 1, month: 8, day: 17 },
  janApr: { yearOffset: 0, month: 12, day: 12 },
  majJun: { yearOffset: 1, month: 1, day: 17 },
  julAug: { yearOffset: 1, month: 4, day: 12 },
};

/** Resolve a fiscal-year-end-bucketed due date from one of the tables above, weekend-shifted. */
function bucketedDueDate(
  fyEnd: { year: number; month: number },
  table: Record<FyeMonthBucket, BucketedDueRule>,
): CalendarDate {
  const rule = table[fyeMonthBucket(fyEnd.month)];
  return shiftWeekendToMonday({ year: fyEnd.year + rule.yearOffset, month: rule.month, day: rule.day });
}

/** Skatteverket due date `monthsAfter` months after `periodEnd`'s month, weekend-shifted. */
function skatteverketDueDate(
  periodEnd: { year: number; month: number },
  monthsAfter: number,
  ruleDay: (dueMonth: number) => number,
): CalendarDate {
  const due = monthFromIndex(monthIndex(periodEnd) + monthsAfter);
  return shiftWeekendToMonday({ year: due.year, month: due.month, day: ruleDay(due.month) });
}

/** Fiscal year (start year) containing `day` for the given MM-DD start. */
function fiscalYearContaining(day: string, fiscalYearStart: string): number {
  const date = parseDay(day);
  const sameYearStart = `${date.year}-${fiscalYearStart}`;
  return day >= sameYearStart ? date.year : date.year - 1;
}

/** Inclusive window of CALENDAR quarter `quarter` (1–4) of `year`. */
function calendarQuarterWindow(year: number, quarter: number): { from: CalendarDate; to: CalendarDate } {
  const endMonth = quarter * 3;
  return {
    from: { year, month: endMonth - 2, day: 1 },
    to: { year, month: endMonth, day: daysInMonth(year, endMonth) },
  };
}

/**
 * The unified `YYYY-QN` (fiscal-grammar) token that resolves to EXACTLY the
 * calendar quarter, or undefined when none exists. A token exists precisely
 * when the fiscal year is calendar-quarter-aligned (starts on the 1st of
 * January, April, July, or October — then every calendar quarter is some
 * fiscal quarter). Verified against `resolvePeriodToken` windows rather than
 * re-deriving the grammar's month/day-clamp rules here.
 */
function calendarQuarterPeriodToken(year: number, quarter: number, fiscalYearStart: string): string | undefined {
  const window = calendarQuarterWindow(year, quarter);
  const from = formatDay(window.from);
  const to = formatDay(window.to);
  for (const fyYear of [year, year - 1]) {
    for (let fiscalQuarter = 1; fiscalQuarter <= 4; fiscalQuarter += 1) {
      const token = `${fyYear}-Q${fiscalQuarter}`;
      const resolved = resolvePeriodToken(token, { fiscalYearStart });
      if (resolved.from === from && resolved.to === to) {
        return token;
      }
    }
  }
  return undefined;
}

/**
 * The unified period token of the VAT period containing `today` — keys the
 * ONE extra `ReportPack` fetch the VAT widget/timeline make (plan finding 15).
 *
 * Quarterly cadence resolves the CALENDAR quarter containing `today` (the
 * statutory momsredovisning period — see module doc). When the fiscal year is
 * not calendar-quarter-aligned that window has no unified-grammar token; we
 * fall back to the current MONTH token: a resolvable, honestly-labeled subset
 * of the statutory quarter. The deadline rows carry no `periodToken` in that
 * case, so the box-49 join never attributes the month figure to a quarter.
 */
export function currentVatPeriodToken(vatPeriod: VatPeriod, fiscalYearStart: string, today?: string): string {
  const day = today ?? localTodayIso();
  if (vatPeriod === "monthly") {
    return day.slice(0, 7);
  }
  if (vatPeriod === "yearly") {
    return `fy-${fiscalYearContaining(day, fiscalYearStart)}`;
  }
  const date = parseDay(day);
  const quarter = Math.floor((date.month - 1) / 3) + 1;
  return calendarQuarterPeriodToken(date.year, quarter, fiscalYearStart) ?? day.slice(0, 7);
}

export type BuildTaxTimelineInput = {
  profile: Pick<WorkspaceProfile, "vatPeriod" | "fiscalYearStart" | "euTrade">;
  /** Injected local day (YYYY-MM-DD) for determinism; defaults to local today. */
  today?: string;
  /** Inclusive upcoming window in days. */
  horizonDays?: number;
  /** Maximum number of deadlines returned. */
  limit?: number;
};

/**
 * Upcoming statutory deadlines for the workspace: next occurrences per kind
 * inside `[today, today + horizonDays]`, sorted by due date (then id for
 * determinism), bounded by `limit`. VAT deadlines carry the unified
 * `periodToken` + `amountRef: "box49"`; employer/F-skatt/annual-report/
 * income-tax-return are date-only (`amountRef: null` — honest, plan finding 15).
 */
export function buildTaxTimeline(input: BuildTaxTimelineInput): TaxDeadline[] {
  const { vatPeriod, fiscalYearStart, euTrade } = input.profile;
  const todayDay = input.today ?? localTodayIso();
  const horizonDays = input.horizonDays ?? 120;
  const limit = input.limit ?? 8;
  const horizonEnd = formatDay(addDays(parseDay(todayDay), horizonDays));

  const deadlines: TaxDeadline[] = [];
  const include = (deadline: TaxDeadline) => {
    if (deadline.dueDate >= todayDay && deadline.dueDate <= horizonEnd) {
      deadlines.push(deadline);
    }
  };

  const todayDate = parseDay(todayDay);
  const todayMonthIndex = monthIndex(todayDate);
  // Enumerate candidate months generously: deadlines trail their period by up
  // to two months, so look back 4 months and forward past the horizon.
  const firstMonth = todayMonthIndex - 4;
  const lastMonth = todayMonthIndex + Math.ceil(horizonDays / 28) + 2;

  for (let index = firstMonth; index <= lastMonth; index += 1) {
    const { year, month } = monthFromIndex(index);
    const monthToken = `${year}-${pad2(month)}`;

    if (vatPeriod === "monthly") {
      include({
        id: `tax_vat_${monthToken}`,
        kind: "vat-return",
        dueDate: formatDay(skatteverketDueDate({ year, month }, 2, twelfthRuleDay)),
        periodLabel: monthToken,
        periodToken: monthToken,
        amountRef: "box49",
        sourceKey: "sv-vat-12",
      });
    }

    // Arbetsgivardeklaration due in month `index` covers the previous month.
    const declared = monthFromIndex(index - 1);
    include({
      id: `tax_employer_${declared.year}-${pad2(declared.month)}`,
      kind: "employer-declaration",
      dueDate: formatDay(shiftWeekendToMonday({ year, month, day: twelfthRuleDay(month) })),
      periodLabel: `${declared.year}-${pad2(declared.month)}`,
      amountRef: null,
      sourceKey: "sv-employer-12",
    });

    // Debiterad preliminärskatt covers the month it is paid in.
    include({
      id: `tax_fskatt_${monthToken}`,
      kind: "f-skatt",
      dueDate: formatDay(shiftWeekendToMonday({ year, month, day: twelfthRuleDay(month) })),
      periodLabel: monthToken,
      amountRef: null,
      sourceKey: "sv-fskatt-12",
    });
  }

  // Quarterly moms: CALENDAR quarters (statutory kalenderkvartal — see module
  // doc), independent of the fiscal year. Iterate calendar years covering the
  // window; `include` filters. The `YYYY-QN` id/label names the CALENDAR
  // quarter (Skatteverket numbering); `periodToken` is the fiscal-grammar
  // token only when one resolves to the same window (calendar-aligned fiscal
  // years), otherwise the row is date-only (`amountRef: null` — honest).
  if (vatPeriod === "quarterly") {
    const lastYear = parseDay(horizonEnd).year;
    for (let year = todayDate.year - 1; year <= lastYear; year += 1) {
      for (let quarter = 1; quarter <= 4; quarter += 1) {
        const quarterEnd = calendarQuarterWindow(year, quarter).to;
        const token = calendarQuarterPeriodToken(year, quarter, fiscalYearStart);
        include({
          id: `tax_vat_${year}-Q${quarter}`,
          kind: "vat-return",
          dueDate: formatDay(skatteverketDueDate(quarterEnd, 2, twelfthRuleDay)),
          periodLabel: `${year}-Q${quarter}`,
          ...(token !== undefined ? { periodToken: token, amountRef: "box49" as const } : { amountRef: null }),
          sourceKey: "sv-vat-12",
        });
      }
    }
  }

  // Fiscal-year-anchored deadlines: iterate nearby fiscal years (cheap) and
  // let the window filter keep what is actually upcoming.
  for (let fyYear = todayDate.year - 2; fyYear <= todayDate.year + 1; fyYear += 1) {
    const fyToken = `fy-${fyYear}`;
    const window = resolvePeriodToken(fyToken, { fiscalYearStart, today: todayDay });
    const fyEnd = parseDay(window.to);

    if (vatPeriod === "yearly") {
      include({
        id: `tax_vat_${fyToken}`,
        kind: "vat-return",
        dueDate: euTrade
          ? formatDay(skatteverketDueDate(fyEnd, 2, twentySixthRuleDay))
          : formatDay(bucketedDueDate(fyEnd, YEARLY_VAT_NON_EU_DUE_TABLE)),
        periodLabel: `FY ${fyYear}`,
        periodToken: fyToken,
        amountRef: "box49",
        sourceKey: euTrade ? "sv-vat-yearly-26" : "sv-vat-yearly-coupled",
      });
    }

    // Årsredovisning: end of the seventh month after the FY-end month when the
    // FY ends at a month end (the statutory table Bolagsverket publishes);
    // mid-month FY ends keep their anchor day, clamped to short months.
    const dueMonth = monthFromIndex(monthIndex(fyEnd) + 7);
    const fyEndsAtMonthEnd = fyEnd.day === daysInMonth(fyEnd.year, fyEnd.month);
    const dueDay = fyEndsAtMonthEnd
      ? daysInMonth(dueMonth.year, dueMonth.month)
      : Math.min(fyEnd.day, daysInMonth(dueMonth.year, dueMonth.month));
    include({
      id: `tax_arsredovisning_${fyToken}`,
      kind: "annual-report",
      // Deliberately NOT weekend-shifted — see module doc.
      dueDate: formatDay({ year: dueMonth.year, month: dueMonth.month, day: dueDay }),
      periodLabel: `FY ${fyYear}`,
      amountRef: null,
      sourceKey: "sv-arsredovisning-7m",
    });

    // Inkomstdeklaration 2 (INK2): unconditional for the AB this product
    // serves — the digital filing date is keyed by the fiscal-year-end month
    // bucket, weekend-shifted like the other Skatteverket deadlines.
    include({
      id: `tax_ink2_${fyToken}`,
      kind: "income-tax-return",
      dueDate: formatDay(bucketedDueDate(fyEnd, INK2_DUE_TABLE)),
      periodLabel: `FY ${fyYear}`,
      amountRef: null,
      sourceKey: "sv-ink2-digital",
    });
  }

  deadlines.sort((left, right) =>
    left.dueDate === right.dueDate ? left.id.localeCompare(right.id) : left.dueDate.localeCompare(right.dueDate),
  );
  return deadlines.slice(0, limit);
}
