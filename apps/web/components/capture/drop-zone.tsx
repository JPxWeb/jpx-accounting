"use client";

import { useTranslations } from "next-intl";
import type { RefObject } from "react";
import { useRef, useState } from "react";

import { CAPTURE_ACCEPT } from "../../lib/promotion";

type DropZoneProps = {
  /**
   * Receives every dropped/picked file. Type + size filtering (image/* + PDF, 16 MB cap)
   * happens once inside `captureFiles` so drag-drop, file picker, camera, and paste all
   * enforce identical limits — callers surface the rejections it reports.
   */
  onFiles: (files: File[]) => void;
  /**
   * Optional external handle on the hidden file input so sibling triggers (the quick-add
   * Upload tile) can open the same picker instead of mounting a second input.
   */
  inputRef?: RefObject<HTMLInputElement | null>;
};

export function DropZone({ onFiles, inputRef }: DropZoneProps) {
  const t = useTranslations("capture.dropzone");
  const localInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = inputRef ?? localInputRef;
  const [dragActive, setDragActive] = useState(false);

  function emitFiles(list: FileList | null | undefined) {
    const files = [...(list ?? [])];
    if (files.length > 0) {
      onFiles(files);
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t("aria")}
      data-testid="capture-dropzone"
      data-tour="capture-dropzone"
      data-drag-active={dragActive || undefined}
      onClick={() => fileInputRef.current?.click()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          fileInputRef.current?.click();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        emitFiles(event.dataTransfer?.files);
      }}
      className={`glass-panel-soft capture-drop-zone flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        dragActive ? "border-primary bg-primary/5" : "border-border"
      }`}
    >
      <p className="text-sm font-semibold text-foreground">{t("title")}</p>
      <p className="text-xs text-muted-foreground">{t("hint")}</p>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={CAPTURE_ACCEPT}
        className="hidden"
        data-testid="capture-file-input"
        onChange={(event) => {
          emitFiles(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}
