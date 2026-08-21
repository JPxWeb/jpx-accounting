import { classifyAccountNumber, findCoaAccount, getCoaTemplate } from "../coa/registry";
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
 * Computed boxes (KFR Phase C / D4 — see
 * docs/superpowers/specs/2026-08-20-kapitas-full-replacement-design.md):
 *  - 05 sales base: a revenue-class line counts when its own `vatCode` is
 *    rated, OR — the account-classification fix for imported
 *    vatCode:"NA" sales (readiness gap G5, Task C4) — when its VOUCHER
 *    carries a domestic output-VAT account line (2610/2620/2630) AND the
 *    account is a rated one in the CoA (or absent from it); see the
 *    inline note at the accumulator.
 *  - 10–12 domestic output VAT: account-keyed off `outputByRate`, its own
 *    map.
 *  - 30–32 reverse-charge output VAT: account-keyed off
 *    `reverseChargeOutputByRate`, ITS OWN map — no longer shares (and is
 *    no longer starved by) the 10–12 accumulator.
 *  - 21 EU-services purchase base: derived from the TRUNCATED box-30
 *    family, per rate, base = RC output VAT ÷ rate (box30 / 0.25 today).
 *    Box 20 (EU goods) stays 0 — no goods reverse-charge accounts
 *    modeled (YAGNI).
 *  - 48 input VAT: account-keyed off `accounts.input` (now also covers
 *    the reverse-charge input legs 2645/2647 alongside 2641/2640, from
 *    Task C1).
 *  - 49 net = (10+11+12) + (30+31+32) − 48, computed FROM the truncated
 *    component boxes — not truncated from the öre-exact net — matching
 *    how Skatteverket derives it.
 *  - 39/40 EU/export SERVICE revenue: account-based (each box's own
 *    `accounts` list, credit − debit) and vatCode-INDEPENDENT, so an
 *    SIE-imported line with vatCode "NA" on 3308/3305 still counts.
 *    Informational turnover boxes — deliberately NOT part of box 49.
 *
 * All box amounts are whole kronor (see `toWholeKronor`); internal ledger
 * lines and other projections (`buildVat`) stay öre-exact.
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
  const rcAccountByRate = new Map<VatRateId, string>(
    (Object.entries(regime.accounts.reverseChargeOutputByRate) as Array<[VatRateId, string]>).map(([rate, number]) => [
      rate,
      number,
    ]),
  );
  // Flattened ONCE, as a set of accounts — not re-scanned per line per box.
  // Accumulating inside a `for (const def of regime.boxes)` loop would add a
  // line's amount once per MATCHING box, so an account listed by two
  // `account-revenue` boxes would double-count into both of them.
  const accountRevenueAccounts = new Set<string>(
    regime.boxes.filter((def) => def.kind === "account-revenue").flatMap((def) => def.accounts ?? []),
  );
  const domesticOutputAccounts = new Set(accountByRate.values());

  // Pass 1: which vouchers carry a domestic output-VAT account line at
  // all (any rate) — the box 05 fallback below reads this, not the
  // line's own vatCode, when that vatCode is silent (SIE imports; G5).
  const voucherHasDomesticOutputVat = new Set<string>();
  for (const line of lines) {
    if (domesticOutputAccounts.has(line.accountNumber) && line.credit - line.debit !== 0) {
      voucherHasDomesticOutputVat.add(line.voucherId);
    }
  }

  let salesBase = 0;
  let inputVat = 0;
  const outputVatByRate = new Map<VatRateId, number>();
  const rcOutputVatByRate = new Map<VatRateId, number>();
  const accountRevenueTotals = new Map<string, number>();

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
    for (const [rate, accountNumber] of rcAccountByRate) {
      if (line.accountNumber === accountNumber) {
        rcOutputVatByRate.set(rate, (rcOutputVatByRate.get(rate) ?? 0) + line.credit - line.debit);
      }
    }
    // Boxes 39/40: purely ACCOUNT-based turnover, vatCode-independent — an
    // SIE-imported line carrying vatCode "NA" on 3308/3305 counts exactly
    // like a natively booked VAT0 one. credit − debit, so a credit note /
    // reversal reduces the declared turnover.
    if (accountRevenueAccounts.has(line.accountNumber)) {
      accountRevenueTotals.set(
        line.accountNumber,
        (accountRevenueTotals.get(line.accountNumber) ?? 0) + line.credit - line.debit,
      );
    }
    // Box 05 (G5 fix): rated by the line's OWN vatCode, OR inferred from a
    // matching domestic output-VAT account line in the SAME voucher.
    //
    // DEVIATION from the C4 brief: the inferred arm counts a revenue line
    // only when the CHART OF ACCOUNTS says that account is a rated one
    // (`defaultVatCode` VAT25/12/6), or when the account is unknown to the
    // CoA at all — conservative, so an off-template imported account keeps
    // today's behavior. Voucher-level evidence (one 2610 line) says the
    // VOUCHER contains a rated sale, never that EVERY revenue leg in it is
    // one: a mixed imported voucher pairing 3001 (rated) with 3004
    // "Försäljning inom Sverige, momsfri" or 3740 (öresutjämning) would
    // otherwise declare the VAT-free legs as momspliktig försäljning. This
    // subsumes the earlier hardcoded 3308/3305 exclusion — both are VAT0 in
    // the CoA — and keeps the C3 invariant "the account-based arm (boxes
    // 39/40) must not bleed into box 05". The vatCode arm is deliberately
    // left untouched: an explicit rated vatCode on the line is an operator
    // statement, and "the line's own vatCode wins" is already pinned
    // behavior.
    const inferredRatedRevenue = () => {
      const account = findCoaAccount(coa, line.accountNumber);
      return account === undefined || RATED_VAT_CODES.has(account.defaultVatCode);
    };
    const ratedForSalesBase =
      RATED_VAT_CODES.has(line.vatCode) || (voucherHasDomesticOutputVat.has(line.voucherId) && inferredRatedRevenue());
    if (ratedForSalesBase && classifyAccountNumber(line.accountNumber, coa) === "revenue") {
      salesBase += line.credit - line.debit;
    }
  }

  const wholeSalesBase = toWholeKronor(salesBase);
  const wholeInputVat = toWholeKronor(inputVat);
  const wholeOutputVatByRate = new Map<VatRateId, number>(
    [...outputVatByRate].map(([rate, amount]) => [rate, toWholeKronor(amount)]),
  );
  const wholeRcOutputVatByRate = new Map<VatRateId, number>(
    [...rcOutputVatByRate].map(([rate, amount]) => [rate, toWholeKronor(amount)]),
  );
  const totalOutputVat = [...wholeOutputVatByRate.values()].reduce((sum, amount) => sum + amount, 0);
  const totalRcOutputVat = [...wholeRcOutputVatByRate.values()].reduce((sum, amount) => sum + amount, 0);

  // Box 21: base = Σ (truncated box-30-family amount ÷ rate), per rate
  // that has a reverse-charge account modeled. Derived from the DECLARED
  // (whole-kronor) box 30 family, not the öre-exact accumulator — same
  // derive-from-declared-boxes discipline as box 49.
  let purchaseBaseServices = 0;
  for (const [rate, amount] of wholeRcOutputVatByRate) {
    const percent = regime.rates[rate].percent;
    if (percent > 0) purchaseBaseServices += amount / (percent / 100);
  }
  const wholePurchaseBaseServices = toWholeKronor(purchaseBaseServices);

  return regime.boxes.map((def) => {
    let amount = 0;
    switch (def.kind) {
      case "sales-base":
        amount = wholeSalesBase;
        break;
      case "output-vat":
        if (def.rate) {
          amount = (def.reverseCharge ? wholeRcOutputVatByRate : wholeOutputVatByRate).get(def.rate) ?? 0;
        }
        break;
      case "purchase-base":
        amount = def.reverseCharge ? wholePurchaseBaseServices : 0;
        break;
      case "input-vat":
        amount = wholeInputVat;
        break;
      case "net":
        amount = totalOutputVat + totalRcOutputVat - wholeInputVat;
        break;
      case "account-revenue":
        // Truncated per box, before any summing — same declaration-boundary
        // discipline as every other box. These are informational turnover
        // boxes: they are NOT part of the box 49 identity.
        amount = toWholeKronor(
          (def.accounts ?? []).reduce((sum, accountNumber) => sum + (accountRevenueTotals.get(accountNumber) ?? 0), 0),
        );
        break;
    }
    return { box: def.box, label: def.label, amount };
  });
}
