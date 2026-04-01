# Unified Radius System Design Spec

**Date:** 2026-04-01
**Status:** Approved
**Scope:** Replace the dual radius system (ui-tokens pixel values + shadcn calc values) with a single calc-based scale derived from `--radius: 0.75rem`. Update all component radius classes to follow a consistent Nordic Minimal hierarchy.

## Decision

**Direction:** Nordic Minimal — moderate rounding (12px base), professional, data-respecting. Matches Mercury, Linear, Klarna references.

**Base variable:** `--radius: 0.75rem` (12px) in `globals.css` `:root`. All other radii are derived via `@theme inline` calc multipliers.

## Radius Scale

| Tailwind class | Calc | Computed | Used for |
|---|---|---|---|
| `rounded-sm` | `--radius * 0.6` | ~7.2px | Tiny elements, inline badges |
| `rounded-md` | `--radius * 0.8` | ~9.6px | Buttons, inputs, selects, form controls |
| `rounded-lg` | `--radius` | 12px | **Base** — cards, panels, inner content |
| `rounded-xl` | `--radius * 1.4` | ~16.8px | Section panels, dialogs, sheets |
| `rounded-2xl` | `--radius * 1.8` | ~21.6px | Shell containers (sidebar, dock, top bar) |
| `rounded-full` | 9999px | pill | Badges, status indicators, avatars |

`rounded-3xl` and `rounded-4xl` are NOT used. Maximum rectangular radius is `rounded-2xl`.

## Hierarchy Rule

Nested elements use smaller or equal radius than their parent:

```
Shell container (rounded-2xl)
  -> Section panel (rounded-xl)
    -> Inner card (rounded-lg)
      -> Data cell (rounded-lg or rounded-md)
        -> Button/input (rounded-md)
```

## Changes Required

### 1. Remove pixel radii from ui-tokens

Delete the `--radius-*` properties from `packages/ui-tokens/styles.css`. The `@theme inline` block in `globals.css` is the single source of truth for Tailwind radius utilities.

### 2. Component class updates

| File | Element | Before | After |
|---|---|---|---|
| `app-shell.tsx:177` | Sidebar hero section | `rounded-4xl` | `rounded-2xl` |
| `app-shell.tsx:198` | Sidebar nav | `rounded-4xl` | `rounded-2xl` |
| `app-shell.tsx:236` | Sidebar capture section | `rounded-4xl` | `rounded-2xl` |
| `app-shell.tsx:257` | Sidebar innovation section | `rounded-4xl` | `rounded-2xl` |
| `app-shell.tsx:271` | Top bar | `rounded-3xl` | `rounded-2xl` |
| `app-shell.tsx:343` | Mobile dock | `rounded-3xl` | `rounded-2xl` |
| `app-shell.tsx:385` | Capture sheet dialog | `rounded-4xl` | `rounded-xl` |
| `app-shell.tsx:208` | Nav items | `rounded-2xl` | `rounded-lg` |
| `app-shell.tsx:215` | Nav icon bg | `rounded-xl` | `rounded-lg` |
| `app-shell.tsx:250` | Capture button desktop | `rounded-xl` | `rounded-md` |
| `app-shell.tsx:298` | Capture button mobile | `rounded-xl` | `rounded-md` |
| `app-shell.tsx:192` | Demo warning (sidebar) | `rounded-2xl` | `rounded-lg` |
| `app-shell.tsx:311` | Demo banner (main) | `rounded-2xl` | `rounded-lg` |
| `app-shell.tsx:328` | Capture status toast | `rounded-2xl` | `rounded-lg` |
| `app-shell.tsx:355` | Mobile dock nav items | `rounded-xl` | `rounded-lg` |
| `app-shell.tsx:405` | Capture sheet close btn | `rounded-xl` | `rounded-md` |
| `app-shell.tsx:422` | Capture sheet mode btns | `rounded-xl` | `rounded-lg` |
| `app-shell.tsx:290` | Date/location pill | `rounded-xl` | `rounded-lg` |
| `home-screen.tsx:150` | Review queue header | `rounded-3xl` | `rounded-xl` |
| `home-screen.tsx:166` | Simulate upload btn | `rounded-xl` | `rounded-md` |
| `home-screen.tsx:175` | Approve btn | `rounded-xl` | `rounded-md` |
| `home-screen.tsx:182` | Error banner | `rounded-2xl` | `rounded-lg` |
| `home-screen.tsx:202` | Review card | `rounded-3xl` | `rounded-xl` |
| `home-screen.tsx:205` | Review card preview | `rounded-2xl` | `rounded-lg` |
| `home-screen.tsx:218` | Supplier initials | `rounded-xl` | `rounded-lg` |
| `home-screen.tsx:239,245,251` | Data cells (date/gross/vat) | `rounded-xl` | `rounded-lg` |
| `home-screen.tsx:261,264,268` | Account/VAT/cite tags | `rounded-lg` | `rounded-md` |
| `home-screen.tsx:275` | AI suggestion panel | `rounded-2xl` | `rounded-lg` |
| `home-screen.tsx:282` | Rule hits disclosure | `rounded-2xl` | `rounded-lg` |
| `home-screen.tsx:286` | Individual rule hit | `rounded-xl` | `rounded-lg` |
| `home-screen.tsx:307` | VAT warning | `rounded-2xl` | `rounded-lg` |
| `home-screen.tsx:320` | Close copilot section | `rounded-3xl` | `rounded-xl` |
| `home-screen.tsx:330` | Close copilot items | `rounded-2xl` | `rounded-lg` |
| `home-screen.tsx:340` | Balance pulse section | `rounded-3xl` | `rounded-xl` |
| `home-screen.tsx:344` | Balance items | `rounded-2xl` | `rounded-lg` |
| `home-screen.tsx:359` | Alerts section | `rounded-3xl` | `rounded-xl` |
| `home-screen.tsx:363` | Alert items | `rounded-2xl` | `rounded-lg` |
| `reports-screen.tsx:63` | Journal section | `rounded-3xl` | `rounded-xl` |
| `reports-screen.tsx:72` | Journal metric cards | `rounded-2xl` | `rounded-lg` |
| `reports-screen.tsx:80` | Trial balance section | `rounded-3xl` | `rounded-xl` |
| `reports-screen.tsx:84` | Balance articles | `rounded-2xl` | `rounded-lg` |
| `reports-screen.tsx:95,101` | Debit/credit cells | `rounded-xl` | `rounded-lg` |
| `reports-screen.tsx:114` | VAT section | `rounded-3xl` | `rounded-xl` |
| `reports-screen.tsx:118` | VAT entries | `rounded-2xl` | `rounded-lg` |
| `settings-screen.tsx:16,34,43` | Settings sections | `rounded-3xl` | `rounded-xl` |
| `ui/metric-card.tsx:8` | Metric card | `rounded-2xl` | `rounded-lg` |
| `ui/status-badge.tsx:17` | Status badge | `rounded-lg` | `rounded-full` |

### 3. globals.css cleanup

Remove the custom `.skeleton` border-radius (uses `var(--radius-lg)` from ui-tokens) since shadcn Skeleton now handles this.

### 4. Skip-to-content link

The skip link in `layout.tsx` uses `rounded-lg` — keep as-is (correct for a small interactive element).

## Verification

1. `pnpm typecheck && pnpm build` pass
2. Visual check at 375px (mobile), 768px (tablet), 1440px (desktop)
3. Confirm no element has radius larger than its parent
4. Confirm the radial gradient background and glass-morphism still render correctly
5. E2E tests pass
