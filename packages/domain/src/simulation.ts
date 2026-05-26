import type { AccountingSuggestion, ReviewTask, SimulationRun, Voucher } from "@jpx-accounting/contracts";

import { buildPostingLines } from "./posting";
import type { ReviewAction } from "./store";

type BalanceDelta = SimulationRun["balanceDelta"];
type VatDelta = SimulationRun["vatDelta"];

export function simulateApprovals(
  reviews: ReviewTask[],
  suggestions: AccountingSuggestion[],
  vouchers: Voucher[],
  action: ReviewAction,
): { balanceDelta: BalanceDelta; vatDelta: VatDelta; affectedAccounts: string[] } {
  const suggestionsByVoucher = new Map(suggestions.map((s) => [s.voucherId, s]));
  const vouchersById = new Map(vouchers.map((v) => [v.id, v]));

  const balanceAcc = new Map<string, { name: string; debit: number; credit: number }>();
  const vatAcc = new Map<string, { base: number; amount: number }>();

  for (const review of reviews) {
    const voucher = vouchersById.get(review.voucherId);
    const suggestion = suggestionsByVoucher.get(review.voucherId) ?? review.suggestion;
    if (!voucher || !suggestion) continue;
    const effectiveAction: "approve" | "book-without-vat" = action === "reject" ? "approve" : action;
    const lines = buildPostingLines(voucher, suggestion, effectiveAction, voucher.createdAt);
    for (const line of lines) {
      const entry = balanceAcc.get(line.accountNumber) ?? { name: line.accountName, debit: 0, credit: 0 };
      entry.debit += line.debit;
      entry.credit += line.credit;
      balanceAcc.set(line.accountNumber, entry);
      const base = line.debit !== 0 ? line.debit : line.credit;
      const isVatLine = line.accountNumber === "2641";
      const v = vatAcc.get(line.vatCode) ?? { base: 0, amount: 0 };
      v.base += base;
      if (isVatLine) v.amount += line.debit - line.credit;
      vatAcc.set(line.vatCode, v);
    }
  }

  const balanceDelta: BalanceDelta = [...balanceAcc].map(([accountNumber, e]) => ({
    accountNumber,
    accountName: e.name,
    deltaDebit: e.debit,
    deltaCredit: e.credit,
  }));
  const vatDelta: VatDelta = [...vatAcc].map(([vatCode, v]) => ({
    vatCode,
    deltaBase: v.base,
    deltaAmount: v.amount,
  }));
  const affectedAccounts = [...balanceAcc.keys()];

  return { balanceDelta, vatDelta, affectedAccounts };
}
