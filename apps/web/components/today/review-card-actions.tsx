"use client";

import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import type { ReviewAction } from "./filter-types";

type Props = {
  onAction: (action: ReviewAction) => void;
  disabled: boolean;
};

export function ReviewCardActions({ onAction, disabled }: Props) {
  return (
    <fieldset className="mt-4 flex flex-wrap gap-2 border-0 p-0 m-0">
      <legend className="sr-only">Review actions</legend>
      <Button onClick={() => onAction("accept")} disabled={disabled} data-testid="review-accept">
        Accept <Kbd>Y</Kbd>
      </Button>
      <Button variant="secondary" onClick={() => onAction("edit")} disabled={disabled} data-testid="review-edit">
        Edit <Kbd>E</Kbd>
      </Button>
      <Button
        variant="ghost"
        onClick={() => onAction("book-without-vat")}
        disabled={disabled}
        data-testid="review-book-without-vat"
      >
        Book w/o VAT <Kbd>B</Kbd>
      </Button>
      <Button variant="destructive" onClick={() => onAction("reject")} disabled={disabled} data-testid="review-reject">
        Reject <Kbd>N</Kbd>
      </Button>
    </fieldset>
  );
}
