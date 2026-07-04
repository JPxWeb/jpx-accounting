"use client";

import type { VatReturnBox } from "@jpx-accounting/contracts";
import { useTranslations } from "next-intl";

import { Money } from "../ui/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

/**
 * Momsdeklaration box table straight from the pack's `vatReturn`. Box labels
 * ship with the VAT regime data (Swedish statutory wording); the net box 49
 * gets a highlighted att betala / att få tillbaka strip.
 */
export function VatReturnTable({ boxes }: { boxes: VatReturnBox[] }) {
  const t = useTranslations("reports.vat");
  const netBox = boxes.find((box) => box.box === "49");

  return (
    <section id="vat-preparation" data-testid="vat-preparation" className="glass-panel rounded-xl p-5">
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{t("description")}</p>
      <div className="mt-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("headerBox")}</TableHead>
              <TableHead>{t("headerLabel")}</TableHead>
              <TableHead className="text-right">{t("headerAmount")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {boxes.map((box) => (
              <TableRow
                key={box.box}
                data-testid="vat-box-row"
                data-box={box.box}
                className={box.box === "49" ? "font-semibold" : undefined}
              >
                <TableCell className="text-mono">{box.box}</TableCell>
                <TableCell>{box.label}</TableCell>
                <TableCell className="text-right">
                  <Money value={box.amount} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {netBox ? (
        <p
          data-testid="vat-box-49"
          className="mt-4 rounded-lg bg-primary-soft px-4 py-3 text-sm font-semibold text-primary"
        >
          {netBox.amount >= 0 ? t("toPay") : t("toRefund")}: <Money value={Math.abs(netBox.amount)} />
        </p>
      ) : null}
    </section>
  );
}
