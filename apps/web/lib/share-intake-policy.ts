import type { RuntimeMode } from "@jpx-accounting/contracts";

/**
 * P0-4 / Wave Share′ (S-fail) decision for shared *files*.
 * Pure so unit tests can pin the policy without importing the Next route
 * (which pulls in `server-only` via server-runtime-config).
 *
 * - `normal` → refuse (no bearer on the server intake; never silent 401).
 * - `demo` + API → forward through the real pipeline.
 * - `demo` without API → legacy pending banner only.
 */
export type ShareFileIntakeDecision =
  | { kind: "refuse-auth"; pending: number }
  | { kind: "forward" }
  | { kind: "pending-unreachable"; pending: number }
  | { kind: "noop" };

export function decideShareFileIntake(input: {
  fileCount: number;
  runtimeMode: RuntimeMode;
  apiBaseUrl: string | undefined;
}): ShareFileIntakeDecision {
  if (input.fileCount <= 0) return { kind: "noop" };
  if (input.runtimeMode === "normal") {
    return { kind: "refuse-auth", pending: input.fileCount };
  }
  if (input.apiBaseUrl) return { kind: "forward" };
  return { kind: "pending-unreachable", pending: input.fileCount };
}
