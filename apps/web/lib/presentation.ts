export const APP_THEME_COLOR = "#0f766e";
export const APP_BACKGROUND_COLOR = "#e9eff2";

const moneyFormatter = new Intl.NumberFormat("sv-SE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const shortDateFormatter = new Intl.DateTimeFormat("sv-SE", {
  month: "short",
  day: "numeric",
});

export function formatMoney(value = 0) {
  return `${moneyFormatter.format(value)} SEK`;
}

export function formatShortDate(value?: string, fallback = "Today") {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return shortDateFormatter.format(date);
}

export function formatPercent(value = 0, fractionDigits = 0) {
  return new Intl.NumberFormat("sv-SE", {
    style: "percent",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatRuntimeModeLabel(runtimeMode: "normal" | "demo") {
  return runtimeMode === "demo" ? "Demo mode" : "Normal mode";
}
