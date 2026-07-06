"use client";

type OnboardingProgressProps = {
  done: number;
  total: number;
  label: string;
  showDots?: boolean;
  progressTestId?: string;
};

export function OnboardingProgress({ done, total, label, showDots = true, progressTestId }: OnboardingProgressProps) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground" data-testid={progressTestId}>
          {label}
        </p>
        <p className="font-mono text-caption tabular-nums text-muted-foreground">
          {done}/{total}
        </p>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-surface-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-label={label}
      >
        <div
          className="h-full rounded-full bg-primary transition-all duration-normal motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
      {showDots ? (
        <div className="flex gap-1.5" aria-hidden="true">
          {Array.from({ length: total }, (_, index) => (
            <span key={index} className={`size-1.5 rounded-full ${index < done ? "bg-primary" : "bg-border"}`} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
