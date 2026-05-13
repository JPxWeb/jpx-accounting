"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { apiClient } from "../../lib/client";
import { SectionLabel } from "../ui/section-label";
import { StatusBadge } from "../ui/status-badge";

export function DigestPanel() {
  const { data } = useQuery({
    queryKey: ["workspace"],
    queryFn: () => apiClient.getSnapshot(),
  });

  if (!data) return null;

  const pendingCount = data.reviews.filter((r) => r.status === "needs-review").length;
  const closeReady = data.closeRun?.checklist.filter((c) => c.status === "ready").length ?? 0;
  const closeBlocked = data.closeRun?.checklist.filter((c) => c.status === "blocked").length ?? 0;
  const topAlert = data.alerts[0];

  return (
    <aside data-testid="ambient-digest" className="glass-panel-soft rounded-xl p-4 space-y-4">
      <div>
        <SectionLabel>Today&apos;s pulse</SectionLabel>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Link
            href="/today"
            className="rounded-md bg-[var(--color-accent-soft)] px-3 py-2 font-medium text-[var(--color-accent)]"
          >
            {pendingCount} pending
          </Link>
          <Link
            href="/books?view=close"
            className="rounded-md bg-[var(--color-info-soft)] px-3 py-2 font-medium text-[var(--color-info)]"
          >
            {closeReady} ready · {closeBlocked} blocked
          </Link>
        </div>
      </div>
      {topAlert ? (
        <div>
          <SectionLabel>Compliance</SectionLabel>
          <Link href="/settings/compliance" className="mt-3 block">
            <p className="text-sm font-semibold">{topAlert.title}</p>
            <StatusBadge status={topAlert.source} variant="warning" />
          </Link>
        </div>
      ) : null}
    </aside>
  );
}
