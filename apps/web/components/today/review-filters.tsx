"use client";

import { useTranslations } from "next-intl";
import { parseAsString, parseAsStringEnum, useQueryState } from "nuqs";

import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { type ConfidenceFilter, confidenceFilters, type StatusFilter, statusFilters } from "./filter-types";

export function ReviewFilters() {
  const t = useTranslations("today.filters");
  // Same H/M/L vocabulary as the review-card chip and the dashboard widget —
  // the bands come from the shared `confidenceBand()` (0.85/0.6), so the old
  // hardcoded ≥95%/80–94%/<80% labels would lie about the cut-offs.
  const tBand = useTranslations("today.card.band");
  const [status, setStatus] = useQueryState(
    "status",
    parseAsStringEnum<StatusFilter>([...statusFilters]).withDefault("all"),
  );
  const [supplier, setSupplier] = useQueryState("supplier", parseAsString.withDefault(""));
  const [confidence, setConfidence] = useQueryState(
    "confidence",
    parseAsStringEnum<ConfidenceFilter>([...confidenceFilters]).withDefault("all"),
  );

  // Base UI ToggleGroup binds value as an array even in single-select mode; coerce both directions.
  const toggleValue = status === "all" ? [] : [status];

  function handleStatusChange(groupValue: string[]) {
    if (groupValue.length === 0) {
      void setStatus("all");
      return;
    }
    const last = groupValue[groupValue.length - 1] as StatusFilter;
    void setStatus(last);
  }

  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="review-filters">
      <ToggleGroup
        value={toggleValue}
        onValueChange={handleStatusChange}
        variant="outline"
        aria-label={t("statusAria")}
      >
        <ToggleGroupItem value="all" aria-label={t("all")}>
          {t("all")}
        </ToggleGroupItem>
        <ToggleGroupItem value="needs-review" aria-label={t("needsReview")}>
          {t("needsReview")}
        </ToggleGroupItem>
        <ToggleGroupItem value="blocked" aria-label={t("blocked")}>
          {t("blocked")}
        </ToggleGroupItem>
        <ToggleGroupItem value="approved" aria-label={t("approved")}>
          {t("approved")}
        </ToggleGroupItem>
      </ToggleGroup>
      <Input
        type="search"
        placeholder={t("supplierPlaceholder")}
        value={supplier}
        onChange={(e) => void setSupplier((e.target as HTMLInputElement).value || null)}
        className="w-56"
        data-testid="supplier-filter"
      />
      <Select value={confidence} onValueChange={(value) => void setConfidence(value as ConfidenceFilter)}>
        <SelectTrigger className="w-44" data-testid="confidence-filter" aria-label={t("confidenceAria")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("allConfidence")}</SelectItem>
          <SelectItem value="high">{tBand("high")}</SelectItem>
          <SelectItem value="medium">{tBand("medium")}</SelectItem>
          <SelectItem value="low">{tBand("low")}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
