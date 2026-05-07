export type ReportPeriodPreset = "this-month" | "last-month" | "q1" | "q2" | "q3" | "q4" | "ytd" | "all";

/** Inclusive ISO day range in local calendar (start 00:00, end 23:59:59.999). */
export function getPeriodDayRange(
  preset: ReportPeriodPreset,
  reference: Date = new Date(),
): { startDay: string; endDay: string } {
  const y = reference.getFullYear();
  const m = reference.getMonth();

  // Format using local calendar parts. Using d.toISOString() here would
  // serialise in UTC and cross the day boundary in any non-UTC timezone,
  // silently mis-filtering journal entries at month edges.
  const isoDay = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  if (preset === "all") {
    return { startDay: "1900-01-01", endDay: "2999-12-31" };
  }

  if (preset === "this-month") {
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 0, 23, 59, 59, 999);
    return { startDay: isoDay(start), endDay: isoDay(end) };
  }

  if (preset === "last-month") {
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0, 23, 59, 59, 999);
    return { startDay: isoDay(start), endDay: isoDay(end) };
  }

  if (preset === "ytd") {
    const start = new Date(y, 0, 1);
    const end = new Date(reference);
    end.setHours(23, 59, 59, 999);
    return { startDay: isoDay(start), endDay: isoDay(end) };
  }

  const quarterStarts: Record<"q1" | "q2" | "q3" | "q4", [number, number]> = {
    q1: [0, 2],
    q2: [3, 5],
    q3: [6, 8],
    q4: [9, 11],
  };
  const [sm, em] = quarterStarts[preset];
  const start = new Date(y, sm, 1);
  const end = new Date(y, em + 1, 0, 23, 59, 59, 999);
  return { startDay: isoDay(start), endDay: isoDay(end) };
}

export function journalEntryInPeriod(bookedAt: string, startDay: string, endDay: string): boolean {
  const day = bookedAt.slice(0, 10);
  return day >= startDay && day <= endDay;
}
