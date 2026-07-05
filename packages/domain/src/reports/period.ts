/**
 * Unified period model (advisory-pivot Phase 4). ONE resolver turns a period
 * token (URL `?period=`, API query param) into an inclusive local-calendar day
 * range — shared by the web client and the API pack route so the two never
 * disagree about what "2026-Q1" means.
 *
 * Token grammar:
 * - `YYYY-MM`  — calendar month (the default granularity).
 * - `YYYY-QN`  — fiscal quarter N (1–4) of the fiscal year STARTING in YYYY;
 *                windows derived from `fiscalYearStart` ("MM-DD", mid-month
 *                starts supported — each quarter spans 3 months anchored on
 *                the start day, day-clamped to short months).
 * - `fy-YYYY`  — the fiscal year starting in YYYY.
 * - `ytd`      — current fiscal year start through `today`.
 * - `all`      — sentinel window `1900-01-01`…`2999-12-31`.
 *
 * All dates are formatted from LOCAL calendar parts — never via
 * `toISOString().slice(0, 10)`, which serialises in UTC and crosses the day
 * boundary in any non-UTC timezone (the live Books `?period=` month-edge bug
 * this module fixes: in Stockholm the naive path made `2026-07` span
 * 2026-06-30…2026-07-30). Downstream day comparisons are string-based on
 * `bookedAt.slice(0, 10)` (see `filterLedgerLines`).
 */

export type PeriodKind = "month" | "quarter" | "fiscal-year" | "ytd" | "all";

export type ResolvedPeriod = {
  token: string;
  kind: PeriodKind;
  /** YYYY-MM-DD inclusive. */
  from: string;
  /** YYYY-MM-DD inclusive. */
  to: string;
  /** Equal-kind preceding window (absent for `all`). */
  previous?: { from: string; to: string };
};

/** Unknown/malformed period token. Mapped to HTTP 422 (CONVENTIONS Rule 16). */
export class InvalidPeriodTokenError extends Error {
  constructor(token: string) {
    super(`Invalid period token: "${token}"`);
    this.name = "InvalidPeriodTokenError";
  }
}

export const ALL_PERIOD_FROM = "1900-01-01";
export const ALL_PERIOD_TO = "2999-12-31";

const MONTH_TOKEN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const QUARTER_TOKEN = /^(\d{4})-Q([1-4])$/;
const FISCAL_YEAR_TOKEN = /^fy-(\d{4})$/;
const FISCAL_YEAR_START = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DAY_STRING = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Month is 1-based (1 = January) everywhere in this module. */
type CalendarDate = { year: number; month: number; day: number };

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

/** Format from calendar parts — the whole point of this module. */
function formatDay(date: CalendarDate): string {
  return `${date.year}-${pad2(date.month)}-${pad2(date.day)}`;
}

/** Clamp the day to the target month length (e.g. 31 → 30 in April). */
function clampedDate(year: number, month: number, day: number): CalendarDate {
  return { year, month, day: Math.min(day, daysInMonth(year, month)) };
}

/** Add whole months, clamping the anchor day to short months. */
function addMonthsClamped(date: CalendarDate, months: number): CalendarDate {
  const zeroBased = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(zeroBased / 12);
  const month = (zeroBased % 12) + 1;
  return clampedDate(year, month, date.day);
}

function previousDay(date: CalendarDate): CalendarDate {
  if (date.day > 1) return { ...date, day: date.day - 1 };
  const month = date.month === 1 ? 12 : date.month - 1;
  const year = date.month === 1 ? date.year - 1 : date.year;
  return { year, month, day: daysInMonth(year, month) };
}

/** Local calendar today as YYYY-MM-DD (never `toISOString().slice`). */
export function localTodayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function parseDayString(value: string): CalendarDate {
  const match = DAY_STRING.exec(value);
  if (!match) {
    throw new Error(`Invalid day string "${value}" — expected YYYY-MM-DD.`);
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function parseFiscalYearStart(value: string): { month: number; day: number } {
  const match = FISCAL_YEAR_START.exec(value);
  if (!match) {
    throw new Error(`Invalid fiscalYearStart "${value}" — expected MM-DD.`);
  }
  return { month: Number(match[1]), day: Number(match[2]) };
}

/** Start date of the fiscal year that begins in `year` (day-clamped). */
function fiscalYearStartDate(year: number, start: { month: number; day: number }): CalendarDate {
  return clampedDate(year, start.month, start.day);
}

/** Inclusive window of quarter `quarter` (1–4) of the fiscal year starting in `fyYear`. */
function quarterWindow(
  fyYear: number,
  quarter: number,
  start: { month: number; day: number },
): { from: CalendarDate; to: CalendarDate } {
  const anchor = { year: fyYear, month: start.month, day: start.day };
  const from = addMonthsClamped(anchor, 3 * (quarter - 1));
  const nextStart = addMonthsClamped(anchor, 3 * quarter);
  return { from, to: previousDay(nextStart) };
}

function fiscalYearWindow(
  fyYear: number,
  start: { month: number; day: number },
): { from: CalendarDate; to: CalendarDate } {
  return {
    from: fiscalYearStartDate(fyYear, start),
    to: previousDay(fiscalYearStartDate(fyYear + 1, start)),
  };
}

/** Fiscal year (start year) containing `date` for the given MM-DD start. */
function fiscalYearContaining(date: CalendarDate, start: { month: number; day: number }): number {
  const sameYearStart = fiscalYearStartDate(date.year, start);
  return formatDay(date) >= formatDay(sameYearStart) ? date.year : date.year - 1;
}

/** Current calendar month token (`YYYY-MM`) from local parts or an injected day. */
export function currentMonthToken(today?: string): string {
  return (today ?? localTodayIso()).slice(0, 7);
}

/**
 * Resolve a period token to an inclusive day range plus its equal-kind
 * preceding window. Unknown tokens throw `InvalidPeriodTokenError` (→ 422).
 */
export function resolvePeriodToken(token: string, opts: { fiscalYearStart: string; today?: string }): ResolvedPeriod {
  const fiscalStart = parseFiscalYearStart(opts.fiscalYearStart);

  const monthMatch = MONTH_TOKEN.exec(token);
  if (monthMatch) {
    const year = Number(monthMatch[1]);
    const month = Number(monthMatch[2]);
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonth = month === 1 ? 12 : month - 1;
    return {
      token,
      kind: "month",
      from: formatDay({ year, month, day: 1 }),
      to: formatDay({ year, month, day: daysInMonth(year, month) }),
      previous: {
        from: formatDay({ year: prevYear, month: prevMonth, day: 1 }),
        to: formatDay({ year: prevYear, month: prevMonth, day: daysInMonth(prevYear, prevMonth) }),
      },
    };
  }

  const quarterMatch = QUARTER_TOKEN.exec(token);
  if (quarterMatch) {
    const fyYear = Number(quarterMatch[1]);
    const quarter = Number(quarterMatch[2]);
    const window = quarterWindow(fyYear, quarter, fiscalStart);
    // Preceding quarter via a global quarter index so Q1 wraps to the
    // previous fiscal year's Q4.
    const index = fyYear * 4 + (quarter - 1) - 1;
    const previous = quarterWindow(Math.floor(index / 4), (index % 4) + 1, fiscalStart);
    return {
      token,
      kind: "quarter",
      from: formatDay(window.from),
      to: formatDay(window.to),
      previous: { from: formatDay(previous.from), to: formatDay(previous.to) },
    };
  }

  const fyMatch = FISCAL_YEAR_TOKEN.exec(token);
  if (fyMatch) {
    const fyYear = Number(fyMatch[1]);
    const window = fiscalYearWindow(fyYear, fiscalStart);
    const previous = fiscalYearWindow(fyYear - 1, fiscalStart);
    return {
      token,
      kind: "fiscal-year",
      from: formatDay(window.from),
      to: formatDay(window.to),
      previous: { from: formatDay(previous.from), to: formatDay(previous.to) },
    };
  }

  if (token === "ytd") {
    const today = parseDayString(opts.today ?? localTodayIso());
    const fyYear = fiscalYearContaining(today, fiscalStart);
    const from = fiscalYearStartDate(fyYear, fiscalStart);
    // Previous window = same span one year earlier (day-clamped, so Feb 29
    // compares against Feb 28 the year before).
    const previousFrom = fiscalYearStartDate(fyYear - 1, fiscalStart);
    const previousTo = clampedDate(today.year - 1, today.month, today.day);
    return {
      token,
      kind: "ytd",
      from: formatDay(from),
      to: formatDay(today),
      previous: { from: formatDay(previousFrom), to: formatDay(previousTo) },
    };
  }

  if (token === "all") {
    return { token, kind: "all", from: ALL_PERIOD_FROM, to: ALL_PERIOD_TO };
  }

  throw new InvalidPeriodTokenError(token);
}
