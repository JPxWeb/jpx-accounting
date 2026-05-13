"use client";

import { parseAsString, parseAsStringEnum, useQueryState } from "nuqs";

import { Input } from "../ui/input";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

const statuses = ["all", "needs-review", "blocked", "approved"] as const;
type Status = (typeof statuses)[number];

const confidences = ["all", "high", "medium", "low"] as const;
type Confidence = (typeof confidences)[number];

export function ReviewFilters() {
  const [status, setStatus] = useQueryState("status", parseAsStringEnum<Status>([...statuses]).withDefault("all"));
  const [supplier, setSupplier] = useQueryState("supplier", parseAsString.withDefault(""));
  const [confidence, setConfidence] = useQueryState(
    "confidence",
    parseAsStringEnum<Confidence>([...confidences]).withDefault("all"),
  );

  // base-ui ToggleGroup uses array value; we simulate single-select
  const toggleValue = status === "all" ? [] : [status];

  function handleStatusChange(groupValue: string[]) {
    if (groupValue.length === 0) {
      void setStatus("all");
      return;
    }
    // Last selected value wins
    const last = groupValue[groupValue.length - 1] as Status;
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
      <select
        value={confidence}
        onChange={(e) => void setConfidence(e.target.value as Confidence)}
        className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1.5 text-sm"
        data-testid="confidence-filter"
        aria-label="Filter by confidence"
      >
        <option value="all">All confidence</option>
        <option value="high">≥95%</option>
        <option value="medium">80–94%</option>
        <option value="low">&lt;80%</option>
      </select>
    </div>
  );
}
