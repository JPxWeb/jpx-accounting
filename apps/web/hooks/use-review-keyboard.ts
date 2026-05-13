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
  // Navigate down
  useHotkeys("j", () => {
    if (reviews.length === 0) return;
    if (focusedId === null) {
      const first = reviews[0];
      if (first) setFocusedId(first.id);
      return;
    }
    const currentIndex = reviews.findIndex((r) => r.id === focusedId);
    const nextIndex = currentIndex + 1;
    const next = reviews[nextIndex];
    if (next) {
      setFocusedId(next.id);
    }
  });

  // Navigate up
  useHotkeys("k", () => {
    if (reviews.length === 0) return;
    if (focusedId === null) {
      const first = reviews[0];
      if (first) setFocusedId(first.id);
      return;
    }
    const currentIndex = reviews.findIndex((r) => r.id === focusedId);
    const prevIndex = currentIndex - 1;
    const prev = reviews[prevIndex];
    if (prev) {
      setFocusedId(prev.id);
    }
  });

  // Accept (y or enter)
  useHotkeys("y,enter", () => {
    if (focusedId === null || reviews.length === 0) return;
    onAccept(focusedId);
  });

  // Reject
  useHotkeys("n", () => {
    if (focusedId === null || reviews.length === 0) return;
    onReject(focusedId);
  });

  // Edit
  useHotkeys("e", () => {
    if (focusedId === null || reviews.length === 0) return;
    onEdit(focusedId);
  });

  // Book without VAT
  useHotkeys("b", () => {
    if (focusedId === null || reviews.length === 0) return;
    onBookWithoutVat(focusedId);
  });
}
