"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";

import type { LedgerVoucherViewModel } from "../../lib/ledger/ledger-voucher-view-model";
import { Money } from "../ui/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { UnavailableState } from "../ui/unavailable-state";

const DISABLED_SLOTS = [
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

  return (
    <section data-testid="ledger-voucher-detail">
      <div className="glass-panel rounded-xl p-5">
        <Table>
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

      {DISABLED_SLOTS.map((slot) =>
        vm.slots[slot] === "disabled" ? (
          <UnavailableState
            key={slot}
            testId={`ledger-slot-${slot}-disabled`}
            title={tSlots(slot)}
            message={tSlots(slot)}
          />
        ) : null,
      )}
    </section>
  );
}
