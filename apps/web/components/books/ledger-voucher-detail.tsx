"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";

import type { LedgerVoucherViewModel } from "../../lib/ledger/ledger-voucher-view-model";
import { Money } from "../ui/money";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { ExternalReferenceList } from "./external-reference-list";
import { VoucherTagList } from "./voucher-tag-list";

const LEDGER_SLOT_KEYS = [
  "externalRefs",
  "tags",
  "lineId",
  "vatDeductibility",
  "workflows",
] as const satisfies ReadonlyArray<keyof LedgerVoucherViewModel["slots"]>;

export function LedgerVoucherDetail({ vm }: { vm: LedgerVoucherViewModel }) {
  const tJournal = useTranslations("books.journal");
  const tSlots = useTranslations("books.ledger.slots");
  const tExternalRefs = useTranslations("books.ledger.externalReferences");
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
              {vm.slots.lineId === "active" ? <TableHead>{tSlots("lineIdHeader")}</TableHead> : null}
              {vm.slots.vatDeductibility === "active" ? (
                <>
                  <TableHead>{tSlots("vatCodeHeader")}</TableHead>
                  <TableHead>{tSlots("deductibilityHeader")}</TableHead>
                </>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {vm.lines.map((line) => (
              <TableRow key={line.lineId ?? line.id}>
                <TableCell>
                  {line.accountNumber} {line.accountName}
                </TableCell>
                <TableCell className="text-right">
                  <Money value={line.debit} />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={line.credit} />
                </TableCell>
                {vm.slots.lineId === "active" ? (
                  <TableCell>
                    {line.lineId ? (
                      <code
                        data-testid="ledger-line-target"
                        data-line-id={line.lineId}
                        className="break-all text-xs text-muted-foreground"
                      >
                        {line.lineId}
                      </code>
                    ) : (
                      <span className="text-xs text-muted-foreground">{tSlots("notTargetable")}</span>
                    )}
                  </TableCell>
                ) : null}
                {vm.slots.vatDeductibility === "active" ? (
                  <>
                    <TableCell data-testid="ledger-line-vat">{line.vatCode ?? "—"}</TableCell>
                    <TableCell data-testid="ledger-line-deductibility">
                      {line.deductible === undefined
                        ? "—"
                        : line.deductible
                          ? tSlots("deductible")
                          : tSlots("notDeductible")}
                    </TableCell>
                  </>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {vm.evidenceIds.length > 0 ? (
        <ul className="mt-4 space-y-1" data-testid="ledger-voucher-evidence">
          {vm.evidenceIds.map((id) => (
            <li key={id} className="flex items-center gap-2">
              <span className="inline-flex rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                {tExternalRefs("blobBadge")}
              </span>
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

      {vm.slots.externalRefs === "active" ? (
        <ExternalReferenceList voucherId={vm.voucherId} references={vm.externalReferences} />
      ) : null}

      {vm.slots.tags === "active" ? <VoucherTagList voucherId={vm.voucherId} tagIds={vm.tagIds} /> : null}

      {vm.slots.workflows === "active" ? (
        <div className="mt-4 border-t border-border pt-4" data-testid="ledger-slot-workflows-active">
          <p className="text-sm font-semibold text-foreground">{tSlots("workflowProject")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{tSlots("workflowProjectHint")}</p>
        </div>
      ) : null}

      {vm.provenanceSummary ? (
        <p className="mt-4 text-sm text-muted-foreground" data-testid="ledger-voucher-provenance">
          {vm.provenanceSummary}
        </p>
      ) : null}

      <div className="mt-4 border-t border-border pt-4" data-testid="ledger-slot-workItemConfirm-active">
        <p className="text-sm font-semibold text-foreground">{tSlots("workItemConfirm")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{tSlots("workItemHint")}</p>
      </div>

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
