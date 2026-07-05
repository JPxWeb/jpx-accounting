/**
 * Chart bundle barrel (advisory-pivot Phase 4, Task 4.7).
 *
 * The reports screen's `next/dynamic` calls ALL import this ONE module and
 * pick their export from it. With three separate specifiers Turbopack builds
 * three chunk groups, each embedding its own ~290 kB recharts core (verified
 * against the build output) — one shared specifier means one chunk group and
 * recharts downloaded once.
 *
 * NEVER import this barrel (or the chart modules) statically — that would
 * pull recharts into the eager reports chunk. `chart-kit.tsx` is the only
 * chart module safe for static import (it is deliberately recharts-free).
 */
export { CashBridgeChart } from "./cash-bridge-chart";
export { MonthlyBarsChart } from "./monthly-bars-chart";
export { Sparkline } from "./sparkline";
