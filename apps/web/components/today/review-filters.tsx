"use client";

import { parseAsString, parseAsStringEnum, useQueryState } from "nuqs";

import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { type ConfidenceFilter, confidenceFilters, type StatusFilter, statusFilters } from "./filter-types";

export function ReviewFilters() {
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
        aria-label="Filter by status"
      >
        <ToggleGroupItem value="all" aria-label="All">
          All
        </ToggleGroupItem>
        <ToggleGroupItem value="needs-review" aria-label="Needs review">
          Needs review
        </ToggleGroupItem>
        <ToggleGroupItem value="blocked" aria-label="Blocked">
          Blocked
        </ToggleGroupItem>
        <ToggleGroupItem value="approved" aria-label="Approved">
          Approved
        </ToggleGroupItem>
      </ToggleGroup>
      <Input
        type="search"
        placeholder="Filter by supplier..."
        value={supplier}
        onChange={(e) => void setSupplier((e.target as HTMLInputElement).value || null)}
        className="w-56"
        data-testid="supplier-filter"
      />
      <Select value={confidence} onValueChange={(value) => void setConfidence(value as ConfidenceFilter)}>
        <SelectTrigger className="w-44" data-testid="confidence-filter" aria-label="Filter by confidence">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All confidence</SelectItem>
          <SelectItem value="high">≥95%</SelectItem>
          <SelectItem value="medium">80–94%</SelectItem>
          <SelectItem value="low">&lt;80%</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
