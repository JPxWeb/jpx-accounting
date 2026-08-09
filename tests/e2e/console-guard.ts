import { expect, type ConsoleMessage, type Page } from "@playwright/test";

/**
 * Fail E2E on any `console.error` or uncaught `pageerror`.
 *
 * P0-5: the previous guard only matched hydration / intl noise, so "Maximum
 * update depth exceeded" and "module factory is not available" could green
 * the suite while every shell route was unusable. Invert that predicate —
 * fail on every error, with a short commented allowlist for known-benign
 * entries only.
 *
 * Prefer fixing the emitter over adding to the allowlist. P0-6's React
 * script-tag warning is intentionally NOT listed here: re-check after P0-1 /
 * P0-2; if it still appears, name the emitter before silencing.
 */

/**
 * Exact / regex allowlist for known-benign `console.error` / `pageerror` text.
 * Keep short. Each entry must document why it is allowed.
 *
 * Still NOT allowlisted (re-check; prefer fix over silence):
 * - React “Cannot render a <script> …” / App Router script-tag warning (P0-6)
 * - “Maximum update depth exceeded” (P0-1 class)
 * - “module factory is not available” (P0-2/P0-3 class)
 */
const ALLOWED_ERROR_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  // Production `next start` minifies hydration mismatches to #418 with no
  // “hydrat” substring — the pre-P0-5 regex was blind to this. Observed as an
  // intermittent pageerror on `/today` (dashboard) even after theme pin +
  // P0-1/P0-2; React recovers and the UI stays usable. Remove once the
  // emitter is named/fixed (correlate with AppShell timestamp / nuqs / dnd).
  // https://react.dev/errors/418
  {
    pattern: /Minified React error #418\b/,
    reason: "Intermittent recoverable hydration mismatch under next start (emitter TBD)",
  },
];

function isAllowlisted(text: string): boolean {
  return ALLOWED_ERROR_PATTERNS.some(({ pattern }) => pattern.test(text));
}

export type ConsoleGuard = {
  /** Assert no non-allowlisted console.error / pageerror was recorded. */
  assertClean: () => void;
  /** Collected problem lines (for diagnostics). */
  problems: readonly string[];
};

/**
 * Pin next-themes + `prefers-color-scheme` before the first paint so system
 * theme cannot race the SSR HTML class (intermittent React #418 on `<html>`).
 * Same pattern as `visual-regression.spec.ts`. Call before `goto`.
 */
export async function stabilizeThemeForConsoleGuard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("theme", "light");
  });
  await page.emulateMedia({ colorScheme: "light" });
}

/**
 * Attach listeners before navigation. Call `assertClean()` at the end of the
 * interaction under test.
 */
export function attachConsoleGuard(page: Page): ConsoleGuard {
  const problems: string[] = [];

  const record = (kind: "console.error" | "pageerror", text: string) => {
    if (isAllowlisted(text)) return;
    problems.push(`[${kind}] ${text}`);
  };

  page.on("console", (message: ConsoleMessage) => {
    if (message.type() !== "error") return;
    record("console.error", message.text());
  });

  page.on("pageerror", (error: Error) => {
    record("pageerror", error.message || String(error));
  });

  return {
    problems,
    assertClean: () => {
      expect(problems, problems.join("\n---\n")).toEqual([]);
    },
  };
}

/**
 * Theme pin + console/pageerror listeners. Prefer this over bare
 * `attachConsoleGuard` for shell-route smoke coverage.
 */
export async function installConsoleGuard(page: Page): Promise<ConsoleGuard> {
  await stabilizeThemeForConsoleGuard(page);
  return attachConsoleGuard(page);
}
