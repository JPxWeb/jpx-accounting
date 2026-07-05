import type { ComponentType } from "react";

import type { WidgetId } from "../../lib/dashboard-layout-core";
import type { DashboardData } from "./use-dashboard-data";
import { CashBridgeWidget } from "./widgets/cash-bridge-widget";
import { CashPositionWidget } from "./widgets/cash-position-widget";
import { GettingStartedWidget } from "./widgets/getting-started-widget";
import { IntegrityWidget } from "./widgets/integrity-widget";
import { ObservationsWidget } from "./widgets/observations-widget";
import { RecentActivityWidget } from "./widgets/recent-activity-widget";
import { ResultWidget } from "./widgets/result-widget";
import { ReviewQueueWidget } from "./widgets/review-queue-widget";
import { TaxTimelineWidget } from "./widgets/tax-timeline-widget";
import { VatStatusWidget } from "./widgets/vat-status-widget";

export type DashboardWidgetProps = { data: DashboardData };

export type WidgetRegistryEntry = {
  component: ComponentType<DashboardWidgetProps>;
  /** Chrome drill link target — where this widget's numbers live in full. */
  drillHref?: string;
};

/**
 * The ten dashboard widgets (Task 5.8 + the Task 6.1 getting-started
 * checklist), keyed by the layout core's canonical ids. Titles are NOT here —
 * they are i18n messages resolved by the dashboard
 * (`dashboard.widgets.<id>.title`), which also feeds the picker labels.
 */
export const WIDGET_REGISTRY: Record<WidgetId, WidgetRegistryEntry> = {
  "cash-position": { component: CashPositionWidget, drillHref: "/reports#cash-bridge" },
  "review-queue": { component: ReviewQueueWidget, drillHref: "/today?view=queue" },
  "tax-timeline": { component: TaxTimelineWidget, drillHref: "/reports#tax-timeline" },
  observations: { component: ObservationsWidget },
  result: { component: ResultWidget, drillHref: "/reports" },
  "cash-bridge": { component: CashBridgeWidget, drillHref: "/reports#cash-bridge" },
  "vat-status": { component: VatStatusWidget, drillHref: "/reports#vat-preparation" },
  "recent-activity": { component: RecentActivityWidget, drillHref: "/books" },
  integrity: { component: IntegrityWidget },
  // No drill link — every checklist step is its own link to its surface.
  "getting-started": { component: GettingStartedWidget },
};
