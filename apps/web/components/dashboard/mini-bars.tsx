/**
 * Dependency-free inline-SVG mini bar chart for dashboard widgets (Task 5.8).
 * Zero-baselined so negative values honestly hang below the axis. Decorative
 * by contract (values are always rendered as text next to it) → `aria-hidden`.
 */

const WIDTH = 120;
const HEIGHT = 40;
const GAP = 2;

export function MiniBars({ values, className }: { values: number[]; className?: string }) {
  if (values.length === 0) return null;

  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  const scale = HEIGHT / range;
  const baselineY = max * scale;
  const barWidth = (WIDTH - GAP * (values.length - 1)) / values.length;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={className ?? "h-10 w-full text-primary"}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {min < 0 ? (
        <line x1={0} x2={WIDTH} y1={baselineY} y2={baselineY} stroke="currentColor" strokeWidth={0.5} opacity={0.4} />
      ) : null}
      {values.map((value, index) => {
        const height = Math.max(Math.abs(value) * scale, value === 0 ? 0 : 1);
        const y = value >= 0 ? baselineY - height : baselineY;
        return (
          <rect
            key={index}
            x={index * (barWidth + GAP)}
            y={y}
            width={barWidth}
            height={height}
            rx={1}
            fill="currentColor"
            opacity={value >= 0 ? 0.85 : 0.45}
          />
        );
      })}
    </svg>
  );
}
