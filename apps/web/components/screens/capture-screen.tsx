"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { DraftsTable } from "../capture/drafts-table";
import { EvidenceArchiveTable } from "../capture/evidence-archive-table";
import { QuickAddGrid } from "../capture/quick-add-grid";
import { ScreenHeader } from "../ui/screen-header";

export function CaptureScreen() {
  const t = useTranslations("capture");
  const queryClient = useQueryClient();

  return (
    <div className="page-shell space-y-6">
      <ScreenHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      <QuickAddGrid onDraftSaved={() => queryClient.invalidateQueries({ queryKey: ["capture-drafts"] })} />
      <DraftsTable />
      <EvidenceArchiveTable />
    </div>
  );
}
