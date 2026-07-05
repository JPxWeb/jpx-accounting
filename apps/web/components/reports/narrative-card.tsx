"use client";

import type { NarrativeFact } from "@jpx-accounting/reporting";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { ReactNode } from "react";

import { Money } from "../ui/money";
import { SectionLabel } from "../ui/section-label";

/**
 * Deterministic narrative over ONE `ReportPack` (advisory-pivot Phase 4). The
 * facts arrive from `buildReportNarrative`, which only copies pack values —
 * every number in the prose is literally a value the statements below render
 * (the E2E reconciliation gate asserts text equality on the period result).
 *
 * Provenance chips scroll to the section that carries the fact — except the
 * biggest-mover chip, which names one account and therefore drills straight
 * into the account drawer via `onSelectAccount` (Task 4.8).
 */
const CHIP_TARGETS: Record<NarrativeFact["id"], string> = {
  "period-result": "pnl-statement",
  "biggest-mover": "pnl-statement",
  "cash-delta": "cash-bridge",
  "vat-position": "vat-preparation",
};

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function narrativeValue(factId: NarrativeFact["id"], amount: number): ReactNode {
  return (
    <span data-testid={`narrative-value-${factId}`}>
      <Money value={amount} />
    </span>
  );
}

export function NarrativeCard({
  facts,
  onSelectAccount,
}: {
  facts: NarrativeFact[];
  onSelectAccount?: (accountNumber: string) => void;
}) {
  const t = useTranslations("reports.narrative");

  function chipAction(fact: NarrativeFact) {
    if (fact.id === "biggest-mover" && onSelectAccount) {
      return () => onSelectAccount(fact.accountNumber);
    }
    return () => scrollToSection(CHIP_TARGETS[fact.id]);
  }

  function factSentence(fact: NarrativeFact): ReactNode {
    switch (fact.id) {
      case "period-result": {
        const value = () => narrativeValue(fact.id, fact.amount);
        if (fact.delta !== undefined) {
          const delta = fact.delta;
          return t.rich("periodResultWithDelta", { value, delta: () => <Money value={delta} /> });
        }
        return t.rich("periodResult", { value });
      }
      case "biggest-mover":
        return t.rich("biggestMover", {
          accountNumber: fact.accountNumber,
          accountName: fact.accountName,
          value: () => narrativeValue(fact.id, fact.amount),
          delta: () => <Money value={fact.delta} />,
        });
      case "cash-delta":
        return t.rich("cashDelta", {
          opening: () => <Money value={fact.opening} />,
          closing: () => narrativeValue(fact.id, fact.closing),
          delta: () => <Money value={fact.delta} />,
        });
      case "vat-position":
        return t.rich(fact.amount >= 0 ? "vatToPay" : "vatToRefund", {
          value: () => narrativeValue(fact.id, fact.amount),
        });
    }
  }

  return (
    <section className="glass-panel rounded-xl p-5" data-testid="narrative-card">
      <SectionLabel>{t("title")}</SectionLabel>
      {facts.length === 0 ? (
        // Empty preview (Task 6.1): the pack still renders below with zeros —
        // say what fills in once something is booked, and link the first step.
        <div className="mt-4 space-y-3" data-testid="narrative-empty">
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
          <p className="text-sm leading-6 text-muted-foreground">{t("emptyPreview")}</p>
          <Link
            href="/capture"
            data-testid="narrative-empty-capture"
            className="inline-block rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm print:hidden"
          >
            {t("emptyCta")}
          </Link>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {facts.map((fact) => (
            <li key={fact.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="text-sm leading-6">{factSentence(fact)}</span>
              <button
                type="button"
                data-testid={`narrative-chip-${fact.id}`}
                className="rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary print:hidden"
                onClick={chipAction(fact)}
              >
                {t(`chips.${fact.id}`)}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-muted-foreground">{t("computedFrom")}</p>
    </section>
  );
}
