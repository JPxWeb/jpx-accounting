export function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function nowIso() {
  return new Date().toISOString();
}

/** UTC calendar day in `YYYY-MM-DD` form. Wraps `nowIso().slice(0, 10)` so
 *  compliance detection and other day-grain logic do not have to repeat the
 *  slice (and so future timezone tightening lives in one place). */
export function today(): string {
  return nowIso().slice(0, 10);
}
