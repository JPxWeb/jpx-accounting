import type { ResolvedPeriod } from "@jpx-accounting/domain";
import { currentMonthToken, resolvePeriodToken } from "@jpx-accounting/domain";

/**
 * Grouped period presets for the shared PeriodSelector (advisory-pivot
 * Phase 4). Pure module — i18n strings arrive via `PeriodLabels` so the
 * grouping/token logic stays testable and framework-free. Tokens follow the
 * unified grammar in `@jpx-accounting/domain` (`resolvePeriodToken`).
 */

export type PeriodLabels = {
  /** "Year to date" / "Hittills i år". */
  ytd: string;
  /** "All periods" / "Alla perioder". */
  all: string;
  /** Year is passed as a string so ICU number formatting never groups digits. */
  fiscalYear: (year: string) => string;
  /** Quarter (1–4) + fiscal-year START year, both as strings. */
  quarter: (quarter: string, year: string) => string;
};

export type PeriodOption = { value: string; label: string };

export type PeriodOptionGroup = {
  key: "months" | "quarters" | "year";
  options: PeriodOption[];
};

/**
 * Month label for a `YYYY-MM` token. The Date is used for FORMATTING only —
 * day windows always come from `resolvePeriodToken`'s local calendar parts,
 * never from `toISOString()` (the old Books month-edge bug).
 */
function monthLabel(token: string, locale: string): string {
  const year = Number(token.slice(0, 4));
  const month = Number(token.slice(5, 7));
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

/** Human label for any token in the unified period grammar. */
export function formatPeriodTokenLabel(period: ResolvedPeriod, opts: { locale: string; labels: PeriodLabels }): string {
  switch (period.kind) {
    case "month":
      return monthLabel(period.token, opts.locale);
    case "quarter": {
      const [year = "", quarter = ""] = period.token.split("-Q");
      return opts.labels.quarter(quarter, year);
    }
    case "fiscal-year":
      return opts.labels.fiscalYear(period.token.slice(3));
    case "ytd":
      return opts.labels.ytd;
    case "all":
      return opts.labels.all;
  }
}

/**
 * Grouped options: last 12 months · current fiscal year's quarters · ytd +
 * current/previous fiscal year + all. The fiscal year containing "today" is
 * derived through the resolver so the selector and the API can never disagree.
 */
export function buildPeriodOptionGroups(opts: {
  locale: string;
  fiscalYearStart: string;
  labels: PeriodLabels;
  /** Injected YYYY-MM-DD "today" (tests); defaults to the local calendar today. */
  today?: string;
}): PeriodOptionGroup[] {
  const resolverOpts = {
    fiscalYearStart: opts.fiscalYearStart,
    ...(opts.today !== undefined ? { today: opts.today } : {}),
  };

  const months: PeriodOption[] = [];
  let year = Number(currentMonthToken(opts.today).slice(0, 4));
  let month = Number(currentMonthToken(opts.today).slice(5, 7));
  for (let index = 0; index < 12; index += 1) {
    const token = `${year}-${String(month).padStart(2, "0")}`;
    months.push({ value: token, label: monthLabel(token, opts.locale) });
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }

  const ytd = resolvePeriodToken("ytd", resolverOpts);
  const fiscalYear = Number(ytd.from.slice(0, 4));

  const quarters: PeriodOption[] = [1, 2, 3, 4].map((quarter) => ({
    value: `${fiscalYear}-Q${quarter}`,
    label: opts.labels.quarter(String(quarter), String(fiscalYear)),
  }));

  const yearOptions: PeriodOption[] = [
    { value: "ytd", label: opts.labels.ytd },
    { value: `fy-${fiscalYear}`, label: opts.labels.fiscalYear(String(fiscalYear)) },
    { value: `fy-${fiscalYear - 1}`, label: opts.labels.fiscalYear(String(fiscalYear - 1)) },
    { value: "all", label: opts.labels.all },
  ];

  return [
    { key: "months", options: months },
    { key: "quarters", options: quarters },
    { key: "year", options: yearOptions },
  ];
}
