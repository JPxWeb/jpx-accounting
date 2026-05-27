# UI/UX Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all critical and high-priority issues from the UI/UX Pro Max design audit: accessibility (EAA compliance), interaction polish, loading states, and button consistency.

**Architecture:** CSS-first fixes in `globals.css` for global rules (focus, cursor, reduced-motion). Component-level fixes in individual `.tsx` files for ARIA labels, loading states, and touch targets. No new dependencies — all fixes use existing Tailwind utilities and CSS custom properties.

**Tech Stack:** Tailwind CSS v4, Motion 12, existing design tokens from `@jpx-accounting/ui-tokens`.

---

## File Structure

| Action | Path                                               | Responsibility                                                                    |
| ------ | -------------------------------------------------- | --------------------------------------------------------------------------------- |
| Modify | `apps/web/app/globals.css`                         | Focus styles, cursor rules, reduced-motion, button sizes, animation timing tokens |
| Modify | `apps/web/app/layout.tsx`                          | Skip-to-content link                                                              |
| Modify | `apps/web/components/app-shell.tsx`                | ARIA labels on icon buttons, mobile dock touch targets, capture button labels     |
| Modify | `apps/web/components/screens/home-screen.tsx`      | Button loading states, ARIA improvements                                          |
| Modify | `apps/web/components/screens/assistant-screen.tsx` | Textarea aria-label, submit button loading state                                  |
| Modify | `apps/web/components/screens/reports-screen.tsx`   | Reduced-motion on section animation                                               |
| Modify | `packages/ui-tokens/styles.css`                    | Animation timing tokens                                                           |

---

## Task 1: Add global focus-visible styles and cursor rules

**Files:**

- Modify: `apps/web/app/globals.css`

These are the two most impactful accessibility fixes: visible focus indicators for keyboard users and correct cursor feedback for interactive elements.

- [ ] **Step 1: Add focus-visible styles after the `* { box-sizing }` rule (line 37)**

In `apps/web/app/globals.css`, add after the `* { box-sizing: border-box; }` block:

```css
/* Keyboard focus indicator — visible only for keyboard navigation, not mouse clicks */
*:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

/* Remove default outline for mouse users */
*:focus:not(:focus-visible) {
  outline: none;
}
```

- [ ] **Step 2: Add cursor rules after the existing `button` transition block (line 208)**

After the existing `button:active:not(:disabled)` block, add:

```css
button:not(:disabled),
[role="button"]:not(:disabled),
summary {
  cursor: pointer;
}

button:disabled,
[role="button"][aria-disabled="true"] {
  cursor: not-allowed;
}
```

- [ ] **Step 3: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/globals.css
git commit -m "fix(a11y): add focus-visible indicators and cursor rules for interactive elements"
```

---

## Task 2: Add prefers-reduced-motion support

**Files:**

- Modify: `apps/web/app/globals.css`
- Modify: `packages/ui-tokens/styles.css`

This is required for EAA (European Accessibility Act) compliance. Users who enable "reduce motion" in their OS settings should see no animations.

- [ ] **Step 1: Add animation timing custom properties to ui-tokens**

In `packages/ui-tokens/styles.css`, add at the end of the `:root` block (before the closing `}`):

```css
/* Animation timing */
--duration-fast: 100ms;
--duration-normal: 200ms;
--duration-slow: 300ms;
```

- [ ] **Step 2: Add reduced-motion media query at the end of globals.css**

Add at the very end of `apps/web/app/globals.css`:

```css
/* Respect user preference for reduced motion — EAA/WCAG 2.2 compliance */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }

  .skeleton {
    animation: none;
    background: var(--color-surface-muted);
  }
}
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/globals.css packages/ui-tokens/styles.css
git commit -m "fix(a11y): add prefers-reduced-motion support and animation timing tokens"
```

---

## Task 3: Add skip-to-content link in root layout

**Files:**

- Modify: `apps/web/app/layout.tsx`

Screen reader and keyboard users need a way to skip past the navigation directly to the main content.

- [ ] **Step 1: Add skip link as first child of `<body>`**

In `apps/web/app/layout.tsx`, replace the `<body>` content:

```tsx
<body>
  <a
    href="#main-content"
    className="fixed left-2 top-2 z-[100] -translate-y-full rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition focus:translate-y-0"
  >
    Skip to content
  </a>
  <QueryProvider>
    <ServiceWorkerRegistrar />
    {children}
  </QueryProvider>
</body>
```

- [ ] **Step 2: Add the target id on the main element**

In `apps/web/components/app-shell.tsx`, find the `<main>` element (line 318):

```tsx
<main className="workspace-canvas">{children}</main>
```

Change to:

```tsx
<main id="main-content" className="workspace-canvas">
  {children}
</main>
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/layout.tsx apps/web/components/app-shell.tsx
git commit -m "fix(a11y): add skip-to-content link for keyboard and screen reader users"
```

---

## Task 4: Add ARIA labels to icon-only buttons and fix mobile dock touch targets

**Files:**

- Modify: `apps/web/components/app-shell.tsx`

Icon-only buttons without text labels are invisible to screen readers. Mobile dock buttons are too small for comfortable touch.

- [ ] **Step 1: Add aria-label to capture buttons**

Find the desktop capture button (line 246-254):

```tsx
<button
  type="button"
  onClick={openCaptureSheet}
  data-testid="capture-open-desktop"
  className="capture-button-desktop mt-4 w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-accent)] px-5 py-4 text-sm font-semibold text-white shadow-[var(--shadow-md)]"
>
  <CaptureIcon className="size-4" />
  Capture Evidence
</button>
```

This button has text, so it's fine. But find the mobile capture button (line 294-302):

```tsx
<button
  type="button"
  onClick={openCaptureSheet}
  data-testid="capture-open-mobile"
  className="capture-button-mobile flex items-center gap-2 rounded-xl bg-[var(--color-accent)] px-5 py-4 text-sm font-semibold text-white shadow-[var(--shadow-sm)] lg:hidden"
>
  <CaptureIcon className="size-4" />
  Capture
</button>
```

This also has text — fine. Now find the close button in the capture sheet (line 397-404):

```tsx
<button
  type="button"
  onClick={() => closeCaptureSheet()}
  data-testid="capture-close"
  className="rounded-xl bg-white/72 px-3 py-2 text-sm font-medium text-[var(--color-text-muted)]"
>
  Close
</button>
```

Add `aria-label`:

```tsx
<button
  type="button"
  onClick={() => closeCaptureSheet()}
  data-testid="capture-close"
  aria-label="Close capture sheet"
  className="rounded-xl bg-white/72 px-3 py-2 text-sm font-medium text-[var(--color-text-muted)]"
>
  Close
</button>
```

- [ ] **Step 2: Fix mobile dock touch targets**

Find the mobile dock grid (line 343):

```tsx
<div className="grid grid-cols-4 gap-1">
```

Change to:

```tsx
<div className="grid grid-cols-4 gap-2">
```

Then find the mobile dock link (line 352):

```tsx
className={`flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2.5 text-center text-caption font-medium transition ${
```

Change to (increase padding for 48px minimum touch target):

```tsx
className={`flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-3 text-center text-caption font-medium transition ${
```

- [ ] **Step 3: Add aria-label to mobile dock navigation items**

Each mobile dock link shows only an icon + short label. Add explicit `aria-label` with the full summary for screen readers. Find the mobile dock Link (lines 348-359):

```tsx
<Link
  key={item.href}
  href={item.href}
  aria-current={active ? "page" : undefined}
  className={`flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-3 text-center text-caption font-medium transition ${
    active ? "bg-[var(--color-accent)] text-white" : "text-[var(--color-text-muted)]"
  }`}
>
  <Icon className="size-4" />
  {item.label}
</Link>
```

Add `aria-label`:

```tsx
<Link
  key={item.href}
  href={item.href}
  aria-current={active ? "page" : undefined}
  aria-label={`${item.label} — ${item.summary}`}
  className={`flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-3 text-center text-caption font-medium transition ${
    active ? "bg-[var(--color-accent)] text-white" : "text-[var(--color-text-muted)]"
  }`}
>
  <Icon className="size-4" aria-hidden="true" />
  {item.label}
</Link>
```

Also mark the Icon as `aria-hidden` since the label provides the accessible name.

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/app-shell.tsx
git commit -m "fix(a11y): add ARIA labels to buttons, increase mobile dock touch targets"
```

---

## Task 5: Add button loading states to home screen

**Files:**

- Modify: `apps/web/components/screens/home-screen.tsx`

Buttons that trigger async operations must show visual feedback during loading, not just become disabled.

- [ ] **Step 1: Update the "Create sample receipt" button**

Find the button (lines 161-168):

```tsx
<button
  type="button"
  onClick={() => createEvidence.mutate()}
  data-testid="simulate-upload"
  className="glass-panel-soft rounded-xl px-4 py-2.5 text-sm font-medium text-[var(--color-text)]"
>
  Create sample receipt
</button>
```

Replace with:

```tsx
<button
  type="button"
  onClick={() => createEvidence.mutate()}
  disabled={createEvidence.isPending}
  data-testid="simulate-upload"
  className="glass-panel-soft rounded-xl px-4 py-2.5 text-sm font-medium text-[var(--color-text)] disabled:opacity-60"
>
  {createEvidence.isPending ? "Creating\u2026" : "Create sample receipt"}
</button>
```

- [ ] **Step 2: Update the "Approve next review" button**

Find the button (lines 169-177):

```tsx
<button
  type="button"
  onClick={() => approveFirst.mutate()}
  data-testid="approve-first"
  disabled={!firstPendingReview || approveFirst.isPending}
  className="rounded-xl bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white shadow-[var(--shadow-accent)] disabled:cursor-not-allowed disabled:opacity-60"
>
  Approve next review
</button>
```

Replace with:

```tsx
<button
  type="button"
  onClick={() => approveFirst.mutate()}
  data-testid="approve-first"
  disabled={!firstPendingReview || approveFirst.isPending}
  className="rounded-xl bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white shadow-[var(--shadow-accent)] disabled:cursor-not-allowed disabled:opacity-60"
>
  {approveFirst.isPending ? "Approving\u2026" : "Approve next review"}
</button>
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/screens/home-screen.tsx
git commit -m "fix(ux): add loading text to async action buttons on home screen"
```

---

## Task 6: Add loading state and aria-label to assistant screen

**Files:**

- Modify: `apps/web/components/screens/assistant-screen.tsx`

The assistant submit button needs loading feedback and the textarea needs an explicit ARIA label for screen readers (it has `id` and a `<label>` via SectionLabel, but let's reinforce with `aria-describedby`).

- [ ] **Step 1: Add aria-describedby to textarea**

Find the textarea (lines 74-79):

```tsx
<textarea
  id="assistant-question"
  data-testid="assistant-question"
  value={question}
  onChange={(event) => setQuestion(event.target.value)}
  className="glass-panel-inset mt-3 min-h-36 w-full rounded-xl px-4 py-4 text-sm outline-none"
/>
```

Add `aria-describedby` and a description element:

```tsx
<textarea
  id="assistant-question"
  data-testid="assistant-question"
  aria-describedby="assistant-question-hint"
  value={question}
  onChange={(event) => setQuestion(event.target.value)}
  className="glass-panel-inset mt-3 min-h-36 w-full rounded-xl px-4 py-4 text-sm outline-none"
/>
<p id="assistant-question-hint" className="mt-2 text-xs text-[var(--color-text-muted)]">
  The advisor cites Swedish tax law and internal policy. Responses never change the ledger.
</p>
```

- [ ] **Step 2: Add loading state to submit button**

Find the submit button (lines 81-88):

```tsx
<button
  type="button"
  onClick={() => assistant.mutate(question)}
  data-testid="assistant-submit"
  className="mt-4 rounded-xl bg-[var(--color-accent)] px-5 py-3 text-sm font-semibold text-white"
>
  Run advisory pass
</button>
```

Replace with:

```tsx
<button
  type="button"
  onClick={() => assistant.mutate(question)}
  disabled={assistant.isPending || !question.trim()}
  data-testid="assistant-submit"
  className="mt-4 rounded-xl bg-[var(--color-accent)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
>
  {assistant.isPending ? "Running\u2026" : "Run advisory pass"}
</button>
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/screens/assistant-screen.tsx
git commit -m "fix(a11y): add textarea description and button loading state to assistant screen"
```

---

## Task 7: Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 2: Run unit tests**

Run: `pnpm test:unit`
Expected: PASS (11/11)

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: PASS (or only pre-existing warnings)

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 5: Run E2E tests**

Run: `pnpm test:e2e`
Expected: PASS — accessibility changes should not break any existing tests. The mobile dock touch target increase and ARIA label additions are additive.

- [ ] **Step 6: Manual accessibility check**

Open the dev server (`pnpm dev:web`) and verify:

1. Tab through the page — every interactive element shows a teal outline
2. Enable "Reduce motion" in OS settings — verify no animations play
3. Use a screen reader or browser accessibility inspector — verify all buttons have accessible names
4. On mobile viewport (375px) — verify dock buttons are comfortable to tap
5. Press Tab on page load — the "Skip to content" link appears at the top
