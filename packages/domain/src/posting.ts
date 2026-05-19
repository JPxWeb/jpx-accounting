import type { AccountingSuggestion, Voucher } from "@jpx-accounting/contracts";

import { ACCOUNT_COMPANY_BANK, ACCOUNT_INPUT_VAT, findBasAccount, VAT_CODE_NONE } from "./bas";
import type { LedgerLine } from "./ledger-line";

export function buildPostingLines(
  voucher: Voucher,
  suggestion: AccountingSuggestion,
  action: "approve" | "book-without-vat",
  occurredAt: string,
): LedgerLine[] {
  const amount = voucher.voucherFields.grossAmount ?? 0;
  const netAmount = voucher.voucherFields.netAmount ?? amount;
  const vatAmount = action === "book-without-vat" ? 0 : (voucher.voucherFields.vatAmount ?? 0);
  const description = voucher.voucherFields.description ?? "Reviewed voucher";

  return [
    {
      voucherId: voucher.id,
      accountNumber: suggestion.accountNumber,
      accountName: suggestion.accountName,
      description,
      debit: netAmount,
      credit: 0,
      vatCode: suggestion.vatCode,
      bookedAt: occurredAt,
      deductible: action !== "book-without-vat",
    },
    {
      voucherId: voucher.id,
      accountNumber: ACCOUNT_INPUT_VAT,
      accountName: findBasAccount(ACCOUNT_INPUT_VAT)!.name,
      description: `${description} VAT`,
      debit: vatAmount,
      credit: 0,
      vatCode: suggestion.vatCode,
      bookedAt: occurredAt,
      deductible: action !== "book-without-vat",
    },
    {
      voucherId: voucher.id,
      accountNumber: ACCOUNT_COMPANY_BANK,
      accountName: findBasAccount(ACCOUNT_COMPANY_BANK)!.name,
      description,
      debit: 0,
      credit: amount,
      vatCode: VAT_CODE_NONE,
      bookedAt: occurredAt,
      deductible: false,
    },
  ];
}
