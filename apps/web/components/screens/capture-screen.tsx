"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { parseAsInteger, parseAsString, useQueryStates } from "nuqs";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { saveCaptureDraft } from "../../lib/draft-queue";
import { captureFiles } from "../../lib/promotion";
import { DraftsTable } from "../capture/drafts-table";
import { EvidenceArchiveTable } from "../capture/evidence-archive-table";
import { QuickAddGrid } from "../capture/quick-add-grid";
import { ScreenHeader } from "../ui/screen-header";

export function CaptureScreen() {
  const t = useTranslations("capture");
  const tPromotion = useTranslations("capture.promotion");
  const tShared = useTranslations("capture.shared");
  const queryClient = useQueryClient();

  // share_target params (see apps/web/app/share/route.ts): title/text/url describe a
  // param-only share, promoted=<n> reports files staged server-side, shared=1&pending=<n>
  // is the legacy fallback when files could not be staged.
  const [shareParams, setShareParams] = useQueryStates({
    title: parseAsString,
    text: parseAsString,
    url: parseAsString,
    shared: parseAsString,
    pending: parseAsInteger,
    promoted: parseAsInteger,
  });
  const { title, text, url, shared, pending, promoted } = shareParams;

  // Ref guard: Strict Mode double-invokes effects and the params are cleared
  // asynchronously — without the guard the same share would create two drafts.
  // Clearing the params afterwards means a refresh cannot re-create the draft either.
  const shareConsumedRef = useRef(false);

  useEffect(() => {
    const hasShareContent = Boolean(title || text || url);
    const promotedCount = promoted ?? 0;
    if (!hasShareContent && promotedCount <= 0) {
      return;
    }
    if (shareConsumedRef.current) {
      return;
    }
    shareConsumedRef.current = true;

    if (hasShareContent) {
      // ONE metadata draft per share — the user promotes it from the drafts table.
      void saveCaptureDraft({
        id: crypto.randomUUID(),
        mode: "share",
        title: title || text || url || "share",
        createdAt: new Date().toISOString(),
        ...(text ? { text } : {}),
        ...(url ? { sourceUrl: url } : {}),
      }).then(() => {
        void queryClient.invalidateQueries({ queryKey: ["capture-drafts"] });
        toast.success(tShared("draftSaved"));
      });
    }

    if (promotedCount > 0) {
      toast.success(tShared("promoted", { count: promotedCount }));
    }

    void setShareParams({ title: null, text: null, url: null, promoted: null });
  }, [title, text, url, promoted, queryClient, setShareParams, tShared]);

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

  const pendingSharedCount = shared === "1" ? (pending ?? 0) : 0;

  return (
    <div className="page-shell space-y-6">
      <ScreenHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      {pendingSharedCount > 0 ? (
        <div className="glass-panel rounded-xl p-4 text-sm" role="status" data-testid="capture-shared-banner">
          {tShared("pendingBanner", { count: pendingSharedCount })}
        </div>
      ) : null}
      <QuickAddGrid onDraftSaved={() => queryClient.invalidateQueries({ queryKey: ["capture-drafts"] })} />
      <DraftsTable />
      <EvidenceArchiveTable />
    </div>
  );
}
