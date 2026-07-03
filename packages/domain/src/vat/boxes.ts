import { findCoaAccount, getCoaTemplate } from "../coa/registry";
import type { LedgerLine } from "../projections";
import type { VatRateId, VatRegime } from "./regime";
import { swedishVatRegime } from "./regime";

const RATED_VAT_CODES = new Set<string>(["VAT25", "VAT12", "VAT6"]);

/**
 * Map posted ledger lines onto the regime's VAT-return box subset.
 *
 * Domain-only in Phase 2: no contract/report-bundle change, no route, no UI —
 * Phase 4's VAT report consumes this. Computed boxes: sales base (05) from
 * VAT-rated revenue accounts, output VAT (10–12) from the regime's output
 * accounts, input VAT (48) from the regime's input accounts, and net (49) =
 * output − input. Purchase-base and reverse-charge boxes (20/21/30–32) are
 * modeled in regime data but return 0 until reverse-charge postings exist.
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
    const account = findCoaAccount(coa, line.accountNumber);
    if (account?.accountClass === "revenue" && RATED_VAT_CODES.has(account.defaultVatCode)) {
      salesBase += line.credit - line.debit;
    }
  }

  const totalOutputVat = [...outputVatByRate.values()].reduce((sum, amount) => sum + amount, 0);

  // Output-vat amounts go to the FIRST box declared for a rate (10–12); later
  // boxes sharing the rate (30–32, reverse charge) stay 0 until modeled.
  const consumedRates = new Set<VatRateId>();

  return regime.boxes.map((def) => {
    let amount = 0;
    switch (def.kind) {
      case "sales-base":
        amount = salesBase;
        break;
      case "output-vat":
        if (def.rate && !consumedRates.has(def.rate)) {
          consumedRates.add(def.rate);
          amount = outputVatByRate.get(def.rate) ?? 0;
        }
        break;
      case "purchase-base":
        amount = 0;
        break;
      case "input-vat":
        amount = inputVat;
        break;
      case "net":
        amount = totalOutputVat - inputVat;
        break;
    }
    return { box: def.box, label: def.label, amount };
  });
}
