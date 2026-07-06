"use client";

import type { TooltipRenderProps } from "react-joyride";
import { useTranslations } from "next-intl";

import { OnboardingFlowDiagram } from "./onboarding-flow-diagram";

type StepDiagramData = {
  variant: "capture-pipeline" | "reports-drill";
  activeIndex: number;
};

function isStepDiagramData(value: unknown): value is StepDiagramData {
  if (typeof value !== "object" || value === null) return false;
  const row = value as StepDiagramData;
  return (row.variant === "capture-pipeline" || row.variant === "reports-drill") && typeof row.activeIndex === "number";
}

const DIAGRAM_NODE_KEYS: Record<StepDiagramData["variant"], readonly string[]> = {
  "capture-pipeline": ["capture", "review", "books"],
  "reports-drill": ["kpi", "narrative", "drill"],
};

export function TourTooltip({
  continuous,
  index,
  isLastStep,
  size,
  step,
  backProps,
  closeProps,
  primaryProps,
  skipProps,
  tooltipProps,
}: TooltipRenderProps) {
  const tDiagrams = useTranslations("onboarding.diagrams");
  const diagram = isStepDiagramData(step.data) ? step.data : null;
  const nodes = diagram
    ? DIAGRAM_NODE_KEYS[diagram.variant].map((nodeKey) => tDiagrams(`${diagram.variant}.${nodeKey}`))
    : [];

  return (
    <div
      {...tooltipProps}
      className="glass-chrome z-[10001] max-w-sm rounded-xl border border-border p-4 shadow-md"
      role="dialog"
      aria-modal="true"
      data-testid="onboarding-tour-tooltip"
    >
      {size > 1 ? (
        <div className="mb-3 flex gap-1.5" aria-hidden="true">
          {Array.from({ length: size }, (_, dotIndex) => (
            <span
              key={dotIndex}
              className={`size-1.5 rounded-full ${
                dotIndex < index ? "bg-success" : dotIndex === index ? "bg-primary" : "bg-border"
              }`}
            />
          ))}
        </div>
      ) : null}
      {step.title ? <h3 className="text-base font-semibold text-foreground">{step.title}</h3> : null}
      <div className={`text-sm leading-6 text-muted-foreground ${step.title ? "mt-2" : ""}`}>{step.content}</div>
      {diagram && nodes.length > 0 ? <OnboardingFlowDiagram nodes={nodes} activeIndex={diagram.activeIndex} /> : null}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {index > 0 ? (
            <button
              type="button"
              {...backProps}
              className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground"
            >
              {backProps.title}
            </button>
          ) : null}
          {continuous ? (
            <button
              type="button"
              {...skipProps}
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              {skipProps.title}
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {size > 1 ? (
            <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
              {index + 1}/{size}
            </span>
          ) : null}
          <button
            type="button"
            {...primaryProps}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm"
          >
            {isLastStep ? primaryProps.title : primaryProps.title}
          </button>
          <button
            type="button"
            {...closeProps}
            aria-label={closeProps.title}
            className="rounded-lg px-2 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}
