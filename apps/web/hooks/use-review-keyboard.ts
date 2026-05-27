import type { ReviewTask } from "@jpx-accounting/contracts";
import { useHotkeys } from "react-hotkeys-hook";

type UseReviewKeyboardArgs = {
  reviews: ReviewTask[];
  focusedId: string | null;
  setFocusedId: (id: string | null) => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onEdit: (id: string) => void;
  onBookWithoutVat: (id: string) => void;
};

export function useReviewKeyboard({
  reviews,
  focusedId,
  setFocusedId,
  onAccept,
  onReject,
  onEdit,
  onBookWithoutVat,
}: UseReviewKeyboardArgs): void {
  function navigate(delta: 1 | -1) {
    if (reviews.length === 0) return;
    if (focusedId === null) {
      const first = reviews[0];
      if (first) setFocusedId(first.id);
      return;
    }
    const currentIndex = reviews.findIndex((r) => r.id === focusedId);
    const next = reviews[currentIndex + delta];
    if (next) setFocusedId(next.id);
  }

  function runOnFocused(action: (id: string) => void) {
    if (focusedId === null || reviews.length === 0) return;
    action(focusedId);
  }

  useHotkeys("j", () => navigate(1));
  useHotkeys("k", () => navigate(-1));
  useHotkeys("y,enter", () => runOnFocused(onAccept));
  useHotkeys("n", () => runOnFocused(onReject));
  useHotkeys("e", () => runOnFocused(onEdit));
  useHotkeys("b", () => runOnFocused(onBookWithoutVat));
}
