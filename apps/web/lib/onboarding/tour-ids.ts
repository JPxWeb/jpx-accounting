export const TOUR_IDS = [
  "app-orientation",
  "capture-flow",
  "review-gate",
  "books-period",
  "reports-drill",
  "advisor",
  "hint-mobile-advisor",
  "hint-reports-drill",
] as const;

export type TourId = (typeof TOUR_IDS)[number];

/** Checklist step keys that launch a workflow tour via "Guide me". */
export const CHECKLIST_TOUR_BY_STEP = {
  capture: "capture-flow",
  approve: "review-gate",
  import: "capture-flow",
  advisor: "advisor",
} as const satisfies Partial<Record<string, TourId>>;

export function isTourId(value: string): value is TourId {
  return (TOUR_IDS as readonly string[]).includes(value);
}
