"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { saveCaptureDraft } from "../../lib/draft-queue";

const TILE_MODES = ["camera", "upload", "paste", "share"] as const;

export function QuickAddGrid({ onDraftSaved }: { onDraftSaved?: () => void }) {
  const t = useTranslations("capture.quickAdd");
  const sieInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const tiles = TILE_MODES.map((mode) => ({
    mode,
    label: t(`tiles.${mode}.label`),
    hint: t(`tiles.${mode}.hint`),
  }));

  async function addDraft(mode: string, label: string) {
    try {
      await saveCaptureDraft({
        id: crypto.randomUUID(),
        mode,
        title: t("draftTitle", { mode: label }),
        createdAt: new Date().toISOString(),
      });
      toast.success(t("draftAdded", { mode: label }));
      onDraftSaved?.();
    } catch {
      toast.error(t("draftError", { mode: label.toLowerCase() }));
    }
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
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((tile) => (
          <button
            key={tile.mode}
            type="button"
            data-testid={`quick-add-${tile.mode}`}
            onClick={() => void addDraft(tile.mode, tile.label)}
            className="glass-panel-soft rounded-lg p-4 text-left"
          >
            <p className="text-sm font-semibold text-foreground">{tile.label}</p>
            <p className="mt-1 text-xs text-muted-foreground">{tile.hint}</p>
          </button>
        ))}
      </div>
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
