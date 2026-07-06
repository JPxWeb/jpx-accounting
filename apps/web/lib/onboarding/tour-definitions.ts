import type { Placement } from "react-joyride";

import { webRuntimeConfig } from "../runtime-config";
import type { TourId } from "./tour-ids";

export type TourBuildContext = {
  isMobile: boolean;
  isDemo: boolean;
  /** Pending reviews with status needs-review — drives review-gate branching. */
  pendingReviewCount?: number;
};

export type TourStepDefinition = {
  id: string;
  target: string | (() => HTMLElement | null);
  placement?: Placement;
  /** Navigate before the step renders. */
  route?: string;
  /** Optional flow diagram shown in the tour tooltip. */
  diagram?: { variant: "capture-pipeline" | "reports-drill"; activeIndex: number };
};

function visibleSelector(desktop: string, mobile: string) {
  return () => {
    const mobileEl = document.querySelector(mobile);
    if (mobileEl instanceof HTMLElement && mobileEl.offsetParent !== null) {
      return mobileEl;
    }
    const desktopEl = document.querySelector(desktop);
    return desktopEl instanceof HTMLElement ? desktopEl : null;
  };
}

function buildAppOrientationSteps(context: TourBuildContext): TourStepDefinition[] {
  const steps: TourStepDefinition[] = [
    {
      id: "checklist",
      target: '[data-tour="getting-started-widget"]',
      placement: "bottom",
      route: "/today",
    },
    {
      id: "navigation",
      target: visibleSelector('[data-tour="primary-nav-desktop"]', '[data-tour="primary-nav-mobile"]'),
      placement: context.isMobile ? "top" : "right",
    },
    {
      id: "capture",
      target: visibleSelector('[data-tour="capture-open-desktop"]', '[data-tour="capture-open-mobile"]'),
      placement: context.isMobile ? "top" : "left",
    },
  ];

  if (context.isDemo) {
    steps.push({
      id: "demo",
      target: '[data-tour="runtime-mode-banner"]',
      placement: "bottom",
    });
  }

  steps.push({
    id: "command-palette",
    target: '[data-tour="command-palette-open"]',
    placement: "bottom",
  });

  return steps;
}

function buildCaptureFlowSteps(): TourStepDefinition[] {
  return [
    {
      id: "dropzone",
      target: '[data-tour="capture-dropzone"]',
      route: "/capture",
      diagram: { variant: "capture-pipeline", activeIndex: 0 },
    },
    { id: "quick-add", target: '[data-tour="quick-add-grid"]' },
    { id: "drafts", target: '[data-tour="drafts-table"]' },
    { id: "archive", target: '[data-tour="evidence-archive"]' },
    { id: "sie", target: '[data-tour="quick-add-sie"]' },
  ];
}

function buildReviewGateSteps(context: TourBuildContext): TourStepDefinition[] {
  const base: TourStepDefinition[] = [
    { id: "queue-toggle", target: '[data-tour="today-view-queue"]', route: "/today?view=queue" },
  ];

  if ((context.pendingReviewCount ?? 0) === 0) {
    return [
      ...base,
      {
        id: "empty",
        target: '[data-tour="getting-started-widget"]',
        route: "/today",
        placement: "bottom",
      },
    ];
  }

  return [
    ...base,
    { id: "review-card", target: '[data-tour="review-card"]' },
    { id: "confidence", target: '[data-tour="confidence-band"]' },
    { id: "accept", target: '[data-tour="review-accept"]' },
    { id: "actions", target: '[data-tour="review-actions"]' },
  ];
}

function buildBooksPeriodSteps(): TourStepDefinition[] {
  return [
    { id: "period", target: '[data-testid="period-selector"]', route: "/books" },
    { id: "journal", target: '[data-tour="books-journal"]' },
    { id: "tabs", target: '[data-tour="books-tabs"]' },
    { id: "close", target: '[data-tour="books-close-tab"]' },
  ];
}

function buildReportsDrillSteps(): TourStepDefinition[] {
  return [
    { id: "period", target: '[data-testid="period-selector"]', route: "/reports" },
    { id: "kpis", target: '[data-testid="kpi-result"]' },
    { id: "narrative", target: '[data-testid="narrative-card"]' },
    {
      id: "drill",
      target: '[data-testid="bs-line"]',
      diagram: { variant: "reports-drill", activeIndex: 2 },
    },
    { id: "export", target: '[data-testid="export-sie"]' },
  ];
}

function buildAdvisorSteps(context: TourBuildContext): TourStepDefinition[] {
  const steps: TourStepDefinition[] = [];

  if (context.isMobile) {
    steps.push({
      id: "mobile-nav",
      target: '[data-tour="mobile-advisor-link"]',
      route: "/today",
      placement: "top",
    });
  } else {
    steps.push({
      id: "rail",
      target: '[data-tour="nav-advisor"]',
      route: "/assistant",
      placement: "right",
    });
  }

  steps.push(
    { id: "prompts", target: '[data-tour="advisor-prompts"]', route: "/assistant" },
    { id: "article50", target: '[data-testid="ai-assistant-label"]', route: "/assistant" },
    { id: "chat", target: '[data-tour="advisor-chat"]', route: "/assistant" },
  );

  return steps;
}

export function buildTourStepDefinitions(tourId: TourId, context?: Partial<TourBuildContext>): TourStepDefinition[] {
  const resolved: TourBuildContext = {
    isMobile: context?.isMobile ?? false,
    isDemo: context?.isDemo ?? webRuntimeConfig.runtimeMode === "demo",
  };

  switch (tourId) {
    case "app-orientation":
      return buildAppOrientationSteps(resolved);
    case "capture-flow":
      return buildCaptureFlowSteps();
    case "review-gate":
      return buildReviewGateSteps(resolved);
    case "books-period":
      return buildBooksPeriodSteps();
    case "reports-drill":
      return buildReportsDrillSteps();
    case "advisor":
      return buildAdvisorSteps(resolved);
    case "hint-mobile-advisor":
      return [{ id: "advisor", target: '[data-tour="mobile-advisor-link"]', route: "/today" }];
    case "hint-reports-drill":
      return [{ id: "drill", target: '[data-testid="bs-line"]', route: "/reports" }];
    default:
      return [];
  }
}
