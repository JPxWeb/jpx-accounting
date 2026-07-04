"use client";

import type { ResolvedPeriod } from "@jpx-accounting/domain";
import { currentMonthToken, InvalidPeriodTokenError, resolvePeriodToken } from "@jpx-accounting/domain";
import { useTranslations } from "next-intl";
import { parseAsString, useQueryState } from "nuqs";

import { formatPeriodTokenLabel, type PeriodLabels } from "../components/period/period-options";
import { useWorkspaceProfile } from "../components/providers/workspace-profile-provider";

/**
 * ONE period system (advisory-pivot Phase 4): the `?period=` URL token is
 * resolved through the domain's `resolvePeriodToken` with the workspace
 * profile's fiscal year start — the same resolver the API pack route uses, so
 * client and server can never disagree about a window. Day strings come from
 * local calendar parts, which fixes the old UTC-serialisation month-edge bug
 * (in Stockholm, `2026-07` used to span 2026-06-30…2026-07-30).
 */

/** i18n label callbacks for the unified period grammar (shared with the selector). */
export function usePeriodLabels(): PeriodLabels {
  const t = useTranslations("common.period");
  return {
    ytd: t("ytd"),
    all: t("all"),
    // Years/quarters are passed as strings so ICU never digit-groups them.
    fiscalYear: (year) => t("fiscalYear", { year }),
    quarter: (quarter, year) => t("quarter", { quarter, year }),
  };
}

export function usePeriodScope() {
  const profile = useWorkspaceProfile();
  const labels = usePeriodLabels();
  const [token, setPeriod] = useQueryState("period", parseAsString.withDefault(currentMonthToken()));

  let resolved: ResolvedPeriod;
  try {
    resolved = resolvePeriodToken(token, { fiscalYearStart: profile.fiscalYearStart });
  } catch (error) {
    if (!(error instanceof InvalidPeriodTokenError)) throw error;
    // Unknown token in the URL → fall back to the current month instead of
    // failing the whole screen (the URL keeps the bad token until changed).
    resolved = resolvePeriodToken(currentMonthToken(), { fiscalYearStart: profile.fiscalYearStart });
  }

  return {
    /** Effective period token — the URL value, or the current month after fallback. */
    raw: resolved.token,
    kind: resolved.kind,
    /** YYYY-MM-DD inclusive. */
    from: resolved.from,
    /** YYYY-MM-DD inclusive. */
    to: resolved.to,
    label: formatPeriodTokenLabel(resolved, { locale: profile.locale, labels }),
    setPeriod,
  };
}
