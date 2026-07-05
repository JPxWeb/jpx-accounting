/**
 * Progressive-enhancement wrapper around same-document View Transitions
 * (Phase 5 tech memo §3: raw `document.startViewTransition()` is Baseline
 * Newly Available — the React/Next `<ViewTransition>` component API is
 * explicitly NOT built on this phase).
 *
 * Use for discrete dashboard layout mutations (widget add / remove / reset).
 * Never call during an active drag — dnd-kit owns those frames — and reorder
 * commits on drop are already animated by the sortable's own transitions.
 */
export function withViewTransition(mutate: () => void): void {
  if (
    typeof document === "undefined" ||
    typeof document.startViewTransition !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    mutate();
    return;
  }
  document.startViewTransition(() => {
    mutate();
  });
}
