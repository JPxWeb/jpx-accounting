"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { toast } from "sonner";

import { captureFiles } from "../../lib/promotion";
import { DraftsTable } from "../capture/drafts-table";
import { EvidenceArchiveTable } from "../capture/evidence-archive-table";
import { QuickAddGrid } from "../capture/quick-add-grid";
import { ScreenHeader } from "../ui/screen-header";

export function CaptureScreen() {
  const t = useTranslations("capture");
  const tPromotion = useTranslations("capture.promotion");
  const queryClient = useQueryClient();

  // Document-level Ctrl+V/Cmd+V: pasting a screenshot or copied image anywhere on the
  // capture page feeds the same pipeline as the tiles. Plain-text pastes (e.g. into the
  // archive search box) carry no files and pass through untouched.
  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      const files = [...(event.clipboardData?.files ?? [])];
      if (files.length === 0) {
        return;
      }

      event.preventDefault();
      void captureFiles(files, "paste", {
        queryClient,
        onPromoted: (draft) => toast.success(tPromotion("promoted", { name: draft.title })),
        onPromoteError: (draft) => toast.error(tPromotion("promoteError", { name: draft.title })),
      }).then((outcome) => {
        for (const rejection of outcome.rejected) {
          toast.error(
            tPromotion(rejection.reason === "size" ? "rejectedSize" : "rejectedType", { name: rejection.file.name }),
          );
        }
      });
    }

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [queryClient, tPromotion]);

  return (
    <div className="page-shell space-y-6">
      <ScreenHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      <QuickAddGrid onDraftSaved={() => queryClient.invalidateQueries({ queryKey: ["capture-drafts"] })} />
      <DraftsTable />
      <EvidenceArchiveTable />
    </div>
  );
}
