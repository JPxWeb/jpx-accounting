import type { ReportPack, ReviewTask } from "@jpx-accounting/contracts";
import { buildKpis } from "@jpx-accounting/reporting";

/**
 * Structural view of an observation (Task 5.3 `observationSchema`). Declared
 * structurally — not imported from contracts — so this package only depends
 * on the fields it reads; the real `Observation` contract type is assignable.
 */
export interface GroundingObservation {
  detector: string;
  severity: string;
  titleKey: string;
  params: Record<string, string | number>;
}

/** Structural view of a tax deadline (Task 5.2 `taxDeadlineSchema`) — same rationale as `GroundingObservation`. */
export interface GroundingDeadline {
  kind: string;
  dueDate: string;
  periodLabel: string;
}

export interface AdvisorGroundingInput {
  pack: ReportPack;
  observations: readonly GroundingObservation[];
  deadlines: readonly GroundingDeadline[];
  pendingReviews: readonly ReviewTask[];
  /**
   * Formatter applied to UNTRUSTED, evidence-derived strings — review titles
   * and string-valued observation params (OCR'd supplier names travel there;
   * WS-D R22). The LLM-bound path passes `delimitUntrustedText` so hostile
   * document text is sanitized and wrapped in explicit DATA delimiters; the
   * deterministic demo/display path omits it (identity — no LLM, no injection
   * surface). Numeric params and system-derived fields (period tokens, KPI
   * numbers, deadline dates, registry account names) are never untrusted and
   * bypass the formatter.
   */
  formatUntrusted?: ((value: string) => string) | undefined;
}

/** Keep the block compact: list at most this many pending reviews individually. */
const MAX_LISTED_REVIEWS = 3;

/**
 * Build the compact factual block that grounds an advisor turn (demo template
 * or LLM system prompt). Every number is COPIED from the report pack via
 * `buildKpis` / the pack itself — nothing is computed here, so the block
 * reconciles with the reports screen by construction. Deterministic: no
 * clock, no locale formatting, stable ordering (inputs are emitted in the
 * order given — detectors and deadlines arrive pre-ranked).
 */
export function buildAdvisorGrounding({
  pack,
  observations,
  deadlines,
  pendingReviews,
  formatUntrusted,
}: AdvisorGroundingInput): string {
  const untrusted = formatUntrusted ?? ((value: string) => value);
  const kpis = buildKpis(pack);
  const lines: string[] = [];

  lines.push("FAKTAUNDERLAG (siffror kopierade från rapportpaketet — aldrig beräknade här):");
  lines.push(`Period: ${pack.period.token} (${pack.period.from} till ${pack.period.to})`);
  lines.push(`- Periodens resultat: ${kpis.result}`);
  lines.push(`- Kassa (19xx) vid periodens slut: ${kpis.cash} (ingående ${pack.cashBridge.opening})`);
  lines.push(`- Intäkter i perioden: ${kpis.revenue}`);
  lines.push(`- Moms ruta 49: ${kpis.vat} (positivt = att betala, negativt = att få tillbaka)`);

  if (deadlines.length > 0) {
    lines.push("Kommande datum:");
    for (const deadline of deadlines) {
      lines.push(`- ${deadline.kind}: ${deadline.dueDate} (${deadline.periodLabel})`);
    }
  }

  if (observations.length > 0) {
    lines.push("Observationer (deterministiska detektorer över samma rapportpaket):");
    for (const observation of observations) {
      const params = Object.entries(observation.params)
        // String param values can carry evidence-derived text (e.g. the
        // supplier-spike detector's OCR'd supplier name) → untrusted. Numbers
        // are copied report-pack figures → trusted as-is.
        .map(([key, value]) => `${key}=${typeof value === "string" ? untrusted(value) : value}`)
        .join(", ");
      lines.push(
        `- ${observation.detector} (${observation.severity}): ${observation.titleKey}${params ? ` [${params}]` : ""}`,
      );
    }
  }

  lines.push(`Granskningskö: ${pendingReviews.length} väntar på mänskligt beslut`);
  for (const review of pendingReviews.slice(0, MAX_LISTED_REVIEWS)) {
    const suggestion = review.suggestion
      ? ` — förslag ${review.suggestion.accountNumber} ${review.suggestion.accountName}, momskod ${review.suggestion.vatCode}`
      : "";
    // Review titles derive from captured evidence (supplier names, free-text
    // descriptions) → untrusted (WS-D R22).
    lines.push(`- ${untrusted(review.title)} (${review.id})${suggestion}`);
  }

  return lines.join("\n");
}
