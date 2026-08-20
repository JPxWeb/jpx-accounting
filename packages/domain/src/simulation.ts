import type { AccountingSuggestion, ReviewTask, SimulationRun, Voucher } from "@jpx-accounting/contracts";

import { defaultCoaTemplate } from "./coa/registry";
import type { CoaTemplate } from "./coa/types";
import { buildManualPostingLines, buildPostingLines, type ReviewAction } from "./store-shared";
import type { VatRegime } from "./vat/regime";
import { swedishVatRegime } from "./vat/regime";

type BalanceDelta = SimulationRun["balanceDelta"];
type VatDelta = SimulationRun["vatDelta"];

export function simulateApprovals(
  reviews: ReviewTask[],
  suggestions: AccountingSuggestion[],
  vouchers: Voucher[],
  action: ReviewAction,
  coa: CoaTemplate = defaultCoaTemplate,
  regime: VatRegime = swedishVatRegime,
): {
  balanceDelta: BalanceDelta;
  vatDelta: VatDelta;
  affectedAccounts: string[];
} {
  const suggestionsByVoucher = new Map(suggestions.map((s) => [s.voucherId, s]));
  const vouchersById = new Map(vouchers.map((v) => [v.id, v]));

  const balanceAcc = new Map<string, { name: string; debit: number; credit: number }>();
  const vatAcc = new Map<string, { base: number; amount: number }>();

  for (const review of reviews) {
    const voucher = vouchersById.get(review.voucherId);
    const suggestion = suggestionsByVoucher.get(review.voucherId) ?? review.suggestion;
    if (!voucher || !suggestion) continue;
    const effectiveAction: "approve" | "book-without-vat" = action === "reject" ? "approve" : action;
    // KFR D2: a manual-origin voucher is posted from its verbatim lines
    // (`planReviewDecision` → `buildManualPostingLines`). `buildPostingLines`
    // cannot describe an N-line entry — it takes a single `accountNumber` —
    // so simulating one through it fabricates a 3-line expense posting that
    // does not match what approval will actually append. Mirror the decision
    // path instead so the preview is the truth.
    const lines =
      voucher.origin === "manual" && suggestion.lines
        ? buildManualPostingLines(voucher, suggestion.lines, voucher.createdAt, coa)
        : buildPostingLines(voucher, suggestion, effectiveAction, voucher.createdAt, coa);
    for (const line of lines) {
      const entry = balanceAcc.get(line.accountNumber) ?? { name: line.accountName, debit: 0, credit: 0 };
      entry.debit += line.debit;
      entry.credit += line.credit;
      balanceAcc.set(line.accountNumber, entry);
      const base = line.debit !== 0 ? line.debit : line.credit;
      const isVatLine = regime.accounts.input.includes(line.accountNumber);
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
