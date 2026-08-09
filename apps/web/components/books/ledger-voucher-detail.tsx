"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";

import type { LedgerVoucherViewModel } from "../../lib/ledger/ledger-voucher-view-model";
import { Money } from "../ui/money";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

const LEDGER_SLOT_KEYS = [
  "workItemConfirm",
  "externalRefs",
  "tags",
  "lineId",
  "vatDeductibility",
  "workflows",
] as const satisfies ReadonlyArray<keyof LedgerVoucherViewModel["slots"]>;

export function LedgerVoucherDetail({ vm }: { vm: LedgerVoucherViewModel }) {
  const tJournal = useTranslations("books.journal");
  const tSlots = useTranslations("books.ledger.slots");
  const tUnavailable = useTranslations("common.unavailable");
  const disabledSlots = LEDGER_SLOT_KEYS.filter((slot) => vm.slots[slot] === "disabled");

  return (
    <section data-testid="ledger-voucher-detail">
      <div className="glass-panel rounded-xl p-5">
        <Table>
          <TableCaption className="sr-only">
            {tJournal("headerVoucher")} {vm.voucherNumber}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{tJournal("headerAccount")}</TableHead>
              <TableHead className="text-right">{tJournal("headerDebit")}</TableHead>
              <TableHead className="text-right">{tJournal("headerCredit")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vm.lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell>
                  {line.accountNumber} {line.accountName}
                </TableCell>
                <TableCell className="text-right">
                  <Money value={line.debit} />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={line.credit} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {vm.evidenceIds.length > 0 ? (
        <ul className="mt-4 space-y-1" data-testid="ledger-voucher-evidence">
          {vm.evidenceIds.map((id) => (
            <li key={id}>
              <Link
                href={`/capture/evidence/${encodeURIComponent(id)}`}
                className="text-mono text-sm text-primary underline underline-offset-2"
              >
                {id}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {vm.provenanceSummary ? (
        <p className="mt-4 text-sm text-muted-foreground" data-testid="ledger-voucher-provenance">
          {vm.provenanceSummary}
        </p>
      ) : null}

      {disabledSlots.length > 0 ? (
        <div className="mt-4 rounded-xl border border-border bg-surface-muted/40 p-4">
          <p className="text-eyebrow">{tUnavailable("eyebrow")}</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {disabledSlots.map((slot) => (
              <li
                key={slot}
                data-testid={`ledger-slot-${slot}-disabled`}
                className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-muted-foreground"
              >
                {tSlots(slot)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
