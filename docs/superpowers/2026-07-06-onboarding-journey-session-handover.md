# Onboarding journey — session handover (2026-07-06)

## Shipped

Checklist-driven onboarding on `/today` (Getting Started widget) plus opt-in React Joyride 3.1 tours, milestone toasts, review hotkey strip, micro-hints (mobile advisor + reports drill), tour blockers on overlays/drawers, Settings → About replay panel.

Plan: [`plans/2026-07-06-gamification-journey.md`](./plans/2026-07-06-gamification-journey.md). Quest overlay layer was dropped during simplify review.

## Incidents fixed this session

1. **React #185 on tour start** — `touchTourStarted()` dispatched a synthetic `StorageEvent` during the click handler while `useSyncExternalStore` subscribed; removed the call (field was analytics-only, never read in UI).
2. **Tours showed no tooltip** — react-joyride v3 ignores `disableBeacon`; steps need `skipBeacon: true`.
3. **Settings replay crash** — "Show me around" on About must not call `resetAllTours()` + `startTour()` in one handler; replay uses `force: true` only (reset is a separate button).
4. **Windows/agent shells** — root `package.json` nested scripts and Playwright `webServer` use `corepack pnpm` when bare `pnpm` is not on PATH.

## Verification

- `pnpm check` green
- `tests/e2e/onboarding.spec.ts` — 10/10 (desktop + mobile)
- Unit: `milestone-derivation`, `onboarding-storage`

## Conventions

See CONVENTIONS rule 29 (Joyride v3 + localStorage subscription timing).
