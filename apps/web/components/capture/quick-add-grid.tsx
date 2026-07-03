"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { saveCaptureDraft } from "../../lib/draft-queue";

const TILES: { mode: string; label: string; hint: string }[] = [
  { mode: "camera", label: "Camera", hint: "Snap a receipt with the device camera" },
  { mode: "upload", label: "Upload", hint: "Pick a PDF or image from disk" },
  { mode: "paste", label: "Paste", hint: "Paste an image from clipboard" },
  { mode: "share", label: "Share", hint: "Receive from another app via PWA share" },
];

export function QuickAddGrid({ onDraftSaved }: { onDraftSaved?: () => void }) {
  const sieInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  async function addDraft(mode: string, label: string) {
    try {
      await saveCaptureDraft({
        id: crypto.randomUUID(),
        mode,
        title: `${label} draft`,
        createdAt: new Date().toISOString(),
      });
      toast.success(`${label} draft added.`);
      onDraftSaved?.();
    } catch {
      toast.error(`Could not save ${label.toLowerCase()} draft locally.`);
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
      toast.success(`Imported ${result.importedTransactions} transactions from SIE.`);
    } catch {
      toast.error("Could not import the SIE file.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="glass-panel rounded-xl p-5" data-testid="quick-add-grid">
      <h2 className="text-lg font-semibold">Quick add</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Each tile creates a local draft you can promote into ledger evidence.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {TILES.map((tile) => (
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
          {importing ? "Importing…" : "Import SIE file"}
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
          Connect bank feed
        </Link>
      </div>
    </section>
  );
}
