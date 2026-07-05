import type { WorkspaceProfile } from "@jpx-accounting/contracts";

export const APP_THEME_COLOR = "#0f766e";
export const APP_BACKGROUND_COLOR = "#e9eff2";

export type MoneyFormatProfile = Pick<WorkspaceProfile, "locale" | "currency">;

// Intl constructors are expensive; instances are memoized per locale/currency
// combination. Keys are namespaced so money/percent formatters never collide.
const numberFormatters = new Map<string, Intl.NumberFormat>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function getMoneyFormatter(locale: string, currency: string) {
  const key = `money|${locale}|${currency}`;
  let formatter = numberFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "code",
    });
    numberFormatters.set(key, formatter);
  }
  return formatter;
}

function getPercentFormatter(locale: string, fractionDigits: number) {
  const key = `percent|${locale}|${fractionDigits}`;
  let formatter = numberFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: "percent",
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    numberFormatters.set(key, formatter);
  }
  return formatter;
}

function getShortDateFormatter(locale: string) {
  let formatter = dateFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
    });
    dateFormatters.set(locale, formatter);
  }
  return formatter;
}

export function formatMoney(value: number | undefined, profile: MoneyFormatProfile): string {
  return getMoneyFormatter(profile.locale, profile.currency).format(value ?? 0);
}

export function formatShortDate(value: string | undefined, locale: string, fallback = "Today"): string {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return getShortDateFormatter(locale).format(date);
}

export function formatPercent(value: number, locale: string, fractionDigits = 0): string {
  return getPercentFormatter(locale, fractionDigits).format(value);
}

export function formatRuntimeModeLabel(runtimeMode: "normal" | "demo") {
  return runtimeMode === "demo" ? "Demo mode" : "Normal mode";
}
