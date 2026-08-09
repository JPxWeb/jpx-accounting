"use client";

import type { ProjectsListRow } from "@jpx-accounting/contracts";
import { useTranslations } from "next-intl";

export function ProjectsListPanel({
  rows,
  onOpen,
}: {
  rows: ProjectsListRow[];
  onOpen: (row: ProjectsListRow) => void;
}) {
  const t = useTranslations("books.lists.projects");

  return (
    <section
      data-testid="projects-list-panel"
      aria-labelledby="projects-heading"
      className="glass-panel rounded-xl p-5"
    >
      <h2 id="projects-heading" className="text-lg font-semibold text-foreground">
        {t("title")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                data-testid="projects-list-row"
                onClick={() => onOpen(row)}
                disabled={row.voucherIds.length === 0}
                className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-3 text-left hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span>
                  <span className="block font-medium text-foreground">{row.name}</span>
                  <span className="text-xs text-muted-foreground">{row.id}</span>
                </span>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {t("activityCount", { count: row.activityCount })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
