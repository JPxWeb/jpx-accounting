import type { CompanySettings, JournalEntryProjection } from "@jpx-accounting/contracts";

import { defaultCoaTemplate, findCoaAccount } from "../coa/registry";
import type { CoaTemplate } from "../coa/types";

/**
 * SIE 4 export serializer (advisory pivot Phase 3, Task 3.4). Emission order
 * is pinned by the plan and by tests/e2e/api.spec.ts (the `#PROGRAM` line is
 * asserted byte-identical): `#FLAGGA` · `#PROGRAM` · `#FORMAT PC8` · `#GEN` ·
 * `#SIETYP 4` · `#ORGNR`/`#FNAMN` (when settings exist) · `#RAR 0` ·
 * `#KONTO` per distinct account · `#VER` blocks grouped by voucher.
 *
 * Output is a JS string; callers encode with `encodePc8` before writing bytes.
 */

export type SieExportInput = {
  journal: JournalEntryProjection[];
  settings?: CompanySettings | null | undefined;
  /** ISO timestamp the export was generated at — drives `#GEN` and the `#RAR 0` window. */
  generatedAt: string;
  coa?: CoaTemplate;
};

/** Quote + escape a SIE text field (`\` and `"` escaped, per the SIE quoting rules). */
function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** `YYYY-MM-DD…` → `YYYYMMDD`. */
function compactDay(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, "");
}

/**
 * Current fiscal-year window (`#RAR 0`) containing `generatedAt`, derived
 * from the workspace profile's `MM-DD` fiscal year start.
 */
function fiscalYearWindow(generatedAt: string, fiscalYearStart: string): { start: string; end: string } {
  const day = generatedAt.slice(0, 10);
  const year = Number(day.slice(0, 4));
  const startThisYear = `${year}-${fiscalYearStart}`;
  const start = day >= startThisYear ? startThisYear : `${year - 1}-${fiscalYearStart}`;
  const [startYear, startMonth, startDay] = start.split("-").map(Number) as [number, number, number];
  const endDate = new Date(Date.UTC(startYear + 1, startMonth - 1, startDay));
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  return { start, end: endDate.toISOString().slice(0, 10) };
}

export function buildSieExport({ journal, settings, generatedAt, coa = defaultCoaTemplate }: SieExportInput): string {
  const lines: string[] = [];

  lines.push("#FLAGGA 0");
  // Byte-identical — pinned by tests/e2e/api.spec.ts. Do not reformat.
  lines.push('#PROGRAM "JPX Accounting" "0.1.0"');
  lines.push("#FORMAT PC8");
  lines.push(`#GEN ${compactDay(generatedAt)}`);
  lines.push("#SIETYP 4");
  if (settings?.organizationNumber) lines.push(`#ORGNR ${settings.organizationNumber}`);
  if (settings?.organizationName) lines.push(`#FNAMN ${quote(settings.organizationName)}`);

  const fiscalYearStart = settings?.profile.fiscalYearStart ?? "01-01";
  const { start, end } = fiscalYearWindow(generatedAt, fiscalYearStart);
  lines.push(`#RAR 0 ${compactDay(start)} ${compactDay(end)}`);

  // #KONTO per distinct account, sorted by number for a deterministic export.
  const accountNames = new Map<string, string>();
  for (const entry of journal) {
    if (!accountNames.has(entry.accountNumber)) {
      accountNames.set(
        entry.accountNumber,
        entry.accountName || (findCoaAccount(coa, entry.accountNumber)?.name ?? `Konto ${entry.accountNumber}`),
      );
    }
  }
  for (const number of [...accountNames.keys()].sort()) {
    lines.push(`#KONTO ${number} ${quote(accountNames.get(number)!)}`);
  }

  // Vouchers grouped by voucherId in first-seen order; sequential #VER numbers.
  const groups = new Map<string, JournalEntryProjection[]>();
  for (const entry of journal) {
    const group = groups.get(entry.voucherId);
    if (group) {
      group.push(entry);
    } else {
      groups.set(entry.voucherId, [entry]);
    }
  }

  let verNumber = 0;
  for (const entries of groups.values()) {
    verNumber += 1;
    const first = entries[0]!;
    lines.push(`#VER A ${verNumber} ${compactDay(first.bookedAt)} ${quote(first.description)}`);
    lines.push("{");
    for (const entry of entries) {
      // SIE amount convention: debit positive, credit negative; dot-decimal 2dp.
      lines.push(`#TRANS ${entry.accountNumber} {} ${(entry.debit - entry.credit).toFixed(2)}`);
    }
    lines.push("}");
  }

  return `${lines.join("\n")}\n`;
}
