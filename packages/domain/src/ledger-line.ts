export type LedgerLine = {
  voucherId: string;
  accountNumber: string;
  accountName: string;
  description: string;
  debit: number;
  credit: number;
  vatCode: string;
  bookedAt: string;
  deductible: boolean;
};
