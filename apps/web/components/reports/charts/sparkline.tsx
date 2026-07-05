"use client";

import { Line, LineChart, ResponsiveContainer } from "recharts";

/**
 * Axis-less KPI sparkline (advisory-pivot Phase 4, Task 4.7). Purely
 * decorative context for the trailing-12-months series behind a KPI tile —
 * the tile's `Money` value is the accessible text, so the whole plot is
 * `aria-hidden` (and the recharts accessibility layer is disabled: a
 * focusable element inside `aria-hidden` would fail axe's aria-hidden-focus).
 */
export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) {
    return null;
  }
  const data = values.map((value, index) => ({ index, value }));
  return (
    <div aria-hidden="true" className="mt-3 h-10 min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} accessibilityLayer={false} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--chart-1)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
