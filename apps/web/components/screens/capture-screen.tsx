"use client";

import { useQueryClient } from "@tanstack/react-query";

import { DraftsTable } from "../capture/drafts-table";
import { EvidenceArchiveTable } from "../capture/evidence-archive-table";
import { QuickAddGrid } from "../capture/quick-add-grid";
import { ScreenHeader } from "../ui/screen-header";

export function CaptureScreen() {
  const queryClient = useQueryClient();

  return (
    <div className="page-shell space-y-6">
      <ScreenHeader
        eyebrow="Capture"
        title="Add evidence, see drafts, browse the archive."
        description="The single home for everything you've captured — drafts in progress, freshly uploaded, fully archived."
      />
      <QuickAddGrid onDraftSaved={() => queryClient.invalidateQueries({ queryKey: ["capture-drafts"] })} />
      <DraftsTable />
      <EvidenceArchiveTable />
    </div>
  );
}
