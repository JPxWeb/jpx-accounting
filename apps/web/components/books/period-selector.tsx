"use client";

import { usePeriodScope } from "../../hooks/use-period-scope";
import { useWorkspaceProfile } from "../providers/workspace-profile-provider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

function lastTwelveMonths(locale: string) {
  const months: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString(locale, { year: "numeric", month: "long" });
    months.push({ value, label });
  }
  return months;
}

export function PeriodSelector() {
  const { locale } = useWorkspaceProfile();
  const { raw, setPeriod } = usePeriodScope();
  const options = lastTwelveMonths(locale);
  return (
    <Select value={raw} onValueChange={(value) => setPeriod(value)}>
      <SelectTrigger data-testid="period-selector" className="w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
