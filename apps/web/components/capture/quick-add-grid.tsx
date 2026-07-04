"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { captureFiles } from "../../lib/promotion";
import { DropZone } from "./drop-zone";

const TILE_MODES = ["camera", "upload", "paste", "share"] as const;

export function QuickAddGrid({ onDraftSaved }: { onDraftSaved?: () => void }) {
  const t = useTranslations("capture.quickAdd");
  const tPromotion = useTranslations("capture.promotion");
  const queryClient = useQueryClient();
  const sieInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const tiles = TILE_MODES.map((mode) => ({
    mode,
    label: t(`tiles.${mode}.label`),
    hint: t(`tiles.${mode}.hint`),
  }));

  async function handleFiles(files: File[], mode: string) {
    const outcome = await captureFiles(files, mode, {
      queryClient,
      onPromoted: (draft) => toast.success(tPromotion("promoted", { name: draft.title })),
      onPromoteError: (draft) => toast.error(tPromotion("promoteError", { name: draft.title })),
    });

    for (const rejection of outcome.rejected) {
      toast.error(
        tPromotion(rejection.reason === "size" ? "rejectedSize" : "rejectedType", { name: rejection.file.name }),
      );
    }

    if (outcome.saved.length > 0) {
      onDraftSaved?.();
    }
  }

  async function handlePasteTile() {
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (!clipboard || typeof clipboard.read !== "function") {
      toast.info(t("pasteUnavailable"));
      return;
    }

    try {
      const items = await clipboard.read();
      const files: File[] = [];
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) {
          continue;
        }
        const blob = await item.getType(imageType);
        const extension = imageType.split("/")[1] ?? "png";
        // Uniqueness comes from the draft id / uploadId, not the filename.
        files.push(new File([blob], `pasted-image-${files.length + 1}.${extension}`, { type: imageType }));
      }

      if (files.length === 0) {
        toast.info(t("pasteEmpty"));
        return;
      }

      await handleFiles(files, "paste");
    } catch {
      // Permission denied or unsupported — the document-level Ctrl+V listener on this page still works.
      toast.info(t("pasteUnavailable"));
    }
  }

  function handleTile(mode: (typeof TILE_MODES)[number]) {
    if (mode === "camera") {
      cameraInputRef.current?.click();
      return;
    }
    if (mode === "upload") {
      // The Upload tile opens the drop-zone's picker so both surfaces share one input.
      uploadInputRef.current?.click();
      return;
    }
    if (mode === "paste") {
      void handlePasteTile();
      return;
    }
    // Share intake arrives through the PWA share_target — the tile can only point at it.
    toast.info(t("shareHint"));
  }

  async function importSie(file: File) {
    setImporting(true);
    try {
      const text = await file.text();
      const response = await fetch("/api-proxy/api/imports/sie", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: text,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const result = (await response.json()) as { importedTransactions: number };
      toast.success(t("imported", { count: result.importedTransactions }));
    } catch {
      toast.error(t("importError"));
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="glass-panel rounded-xl p-5" data-testid="quick-add-grid">
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      <div className="mt-4">
        <DropZone inputRef={uploadInputRef} onFiles={(files) => void handleFiles(files, "upload")} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((tile) => (
          <button
            key={tile.mode}
            type="button"
            data-testid={`quick-add-${tile.mode}`}
            onClick={() => handleTile(tile.mode)}
            className="glass-panel-soft rounded-lg p-4 text-left"
          >
            <p className="text-sm font-semibold text-foreground">{tile.label}</p>
            <p className="mt-1 text-xs text-muted-foreground">{tile.hint}</p>
          </button>
        ))}
      </div>
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        data-testid="capture-camera-input"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          if (files.length > 0) {
            void handleFiles(files, "camera");
          }
          event.target.value = "";
        }}
      />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="quick-add-sie"
          disabled={importing}
          onClick={() => sieInputRef.current?.click()}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-60"
        >
          {importing ? t("importing") : t("importSie")}
        </button>
        <input
          ref={sieInputRef}
          type="file"
          accept=".sie,.se,text/plain"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importSie(file);
            event.target.value = "";
          }}
        />
        <Link href="/settings/integrations" className="text-sm underline" data-testid="quick-add-bank">
          {t("connectBank")}
        </Link>
      </div>
    </section>
  );
}
