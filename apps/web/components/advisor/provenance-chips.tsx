"use client";

import { useTranslations } from "next-intl";
import type { KnowledgePassage } from "@jpx-accounting/advisor";

/**
 * Sourced-passage chips for a `data-provenance` part: one chip per retrieved
 * passage, labeled with its verbatim source citation and linking to the
 * official page when the corpus carries one. Provenance, not decoration —
 * every chip maps 1:1 to a passage the answer was grounded in.
 */
export function ProvenanceChips({ passages }: { passages: KnowledgePassage[] }) {
  const t = useTranslations("advisor.provenance");

  if (passages.length === 0) return null;

  const chipClass =
    "inline-flex max-w-72 items-center gap-1 truncate rounded-lg bg-info-soft px-2.5 py-1 text-caption font-medium text-info";

  return (
    <ul className="flex flex-wrap gap-2" aria-label={t("aria")}>
      {passages.map((passage) => (
        <li key={passage.id} className="min-w-0">
          {passage.url ? (
            <a
              href={passage.url}
              target="_blank"
              rel="noreferrer"
              data-testid="provenance-chip"
              title={passage.title}
              className={`${chipClass} underline-offset-2 hover:underline`}
            >
              {passage.source}
            </a>
          ) : (
            <span data-testid="provenance-chip" title={passage.title} className={chipClass}>
              {passage.source}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
