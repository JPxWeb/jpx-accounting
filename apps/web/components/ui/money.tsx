"use client";

import { formatMoney } from "@/lib/presentation";
import { cn } from "@/lib/utils";
import { useWorkspaceProfile } from "../providers/workspace-profile-provider";

/**
 * The one way to render an amount: tabular mono digits formatted with the
 * workspace profile's locale + currency (spec §2.9).
 */
export function Money({ value, className }: { value: number | undefined; className?: string }) {
  const profile = useWorkspaceProfile();
  return <span className={cn("font-mono tabular-nums", className)}>{formatMoney(value, profile)}</span>;
}
