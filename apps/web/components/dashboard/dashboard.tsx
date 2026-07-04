"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { type WidgetId } from "../../lib/dashboard-layout-core";
import { useDashboardLayout } from "../../lib/dashboard-layout-storage";
import { getErrorMessage } from "../../lib/request-errors";
import { withViewTransition } from "../../lib/view-transition";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenSkeleton } from "../ui/skeleton";
import { UnavailableState } from "../ui/unavailable-state";
import { SortableGrid } from "./sortable-grid";
import { useDashboardData } from "./use-dashboard-data";
import { WIDGET_REGISTRY } from "./widget-registry";
import { WidgetChrome } from "./widget-chrome";
import { WidgetPicker } from "./widget-picker";

/**
 * The Today advisory dashboard (Task 5.8): nine widgets on shared queries in a
 * keyboard- and long-press-sortable grid, with a popover picker and persisted
 * layout (localStorage + BroadcastChannel). Discrete layout mutations
 * (add/remove/reset) run inside `withViewTransition`; drag reorders are
 * animated by the sortable itself and NEVER wrapped in a view transition.
 */
export function Dashboard({ viewToggle }: { viewToggle?: ReactNode }) {
  const t = useTranslations("dashboard");
  const { layout, visibleIds, move, add, remove, reset } = useDashboardLayout();
  const data = useDashboardData();

  if (data.snapshotError && !data.snapshot) {
    return (
      <UnavailableState
        testId="workspace-unavailable"
        title="Workspace unavailable"
        message={getErrorMessage(
          data.snapshotError,
          "The accounting workspace could not be loaded. Check the runtime configuration and API availability.",
        )}
      />
    );
  }

  if (!data.snapshot) {
    return <ScreenSkeleton />;
  }

  const widgetTitle = (id: WidgetId) => t(`widgets.${id}.title`);
  const hidden = new Set(layout.hidden);
  const pickerItems = layout.order.map((id) => ({ id, label: widgetTitle(id), visible: !hidden.has(id) }));

  return (
    <div className="page-shell space-y-6">
      <ScreenHeader
        eyebrow={t("header.eyebrow")}
        title={t("header.title")}
        description={t("header.description")}
        aside={
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {viewToggle}
            <WidgetPicker
              items={pickerItems}
              onToggle={(id, nextVisible) => withViewTransition(() => (nextVisible ? add(id) : remove(id)))}
              onReset={() => withViewTransition(reset)}
            />
          </div>
        }
      />

      <div data-testid="dashboard-canvas">
        {visibleIds.length === 0 ? (
          <div className="glass-panel rounded-xl p-8 text-center">
            <p className="text-sm text-muted-foreground">{t("emptyCanvas")}</p>
          </div>
        ) : (
          <SortableGrid
            ids={visibleIds}
            onReorder={move}
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
            renderItem={({ id, handleProps, isDragging }) => {
              const entry = WIDGET_REGISTRY[id];
              const Widget = entry.component;
              return (
                <WidgetChrome
                  id={id}
                  title={widgetTitle(id)}
                  handleProps={handleProps}
                  isDragging={isDragging}
                  onRemove={() => withViewTransition(() => remove(id))}
                  {...(entry.drillHref ? { drill: { href: entry.drillHref, label: t("chrome.open") } } : {})}
                >
                  <Widget data={data} />
                </WidgetChrome>
              );
            }}
          />
        )}
      </div>
    </div>
  );
}
