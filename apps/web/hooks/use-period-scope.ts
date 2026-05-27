"use client";

import { parseAsString, useQueryState } from "nuqs";

export type Period = { start: string; end: string; label: string };

function currentMonthIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function parsePeriod(period: string): Period {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return { start: "", end: "", label: period };
  const start = new Date(year, month - 1, 1).toISOString().slice(0, 10);
  const end = new Date(year, month, 0).toISOString().slice(0, 10);
  const label = new Date(year, month - 1, 1).toLocaleDateString("sv-SE", {
    year: "numeric",
    month: "long",
  });
  return { start, end, label };
}

export function usePeriodScope() {
  const [period, setPeriod] = useQueryState("period", parseAsString.withDefault(currentMonthIso()));
  const parsed = parsePeriod(period);
  return { period: parsed, setPeriod, raw: period };
}
