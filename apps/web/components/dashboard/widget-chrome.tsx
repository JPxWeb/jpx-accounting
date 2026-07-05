"use client";

/**
 * Uniform card chrome shared by all nine dashboard widgets (Task 5.5):
 * glass-panel, eyebrow title, drag handle, optional drill link, remove button,
 * body slot. Widget CONTENT (Task 5.8) renders through `children`.
 *
 * The handle is a real `<button>` (tech memo §1) that receives the sortable
 * grid's `handleProps` — keyboard pickup lands on it natively.
 */

// GripVertical/X stay local instead of going through components/ui/icons.tsx:
// this task's file allowlist excludes shared files (icons consolidation is an
// exit-gate follow-up). strokeWidth matches the house 1.75 icon weight.
import { GripVertical, X } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { ReactNode } from "react";

export type WidgetChromeProps = {
  /** Widget id — drives the `widget-*` testids. */
  id: string;
  /** Already-translated widget title, rendered as the eyebrow. */
  title: string;
  /** From `SortableGrid`'s `renderItem` — spread onto the drag-handle button. */
  handleProps: { ref: (element: Element | null) => void };
  onRemove: () => void;
  /** Optional drill-down link (e.g. `/reports#cash-bridge`). */
  drill?: { href: string; label: string };
  isDragging?: boolean;
  children: ReactNode;
};

export function WidgetChrome({
  id,
  title,
  handleProps,
  onRemove,
  drill,
  isDragging = false,
  children,
}: WidgetChromeProps) {
  const t = useTranslations("dashboard.chrome");

  return (
    <section
      className={`glass-panel motion-lift flex h-full min-w-0 flex-col rounded-xl p-4 ${isDragging ? "opacity-80 shadow-lg" : ""}`}
      data-testid={`widget-${id}`}
      aria-label={title}
    >
      <header className="flex items-center gap-2">
        <button
          {...handleProps}
          type="button"
          data-testid={`widget-handle-${id}`}
          aria-label={t("dragHandleAria", { title })}
          className="-ml-1 shrink-0 cursor-grab touch-none rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary print:hidden"
        >
          <GripVertical className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
        <h3 className="text-eyebrow min-w-0 truncate">{title}</h3>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {drill ? (
            <Link
              href={drill.href}
              data-testid={`widget-drill-${id}`}
              className="rounded-md px-1.5 py-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary print:hidden"
            >
              {drill.label}
            </Link>
          ) : null}
          <button
            type="button"
            data-testid={`widget-remove-${id}`}
            aria-label={t("removeAria", { title })}
            onClick={onRemove}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary print:hidden"
          >
            <X className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </header>
      <div className="mt-3 min-w-0 flex-1">{children}</div>
    </section>
  );
}
