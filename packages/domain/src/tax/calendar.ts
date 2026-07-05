import type { TaxDeadline, VatPeriod, WorkspaceProfile } from "@jpx-accounting/contracts";

import { localTodayIso, resolvePeriodToken } from "../reports/period";

/**
 * Swedish statutory tax calendar (advisory pivot Phase 5, plan finding 8 —
 * verified against Skatteverket 2026-07-04). Deadlines are encoded as DATA
 * with verbatim source strings; every date is computed from LOCAL calendar
 * parts (never `toISOString().slice`).
 *
 * Scope (documented limitations):
 * - SMB rules only (turnover ≤ 40 MSEK): monthly AND quarterly moms are due
 *   the 12th of the SECOND month after the period (17th when the due month is
 *   January or August). The > 40 MSEK variant (26th of the next month) is NOT
 *   encoded.
 * - Yearly moms (no EU trade): 26th of the second month after the fiscal-year
 *   end (27th when the due month is December).
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
    "Skatteverket: Momsdeklaration för helt beskattningsår utan EU-handel lämnas senast den 26:e i andra månaden efter beskattningsårets utgång (den 27:e om månaden är december).",
  "sv-employer-12":
    "Skatteverket: Arbetsgivardeklaration lämnas senast den 12:e i månaden efter löneutbetalningen (den 17:e i januari och augusti).",
  "sv-fskatt-12":
    "Skatteverket: Debiterad preliminärskatt (F-skatt) ska vara bokförd på Skatteverkets konto senast den 12:e varje månad (den 17:e i januari och augusti).",
  "sv-arsredovisning-7m":
    "Årsredovisningslagen (1995:1554) 8 kap. 3 §: Årsredovisningen ska ha kommit in till Bolagsverket senast sju månader efter räkenskapsårets utgång.",
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

/**
 * The unified period token of the VAT period containing `today` — keys the
 * ONE extra `ReportPack` fetch the VAT widget/timeline make (plan finding 15).
 */
export function currentVatPeriodToken(vatPeriod: VatPeriod, fiscalYearStart: string, today?: string): string {
  const day = today ?? localTodayIso();
  if (vatPeriod === "monthly") {
    return day.slice(0, 7);
  }
  const fyYear = fiscalYearContaining(day, fiscalYearStart);
  if (vatPeriod === "yearly") {
    return `fy-${fyYear}`;
  }
  for (let quarter = 1; quarter <= 4; quarter += 1) {
    const token = `${fyYear}-Q${quarter}`;
    const window = resolvePeriodToken(token, { fiscalYearStart, today: day });
    if (day >= window.from && day <= window.to) {
      return token;
    }
  }
  // Unreachable: the four quarters tile the fiscal year.
  return `${fyYear}-Q4`;
}

export type BuildTaxTimelineInput = {
  profile: Pick<WorkspaceProfile, "vatPeriod" | "fiscalYearStart">;
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
 * `periodToken` + `amountRef: "box49"`; employer/F-skatt/annual-report are
 * date-only (`amountRef: null` — honest, plan finding 15).
 */
export function buildTaxTimeline(input: BuildTaxTimelineInput): TaxDeadline[] {
  const { vatPeriod, fiscalYearStart } = input.profile;
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

  // Fiscal-year-anchored deadlines: iterate nearby fiscal years (cheap) and
  // let the window filter keep what is actually upcoming.
  for (let fyYear = todayDate.year - 2; fyYear <= todayDate.year + 1; fyYear += 1) {
    const fyToken = `fy-${fyYear}`;
    const window = resolvePeriodToken(fyToken, { fiscalYearStart, today: todayDay });
    const fyEnd = parseDay(window.to);

    if (vatPeriod === "quarterly") {
      for (let quarter = 1; quarter <= 4; quarter += 1) {
        const token = `${fyYear}-Q${quarter}`;
        const quarterWindow = resolvePeriodToken(token, { fiscalYearStart, today: todayDay });
        const quarterEnd = parseDay(quarterWindow.to);
        include({
          id: `tax_vat_${token}`,
          kind: "vat-return",
          dueDate: formatDay(skatteverketDueDate(quarterEnd, 2, twelfthRuleDay)),
          periodLabel: token,
          periodToken: token,
          amountRef: "box49",
          sourceKey: "sv-vat-12",
        });
      }
    }

    if (vatPeriod === "yearly") {
      include({
        id: `tax_vat_${fyToken}`,
        kind: "vat-return",
        dueDate: formatDay(skatteverketDueDate(fyEnd, 2, twentySixthRuleDay)),
        periodLabel: `FY ${fyYear}`,
        periodToken: fyToken,
        amountRef: "box49",
        sourceKey: "sv-vat-yearly-26",
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
  }

  deadlines.sort((left, right) =>
    left.dueDate === right.dueDate ? left.id.localeCompare(right.id) : left.dueDate.localeCompare(right.dueDate),
  );
  return deadlines.slice(0, limit);
}
