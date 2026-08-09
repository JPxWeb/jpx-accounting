"use client";

import type { ExternalReferenceProjection } from "@jpx-accounting/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { apiClient } from "../../lib/client";
import { useDialogFocusTrap } from "../../lib/focus-trap";

type DialogState = { kind: "link" } | { kind: "unlink"; reference: ExternalReferenceProjection };

function referenceTitle(reference: ExternalReferenceProjection): string {
  return reference.label || new URL(reference.url).hostname;
}

export function ExternalReferenceList({
  voucherId,
  references,
}: {
  voucherId: string;
  references: ExternalReferenceProjection[];
}) {
  const t = useTranslations("books.ledger.externalReferences");
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const initialFocusRef = useRef<HTMLInputElement | HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const closeDialog = useCallback(() => setDialog(null), []);

  useEffect(() => {
    if (!dialog) return undefined;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const returnTarget = returnFocusRef.current;
      window.requestAnimationFrame(() => {
        if (returnTarget?.isConnected) returnTarget.focus();
      });
    };
  }, [dialog]);

  useDialogFocusTrap(panelRef, dialog !== null, closeDialog, initialFocusRef);

  const linkMutation = useMutation({
    mutationFn: () =>
      apiClient.linkVoucherExternalReference(voucherId, {
        url,
        ...(label.trim() ? { label: label.trim() } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      setUrl("");
      setLabel("");
      closeDialog();
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: (reference: ExternalReferenceProjection) =>
      apiClient.unlinkVoucherExternalReference(voucherId, reference.refId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      closeDialog();
    },
  });

  const busy = linkMutation.isPending || unlinkMutation.isPending;
  const mutationError = linkMutation.isError || unlinkMutation.isError;
  const validHttpsUrl = (() => {
    try {
      return new URL(url).protocol === "https:";
    } catch {
      return false;
    }
  })();

  return (
    <section className="mt-4 border-t border-border pt-4" data-testid="ledger-slot-externalRefs-active">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{t("title")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <button
          type="button"
          data-testid="external-ref-add"
          onClick={() => setDialog({ kind: "link" })}
          className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-surface-muted"
        >
          {t("add")}
        </button>
      </div>

      {references.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {references.map((reference) => (
            <li
              key={reference.refId}
              data-testid="external-ref-row"
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2"
            >
              <div className="min-w-0">
                <span className="mb-1 inline-flex rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">
                  {t("externalBadge")}
                </span>
                <a
                  href={reference.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate text-sm font-medium text-primary underline underline-offset-2"
                >
                  {referenceTitle(reference)}
                </a>
              </div>
              <button
                type="button"
                data-testid="external-ref-unlink"
                onClick={() => setDialog({ kind: "unlink", reference })}
                className="shrink-0 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground hover:bg-surface-muted"
              >
                {t("unlink")}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">{t("empty")}</p>
      )}

      {dialog ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/35 backdrop-blur-sm sm:items-center">
          <button type="button" aria-label={t("cancel")} className="absolute inset-0" onClick={closeDialog} />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="external-ref-dialog-title"
            className="glass-chrome relative w-full max-w-md rounded-t-2xl p-5 pb-[calc(env(safe-area-inset-bottom)+144px)] shadow-xl sm:rounded-2xl sm:p-6 lg:pb-6"
          >
            <h2 id="external-ref-dialog-title" className="text-lg font-semibold text-foreground">
              {dialog.kind === "link" ? t("linkTitle") : t("unlinkTitle")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {dialog.kind === "link" ? t("linkConfirmDescription") : t("unlinkConfirmDescription")}
            </p>

            {dialog.kind === "link" ? (
              <div className="mt-4 space-y-3">
                <label className="block text-sm font-medium text-foreground">
                  {t("urlLabel")}
                  <input
                    ref={(node) => {
                      initialFocusRef.current = node;
                    }}
                    type="url"
                    required
                    data-testid="external-ref-url"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-sm font-medium text-foreground">
                  {t("labelLabel")}
                  <input
                    type="text"
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                  />
                </label>
                {!validHttpsUrl && url ? <p className="text-sm text-danger">{t("httpsOnly")}</p> : null}
              </div>
            ) : null}

            {mutationError ? (
              <p className="mt-4 text-sm text-danger" role="alert">
                {t("error")}
              </p>
            ) : null}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                ref={(node) => {
                  if (dialog.kind === "unlink") initialFocusRef.current = node;
                }}
                type="button"
                disabled={busy}
                onClick={closeDialog}
                className="rounded-lg border border-border px-4 py-2 text-sm font-semibold"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                data-testid={dialog.kind === "link" ? "external-ref-confirm" : "external-ref-unlink-confirm"}
                disabled={busy || (dialog.kind === "link" && !validHttpsUrl)}
                onClick={() =>
                  dialog.kind === "link" ? linkMutation.mutate() : unlinkMutation.mutate(dialog.reference)
                }
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? t("working") : dialog.kind === "link" ? t("confirmLink") : t("confirmUnlink")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
