"use client";

import { useTranslations } from "next-intl";

import { usePeriodLabels, usePeriodScope } from "../../hooks/use-period-scope";
import { useWorkspaceProfile } from "../providers/workspace-profile-provider";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "../ui/select";
import { buildPeriodOptionGroups } from "./period-options";

/**
 * THE period selector — shared by Books and Reports (advisory-pivot Phase 4).
 * Grouped fiscal-aware presets from the unified token grammar; the selection
 * lives in the `?period=` URL param via `usePeriodScope`, so one token follows
 * the user across surfaces.
 */
export function PeriodSelector() {
  const { locale, fiscalYearStart } = useWorkspaceProfile();
  const t = useTranslations("common.period");
  const labels = usePeriodLabels();
  const { raw, setPeriod } = usePeriodScope();

  const groups = buildPeriodOptionGroups({ locale, fiscalYearStart, labels });
  const items = groups.flatMap((group) => group.options);

  return (
    <Select items={items} value={raw} onValueChange={(value) => void setPeriod(value)}>
      <SelectTrigger data-testid="period-selector" className="w-56" aria-label={t("selectorAria")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {groups.map((group) => (
          <SelectGroup key={group.key}>
            <SelectLabel>{t(`groups.${group.key}`)}</SelectLabel>
            {group.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
