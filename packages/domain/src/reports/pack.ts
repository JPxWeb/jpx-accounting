import type { ReportPack } from "@jpx-accounting/contracts";

import { defaultCoaTemplate } from "../coa/registry";
import type { CoaTemplate } from "../coa/types";
import { nowIso } from "../ids";
import type { LedgerLine } from "../projections";
import { filterLedgerLines } from "../projections";
import { buildVatReturnBoxes } from "../vat/boxes";
import type { VatRegime } from "../vat/regime";
import { swedishVatRegime } from "../vat/regime";
import { buildCashBridge, buildMonthlySeries } from "./cash";
import { resolvePeriodToken } from "./period";
import { buildBalanceSheet, buildProfitLoss } from "./statements";

export type BuildReportPackInput = {
  /** Period token per the unified grammar (`resolvePeriodToken`). */
  periodToken: string;
  /** MM-DD fiscal year start from the workspace profile. */
  fiscalYearStart: string;
  /** Injected YYYY-MM-DD "today" for `ytd` (defaults to local calendar today). */
  today?: string;
  coa?: CoaTemplate;
  regime?: VatRegime;
};

/**
 * Compose the full `ReportPack` for one resolved period (advisory-pivot
 * Phase 4). ONE pack is the single source object for the reports screen —
 * prose, KPIs, charts, and tables all render from the same values. Derived
 * read model only: nothing here mutates or appends events.
 *
 * Invalid tokens propagate `InvalidPeriodTokenError` (→ HTTP 422, Rule 16).
 * VAT boxes are computed over the SELECTED window (statutory VAT-period
 * configuration is a later phase). The previous-window P&L is included
 * whenever the period defines an equal-kind preceding window.
 */
export function buildReportPack(lines: LedgerLine[], input: BuildReportPackInput): ReportPack {
  const period = resolvePeriodToken(input.periodToken, {
    fiscalYearStart: input.fiscalYearStart,
    ...(input.today !== undefined ? { today: input.today } : {}),
  });
  const coa = input.coa ?? defaultCoaTemplate;
  const regime = input.regime ?? swedishVatRegime;
  const range = { from: period.from, to: period.to };

  const profitLoss = buildProfitLoss(lines, range, coa);
  const previousProfitLoss = period.previous ? buildProfitLoss(lines, period.previous, coa) : undefined;
  const balanceSheet = buildBalanceSheet(lines, period.to, coa);
  const vatReturn = buildVatReturnBoxes(filterLedgerLines(lines, range), regime);
  const cashBridge = buildCashBridge(lines, range);
  const monthly = buildMonthlySeries(lines, period.to.slice(0, 7), 12, coa);

  return {
    period: { token: period.token, kind: period.kind, from: period.from, to: period.to },
    ...(period.previous ? { previousPeriod: { ...period.previous } } : {}),
    profitLoss,
    ...(previousProfitLoss ? { previousProfitLoss } : {}),
    balanceSheet,
    vatReturn,
    cashBridge,
    monthly,
    generatedAt: nowIso(),
  };
}
