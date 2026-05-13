"use client";

import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";

type Props = {
  onAccept: () => void;
  onReject: () => void;
  onEdit: () => void;
  onBookWithoutVat: () => void;
  disabled: boolean;
};

export function ReviewCardActions({ onAccept, onReject, onEdit, onBookWithoutVat, disabled }: Props) {
  return (
    <fieldset className="mt-4 flex flex-wrap gap-2 border-0 p-0 m-0">
      <legend className="sr-only">Review actions</legend>
      <Button onClick={onAccept} disabled={disabled} data-testid="review-accept">
        Accept <Kbd>Y</Kbd>
      </Button>
      <Button variant="secondary" onClick={onEdit} disabled={disabled} data-testid="review-edit">
        Edit <Kbd>E</Kbd>
      </Button>
      <Button variant="ghost" onClick={onBookWithoutVat} disabled={disabled} data-testid="review-book-without-vat">
        Book w/o VAT <Kbd>B</Kbd>
      </Button>
      <Button variant="destructive" onClick={onReject} disabled={disabled} data-testid="review-reject">
        Reject <Kbd>N</Kbd>
      </Button>
    </fieldset>
  );
}
