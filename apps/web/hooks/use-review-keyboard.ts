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
  useHotkeys("y,enter", (event) => {
    // Enter on a focused button/link must only activate that control: focusing
    // any control inside a card sets `focusedId` (ReviewCard onFocus), so
    // without this guard a keyboard user pressing Enter on e.g. the Edit
    // button would BOTH open the edit sheet and fire the approve hotkey —
    // racing an unedited approval past the editor. Y stays a bare hotkey.
    if (
      event.key === "Enter" &&
      event.target instanceof Element &&
      event.target.closest("button, a, [role='button']")
    ) {
      return;
    }
    runOnFocused(onAccept);
  });
  useHotkeys("n", () => runOnFocused(onReject));
  useHotkeys("e", () => runOnFocused(onEdit));
  useHotkeys("b", () => runOnFocused(onBookWithoutVat));
}
