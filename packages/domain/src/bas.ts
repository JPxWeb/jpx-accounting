export type BasAccount = {
  number: string;
  name: string;
  vatCode: string;
};

export const basAccounts: BasAccount[] = [
  { number: "1910", name: "Kassa", vatCode: "NA" },
  { number: "1930", name: "Företagskonto", vatCode: "NA" },
  { number: "2440", name: "Leverantörsskulder", vatCode: "NA" },
  { number: "2641", name: "Debiterad ingående moms", vatCode: "VAT-INPUT" },
  { number: "5460", name: "Förbrukningsmaterial", vatCode: "VAT25" },
  { number: "5610", name: "Personbilskostnader", vatCode: "VAT25-LIMITED" },
  { number: "6071", name: "Representation, avdragsgill", vatCode: "VAT12-LIMITED" },
  { number: "6110", name: "Kontorsmateriel", vatCode: "VAT25" },
  { number: "6212", name: "Mobiltelefon", vatCode: "VAT25" },
  { number: "6540", name: "IT-tjänster", vatCode: "VAT25" },
  { number: "6991", name: "Övriga externa kostnader, avdragsgilla", vatCode: "VAT25" }
];

export function findBasAccount(number: string) {
  return basAccounts.find((account) => account.number === number);
}

