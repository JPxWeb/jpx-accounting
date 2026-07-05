"use client";

/**
 * THE dnd-kit abstraction (Phase 5 tech memo §1). `@dnd-kit/react` 0.5.0 is a
 * 0.x pin — every dnd-kit import in the app lives in THIS file so a version
 * bump touches one file (the exit-gate grep enforces it).
 *
 * Verified against the installed 0.5.0 package (types + dist), which already
 * ships the memo's intent as defaults — we deliberately ride them:
 * - Sensors default to `[PointerSensor, KeyboardSensor]` (`defaultPreset`).
 * - KeyboardSensor: Space/Enter picks up, arrows move, Esc cancels, with
 *   built-in ARIA live-region announcements (Accessibility plugin).
 * - PointerSensor activation is long-press on touch (`Delay {value: 250,
 *   tolerance: 5}`) and immediate for mouse on the drag handle. The memo's
 *   `tolerance: 8` variant is not reachable without importing constraint
 *   classes from the undeclared transitive `@dnd-kit/dom` package, so the
 *   package default (250ms/5px) is the locked behavior.
 * - `useSortable`'s default plugins include `OptimisticSortingPlugin`: items
 *   reflow optimistically DURING the drag; state commits once via
 *   `onReorder(nextOrder)` on drop (`move()` no-ops canceled operations).
 */

import { move } from "@dnd-kit/helpers";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import type { ReactNode } from "react";

export type SortableGridRenderItemArgs<Id extends string> = {
  id: Id;
  /** Spread onto the real `<button>` acting as the drag handle. */
  handleProps: { ref: (element: Element | null) => void };
  isDragging: boolean;
};

export type SortableGridProps<Id extends string> = {
  /** Current render order — the single source of truth (persisted layout). */
  ids: readonly Id[];
  /** Called once per completed drop with the full next ordering. */
  onReorder: (nextOrder: Id[]) => void;
  renderItem: (args: SortableGridRenderItemArgs<Id>) => ReactNode;
  /** Applied to the grid container (e.g. `grid gap-4 sm:grid-cols-2 xl:grid-cols-3`). */
  className?: string;
};

export function SortableGrid<Id extends string>({ ids, onReorder, renderItem, className }: SortableGridProps<Id>) {
  return (
    <DragDropProvider
      onDragEnd={(event) => {
        if (event.canceled) return;
        const next = move([...ids], event);
        if (next.some((id, index) => id !== ids[index])) {
          onReorder(next);
        }
      }}
    >
      <div className={className}>
        {ids.map((id, index) => (
          <SortableGridItem key={id} id={id} index={index} renderItem={renderItem} />
        ))}
      </div>
    </DragDropProvider>
  );
}

function SortableGridItem<Id extends string>({
  id,
  index,
  renderItem,
}: {
  id: Id;
  index: number;
  renderItem: (args: SortableGridRenderItemArgs<Id>) => ReactNode;
}) {
  const { ref, handleRef, isDragging } = useSortable({ id, index });
  return (
    <div ref={ref} className="min-w-0" data-dragging={isDragging || undefined}>
      {renderItem({ id, handleProps: { ref: handleRef }, isDragging })}
    </div>
  );
}
