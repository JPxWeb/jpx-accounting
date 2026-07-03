import type { CountryCode } from "@jpx-accounting/contracts";

/**
 * VAT regime as data (advisory-pivot Phase 2): rates, account direction,
 * declaration boxes, and deductibility rules are regime ENTRIES, not code.
 * Sweden is the only populated regime today; `buildVat`, `simulateApprovals`,
 * and `buildVatReturnBoxes` consume this data instead of account literals.
 */

export type VatRateId = "VAT25" | "VAT12" | "VAT6" | "VAT0";

export type VatDirection = "input" | "output";

export type VatBoxKind = "sales-base" | "output-vat" | "purchase-base" | "input-vat" | "net";

export type VatBoxDef = { box: string; label: string; kind: VatBoxKind; rate?: VatRateId };

export type DeductibilityRule = {
  id: string;
  label: string;
  appliesToAccounts: string[];
  vatDeductionBaseCapSek?: number;
  perPerson?: boolean;
  vatDeductibleShare?: number;
  incomeTaxDeductible: boolean;
  source: string;
};

export type VatRegime = {
  country: CountryCode;
  rates: Record<VatRateId, { percent: 25 | 12 | 6 | 0 }>;
  accounts: {
    input: string[];
    outputByRate: Record<Exclude<VatRateId, "VAT0">, string>;
    settlement: string;
  };
  boxes: VatBoxDef[];
  deductibility: DeductibilityRule[];
};

/**
 * Swedish standard momsdeklaration subset, bounded to current features.
 * Boxes 20/21/30–32 are modeled in data for EU reverse charge but not yet
 * computed by `buildVatReturnBoxes` (no reverse-charge accounts in the
 * bas-2026 subset). Deductibility rules are data only in Phase 2 —
 * enforcement lands with the real rule engine later.
 */
export const swedishVatRegime: VatRegime = {
  country: "SE",
  rates: {
    VAT25: { percent: 25 },
    VAT12: { percent: 12 },
    VAT6: { percent: 6 },
    VAT0: { percent: 0 },
  },
  accounts: {
    input: ["2641", "2640"],
    outputByRate: { VAT25: "2610", VAT12: "2620", VAT6: "2630" },
    settlement: "2650",
  },
  boxes: [
    { box: "05", label: "Momspliktig försäljning", kind: "sales-base" },
    { box: "10", label: "Utgående moms 25 %", kind: "output-vat", rate: "VAT25" },
    { box: "11", label: "Utgående moms 12 %", kind: "output-vat", rate: "VAT12" },
    { box: "12", label: "Utgående moms 6 %", kind: "output-vat", rate: "VAT6" },
    { box: "20", label: "Inköp av varor från annat EU-land", kind: "purchase-base" },
    { box: "21", label: "Inköp av tjänster från annat EU-land", kind: "purchase-base" },
    { box: "30", label: "Utgående moms på inköp 25 %", kind: "output-vat", rate: "VAT25" },
    { box: "31", label: "Utgående moms på inköp 12 %", kind: "output-vat", rate: "VAT12" },
    { box: "32", label: "Utgående moms på inköp 6 %", kind: "output-vat", rate: "VAT6" },
    { box: "48", label: "Ingående moms att dra av", kind: "input-vat" },
    { box: "49", label: "Moms att betala eller få tillbaka", kind: "net" },
  ],
  deductibility: [
    {
      id: "representation-meal",
      label: "Representation meals",
      appliesToAccounts: ["6071", "6072"],
      vatDeductionBaseCapSek: 300,
      perPerson: true,
      incomeTaxDeductible: false,
      source: "Skatteverket — moms vid representation (underlag max 300 kr per person och tillfälle)",
    },
    {
      id: "passenger-car",
      label: "Passenger car leasing",
      appliesToAccounts: ["5610", "5615"],
      vatDeductibleShare: 0.5,
      incomeTaxDeductible: true,
      source: "Skatteverket — avdrag för moms på leasing av personbil (50 %)",
    },
  ],
};

const regimesByCountry: Record<CountryCode, VatRegime> = {
  SE: swedishVatRegime,
};

export function getVatRegime(country: CountryCode): VatRegime {
  const regime = regimesByCountry[country];
  if (!regime) {
    throw new Error(`No VAT regime registered for country "${country}"`);
  }
  return regime;
}
