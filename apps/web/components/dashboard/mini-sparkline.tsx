/**
 * Dependency-free inline-SVG sparkline for dashboard widgets (Task 5.8).
 * Deliberately NOT the reports chart kit: the Today chunk stays recharts-free
 * (plan finding 11). Decorative by contract — every number a sparkline hints
 * at is also rendered as text, so the SVG is `aria-hidden`.
 */

const WIDTH = 120;
const HEIGHT = 32;
const PADDING = 2;

export function MiniSparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length === 0) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const innerWidth = WIDTH - PADDING * 2;
  const innerHeight = HEIGHT - PADDING * 2;
  const step = values.length > 1 ? innerWidth / (values.length - 1) : 0;

  const points = values
    .map((value, index) => {
      const x = PADDING + (values.length > 1 ? index * step : innerWidth / 2);
      // Flat series (range 0) draws a midline instead of dividing by zero.
      const y = PADDING + (range === 0 ? innerHeight / 2 : innerHeight - ((value - min) / range) * innerHeight);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={className ?? "h-8 w-full text-primary"}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
