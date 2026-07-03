"use client";

import { useQuery } from "@tanstack/react-query";

import { apiClient } from "../../lib/client";
import { SectionLabel } from "../ui/section-label";
import { StatusBadge } from "../ui/status-badge";

function closeItemVariant(status: string) {
  if (status === "ready") return "accent" as const;
  if (status === "blocked") return "danger" as const;
  return "info" as const;
}

export function CloseView() {
  const { data } = useQuery({
    queryKey: ["workspace"],
    queryFn: () => apiClient.getSnapshot(),
  });

  const closeRun = data?.closeRun;

  return (
    <div className="space-y-4" data-testid="close-view">
      <p className="text-sm text-muted-foreground">Close runs are read-only in this build.</p>

      <section className="glass-panel rounded-xl p-5" data-testid="close-copilot-panel">
        <div className="flex items-center justify-between gap-3">
          <div>
            <SectionLabel>Close Copilot</SectionLabel>
            <h2 className="mt-2 text-xl font-semibold">Month-end stays visible while the queue moves.</h2>
          </div>
          <StatusBadge status="Advisory only" variant="accent" />
        </div>
        <div className="mt-4 space-y-3">
          {closeRun?.checklist.map((item) => (
            <div key={item.id} className="glass-panel-soft rounded-lg px-4 py-4">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-medium text-foreground">{item.label}</p>
                <StatusBadge status={item.status} variant={closeItemVariant(item.status)} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
