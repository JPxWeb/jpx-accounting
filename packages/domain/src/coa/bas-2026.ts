import type { CoaAccount, CoaTemplate } from "./types";

/**
 * BAS 2026 — 68-account Swedish SMB subset (advisory-pivot Phase 2).
 *
 * Notes:
 * - `-LIMITED` vat codes are retired; deductibility moved to data
 *   (`deductibilityRuleId`, rules defined in the VAT regime).
 * - Input-VAT identity no longer lives on the account (`2641`'s old
 *   `"VAT-INPUT"` code): it lives in `roles.inputVat` / regime data.
 */

const accounts: CoaAccount[] = [
  // 1xxx assets
  { number: "1110", name: "Byggnader", accountClass: "asset", defaultVatCode: "NA" },
  { number: "1220", name: "Inventarier och verktyg", accountClass: "asset", defaultVatCode: "NA" },
  { number: "1250", name: "Datorer", accountClass: "asset", defaultVatCode: "NA" },
  { number: "1510", name: "Kundfordringar", accountClass: "asset", defaultVatCode: "NA" },
  {
    number: "1630",
    name: "Avräkning för skatter och avgifter (skattekonto)",
    accountClass: "asset",
    defaultVatCode: "NA",
  },
  { number: "1650", name: "Momsfordran", accountClass: "asset", defaultVatCode: "NA" },
  {
    number: "1790",
    name: "Övriga förutbetalda kostnader och upplupna intäkter",
    accountClass: "asset",
    defaultVatCode: "NA",
  },
  { number: "1910", name: "Kassa", accountClass: "asset", defaultVatCode: "NA" },
  { number: "1930", name: "Företagskonto", accountClass: "asset", defaultVatCode: "NA" },
  // 2xxx equity/liabilities
  { number: "2081", name: "Aktiekapital", accountClass: "equity-liability", defaultVatCode: "NA" },
  { number: "2091", name: "Balanserad vinst eller förlust", accountClass: "equity-liability", defaultVatCode: "NA" },
  { number: "2099", name: "Årets resultat", accountClass: "equity-liability", defaultVatCode: "NA" },
  { number: "2440", name: "Leverantörsskulder", accountClass: "equity-liability", defaultVatCode: "NA" },
  { number: "2510", name: "Skatteskulder", accountClass: "equity-liability", defaultVatCode: "NA" },
  { number: "2610", name: "Utgående moms 25 %", accountClass: "equity-liability", defaultVatCode: "NA" },
  { number: "2620", name: "Utgående moms 12 %", accountClass: "equity-liability", defaultVatCode: "NA" },
  { number: "2630", name: "Utgående moms 6 %", accountClass: "equity-liability", defaultVatCode: "NA" },
  { number: "2640", name: "Ingående moms", accountClass: "equity-liability", defaultVatCode: "NA" },
  { number: "2641", name: "Debiterad ingående moms", accountClass: "equity-liability", defaultVatCode: "NA" },
  { number: "2650", name: "Redovisningskonto för moms", accountClass: "equity-liability", defaultVatCode: "NA" },
  { number: "2710", name: "Personalskatt", accountClass: "equity-liability", defaultVatCode: "NA" },
  {
    number: "2731",
    name: "Avräkning lagstadgade sociala avgifter",
    accountClass: "equity-liability",
    defaultVatCode: "NA",
  },
  { number: "2890", name: "Övriga kortfristiga skulder", accountClass: "equity-liability", defaultVatCode: "NA" },
  {
    number: "2990",
    name: "Övriga upplupna kostnader och förutbetalda intäkter",
    accountClass: "equity-liability",
    defaultVatCode: "NA",
  },
  // 3xxx revenue
  { number: "3001", name: "Försäljning inom Sverige 25 %", accountClass: "revenue", defaultVatCode: "VAT25" },
  { number: "3002", name: "Försäljning inom Sverige 12 %", accountClass: "revenue", defaultVatCode: "VAT12" },
  { number: "3003", name: "Försäljning inom Sverige 6 %", accountClass: "revenue", defaultVatCode: "VAT6" },
  { number: "3004", name: "Försäljning inom Sverige, momsfri", accountClass: "revenue", defaultVatCode: "VAT0" },
  {
    number: "3308",
    name: "Försäljning tjänster till annat EU-land",
    accountClass: "revenue",
    defaultVatCode: "VAT0",
  },
  { number: "3740", name: "Öres- och kronutjämning", accountClass: "revenue", defaultVatCode: "NA" },
  // 4xxx materials/goods
  { number: "4000", name: "Inköp av varor från Sverige", accountClass: "materials", defaultVatCode: "VAT25" },
  {
    number: "4515",
    name: "Inköp av varor från annat EU-land 25 %",
    accountClass: "materials",
    defaultVatCode: "VAT25",
  },
  {
    number: "4535",
    name: "Inköp av tjänster från annat EU-land 25 %",
    accountClass: "materials",
    defaultVatCode: "VAT25",
  },
  { number: "4990", name: "Förändring av lager", accountClass: "materials", defaultVatCode: "NA" },
  // 5xxx–6xxx external costs
  { number: "5010", name: "Lokalhyra", accountClass: "external-cost", defaultVatCode: "VAT25" },
  { number: "5410", name: "Förbrukningsinventarier", accountClass: "external-cost", defaultVatCode: "VAT25" },
  { number: "5460", name: "Förbrukningsmaterial", accountClass: "external-cost", defaultVatCode: "VAT25" },
  {
    number: "5610",
    name: "Personbilskostnader",
    accountClass: "external-cost",
    defaultVatCode: "VAT25",
    deductibilityRuleId: "passenger-car",
  },
  {
    number: "5615",
    name: "Leasing av personbilar",
    accountClass: "external-cost",
    defaultVatCode: "VAT25",
    deductibilityRuleId: "passenger-car",
  },
  { number: "5800", name: "Resekostnader", accountClass: "external-cost", defaultVatCode: "VAT6" },
  { number: "5831", name: "Kost och logi i Sverige", accountClass: "external-cost", defaultVatCode: "VAT12" },
  { number: "5910", name: "Annonsering", accountClass: "external-cost", defaultVatCode: "VAT25" },
  {
    number: "6071",
    name: "Representation, avdragsgill",
    accountClass: "external-cost",
    defaultVatCode: "VAT12",
    deductibilityRuleId: "representation-meal",
  },
  {
    number: "6072",
    name: "Representation, ej avdragsgill",
    accountClass: "external-cost",
    defaultVatCode: "NA",
    deductibilityRuleId: "representation-meal",
  },
  { number: "6110", name: "Kontorsmateriel", accountClass: "external-cost", defaultVatCode: "VAT25" },
  { number: "6212", name: "Mobiltelefon", accountClass: "external-cost", defaultVatCode: "VAT25" },
  { number: "6230", name: "Datakommunikation", accountClass: "external-cost", defaultVatCode: "VAT25" },
  { number: "6250", name: "Postbefordran", accountClass: "external-cost", defaultVatCode: "VAT25" },
  { number: "6310", name: "Företagsförsäkringar", accountClass: "external-cost", defaultVatCode: "VAT0" },
  { number: "6420", name: "Ersättningar till revisor", accountClass: "external-cost", defaultVatCode: "VAT25" },
  { number: "6530", name: "Redovisningstjänster", accountClass: "external-cost", defaultVatCode: "VAT25" },
  { number: "6540", name: "IT-tjänster", accountClass: "external-cost", defaultVatCode: "VAT25" },
  { number: "6550", name: "Konsultarvoden", accountClass: "external-cost", defaultVatCode: "VAT25" },
  { number: "6570", name: "Bankkostnader", accountClass: "external-cost", defaultVatCode: "VAT0" },
  {
    number: "6970",
    name: "Tidningar, tidskrifter och facklitteratur",
    accountClass: "external-cost",
    defaultVatCode: "VAT6",
  },
  {
    number: "6991",
    name: "Övriga externa kostnader, avdragsgilla",
    accountClass: "external-cost",
    defaultVatCode: "VAT25",
  },
  {
    number: "6992",
    name: "Övriga externa kostnader, ej avdragsgilla",
    accountClass: "external-cost",
    defaultVatCode: "NA",
  },
  // 7xxx personnel/depreciation
  { number: "7210", name: "Löner till tjänstemän", accountClass: "personnel", defaultVatCode: "NA" },
  { number: "7220", name: "Löner till företagsledare", accountClass: "personnel", defaultVatCode: "NA" },
  { number: "7331", name: "Skattefria bilersättningar", accountClass: "personnel", defaultVatCode: "NA" },
  { number: "7510", name: "Arbetsgivaravgifter", accountClass: "personnel", defaultVatCode: "NA" },
  { number: "7690", name: "Övriga personalkostnader", accountClass: "personnel", defaultVatCode: "NA" },
  {
    number: "7832",
    name: "Avskrivningar på inventarier och verktyg",
    accountClass: "personnel",
    defaultVatCode: "NA",
  },
  { number: "7835", name: "Avskrivningar på datorer", accountClass: "personnel", defaultVatCode: "NA" },
  // 8xxx financial/result
  {
    number: "8310",
    name: "Ränteintäkter från omsättningstillgångar",
    accountClass: "financial",
    defaultVatCode: "NA",
  },
  {
    number: "8410",
    name: "Räntekostnader för långfristiga skulder",
    accountClass: "financial",
    defaultVatCode: "NA",
  },
  { number: "8910", name: "Skatt som belastar årets resultat", accountClass: "financial", defaultVatCode: "NA" },
  { number: "8999", name: "Årets resultat", accountClass: "financial", defaultVatCode: "NA" },
];

export const bas2026: CoaTemplate = {
  id: "bas-2026",
  country: "SE",
  name: "BAS 2026 (svensk SMB-delmängd)",
  accounts,
  roles: {
    bank: "1930",
    cash: "1910",
    accountsReceivable: "1510",
    accountsPayable: "2440",
    inputVat: "2641",
    outputVatByRate: { VAT25: "2610", VAT12: "2620", VAT6: "2630" },
    vatSettlement: "2650",
    fallbackExpense: "6991",
    rounding: "3740",
  },
};
