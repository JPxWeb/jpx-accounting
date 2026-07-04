"use client";

/**
 * Widget visibility picker (Task 5.5), built on the NATIVE popover API per the
 * Phase 5 tech memo §3 (Baseline Widely Available): `popover="auto"` gives us
 * top-layer rendering plus Escape/outside-click light-dismiss for free — no
 * controlled-open state, no invisible-backdrop-button workaround. The entry
 * fade uses `@starting-style` (`starting:` variant) + `transition-discrete`.
 *
 * Widget titles arrive translated from the caller (the widget registry lands
 * with Task 5.8) — this component only owns chrome copy.
 */

import { useTranslations } from "next-intl";

const PICKER_POPOVER_ID = "dashboard-widget-picker";

export type WidgetPickerItem<Id extends string = string> = {
  id: Id;
  /** Already-translated widget title. */
  label: string;
  visible: boolean;
};

export type WidgetPickerProps<Id extends string> = {
  /** All widgets in display order, visible or not. */
  items: readonly WidgetPickerItem<Id>[];
  onToggle: (id: Id, nextVisible: boolean) => void;
  onReset: () => void;
};

export function WidgetPicker<Id extends string>({ items, onToggle, onReset }: WidgetPickerProps<Id>) {
  const t = useTranslations("dashboard.picker");

  return (
    <>
      <button
        type="button"
        data-testid="widget-picker-open"
        popoverTarget={PICKER_POPOVER_ID}
        className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary print:hidden"
      >
        {t("open")}
      </button>
      {/* Tailwind preflight zeroes margins, so `m-auto` restores the UA's
          top-layer centering (position: fixed; inset: 0). */}
      <div
        id={PICKER_POPOVER_ID}
        popover="auto"
        role="dialog"
        aria-label={t("title")}
        className="glass-panel m-auto w-80 max-w-[calc(100vw-2rem)] rounded-2xl p-4 text-foreground opacity-0 transition-[opacity,display,overlay] transition-discrete duration-150 open:opacity-100 starting:open:opacity-0"
      >
        <p className="text-eyebrow">{t("title")}</p>
        <p className="mt-2 text-sm text-muted-foreground">{t("description")}</p>
        <ul className="mt-3 space-y-1">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                data-testid={`widget-picker-toggle-${item.id}`}
                aria-pressed={item.visible}
                onClick={() => onToggle(item.id, !item.visible)}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="min-w-0 truncate">{item.label}</span>
                <span
                  className={`shrink-0 text-xs font-medium ${item.visible ? "text-primary" : "text-muted-foreground"}`}
                >
                  {item.visible ? t("shown") : t("hidden")}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-4 border-t border-border pt-3">
          <button
            type="button"
            data-testid="dashboard-reset"
            onClick={onReset}
            className="rounded-lg px-2 py-1.5 text-sm font-medium text-primary hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t("reset")}
          </button>
        </div>
      </div>
    </>
  );
}
