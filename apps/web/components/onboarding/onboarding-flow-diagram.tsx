"use client";

export function OnboardingFlowDiagram({ nodes, activeIndex }: { nodes: string[]; activeIndex: number }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 py-2" aria-hidden="true">
      {nodes.map((label, index) => (
        <span key={`${label}-${index}`} className="flex items-center gap-1.5">
          <span
            className={`glass-panel-soft rounded-lg px-2 py-1 text-xs font-medium ${
              index === activeIndex ? "ring-2 ring-primary" : ""
            }`}
          >
            {label}
          </span>
          {index < nodes.length - 1 ? <span className="text-muted-foreground">→</span> : null}
        </span>
      ))}
    </div>
  );
}
