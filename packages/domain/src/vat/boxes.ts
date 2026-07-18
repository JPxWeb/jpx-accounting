import { classifyAccountNumber, getCoaTemplate } from "../coa/registry";
import type { LedgerLine } from "../projections";
import type { VatRateId, VatRegime } from "./regime";
import { swedishVatRegime } from "./regime";

const RATED_VAT_CODES = new Set<string>(["VAT25", "VAT12", "VAT6"]);

/**
 * Declaration-boundary rounding: momsdeklaration amounts are WHOLE KRONOR —
 * "öretal faller bort" (the öre digits are dropped, i.e. truncation toward
 * zero, also for negative amounts) per 22 kap. 1 § skatteförfarandeförordningen
 * (2011:1261) and Skatteverket e-service practice. This applies ONLY here, at
 * the declaration boundary — internal ledger lines, projections (`buildVat`),
 * and simulations stay öre-exact.
 */
function toWholeKronor(amount: number): number {
  const whole = Math.trunc(amount);
  return whole === 0 ? 0 : whole; // normalize -0
}

/**
 * Map posted ledger lines onto the regime's VAT-return box subset.
 *
 * Computed boxes: sales base (05) from lines whose OWN `vatCode` is rated and
 * whose account classifies as revenue (template lookup with BAS first-digit
 * fallback, so off-template revenue accounts from SIE imports/edits still
 * count — attribution follows the booked VAT decision on the line, never the
 * template account's default code), output VAT (10–12) from the regime's
 * output accounts, input VAT (48) from the regime's input accounts, and net
 * (49) = output − input. Purchase-base and reverse-charge boxes (20/21/30–32)
 * are modeled in regime data but return 0 until reverse-charge postings exist.
 *
 * All box amounts are whole kronor (see `toWholeKronor`); box 49 is computed
 * FROM the truncated component boxes — not truncated from the öre-exact net —
 * so the declaration stays internally consistent (49 = 10+11+12+30+31+32 − 48
 * over the declared values, matching how Skatteverket derives it).
 */
export function buildVatReturnBoxes(
  lines: LedgerLine[],
  regime: VatRegime = swedishVatRegime,
): Array<{ box: string; label: string; amount: number }> {
  const coa = getCoaTemplate(regime.country);
  const accountByRate = new Map<VatRateId, string>(
    (Object.entries(regime.accounts.outputByRate) as Array<[VatRateId, string]>).map(([rate, number]) => [
      rate,
      number,
    ]),
  );

  let salesBase = 0;
  let inputVat = 0;
  const outputVatByRate = new Map<VatRateId, number>();

  for (const line of lines) {
    if (regime.accounts.input.includes(line.accountNumber)) {
      inputVat += line.debit - line.credit;
      continue;
    }
    for (const [rate, accountNumber] of accountByRate) {
      if (line.accountNumber === accountNumber) {
        outputVatByRate.set(rate, (outputVatByRate.get(rate) ?? 0) + line.credit - line.debit);
      }
    }
    // Box 05: the line's actual vatCode decides ratedness (a momsfri line on a
    // normally-rated account stays out); revenue classification keeps cost
    // lines that also carry rated codes out of the sales base. VAT accounts
    // classify as equity-liability, so they never double into the base.
    if (RATED_VAT_CODES.has(line.vatCode) && classifyAccountNumber(line.accountNumber, coa) === "revenue") {
      salesBase += line.credit - line.debit;
    }
  }

  // Truncate each component box to whole kronor at the boundary, THEN derive
  // the net from the truncated values (sum consistency — see doc above).
  const wholeSalesBase = toWholeKronor(salesBase);
  const wholeInputVat = toWholeKronor(inputVat);
  const wholeOutputVatByRate = new Map<VatRateId, number>(
    [...outputVatByRate].map(([rate, amount]) => [rate, toWholeKronor(amount)]),
  );
  const totalOutputVat = [...wholeOutputVatByRate.values()].reduce((sum, amount) => sum + amount, 0);

  // Output-vat amounts go to the FIRST box declared for a rate (10–12); later
  // boxes sharing the rate (30–32, reverse charge) stay 0 until modeled.
  const consumedRates = new Set<VatRateId>();

  return regime.boxes.map((def) => {
    let amount = 0;
    switch (def.kind) {
      case "sales-base":
        amount = wholeSalesBase;
        break;
      case "output-vat":
        if (def.rate && !consumedRates.has(def.rate)) {
          consumedRates.add(def.rate);
          amount = wholeOutputVatByRate.get(def.rate) ?? 0;
        }
        break;
      case "purchase-base":
        amount = 0;
        break;
      case "input-vat":
        amount = wholeInputVat;
        break;
      case "net":
        amount = totalOutputVat - wholeInputVat;
        break;
    }
    return { box: def.box, label: def.label, amount };
  });
}
