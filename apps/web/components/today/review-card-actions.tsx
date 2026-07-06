"use client";

import { useTranslations } from "next-intl";

import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import type { ReviewAction } from "./filter-types";

type Props = {
  onAction: (action: ReviewAction) => void;
  disabled: boolean;
};

export function ReviewCardActions({ onAction, disabled }: Props) {
  const t = useTranslations("today.actions");

  return (
    <fieldset className="mt-4 flex flex-wrap gap-2 border-0 p-0 m-0" data-tour="review-actions">
      <legend className="sr-only">{t("legend")}</legend>
      <Button
        onClick={() => onAction("accept")}
        disabled={disabled}
        data-testid="review-accept"
        data-tour="review-accept"
      >
        {t("accept")} <Kbd>Y</Kbd>
      </Button>
      <Button variant="secondary" onClick={() => onAction("edit")} disabled={disabled} data-testid="review-edit">
        {t("edit")} <Kbd>E</Kbd>
      </Button>
      <Button
        variant="ghost"
        onClick={() => onAction("book-without-vat")}
        disabled={disabled}
        data-testid="review-book-without-vat"
      >
        {t("bookWithoutVat")} <Kbd>B</Kbd>
      </Button>
      <Button variant="destructive" onClick={() => onAction("reject")} disabled={disabled} data-testid="review-reject">
        {t("reject")} <Kbd>N</Kbd>
      </Button>
    </fieldset>
  );
}
