"use client";

import type { WorkspaceSnapshot } from "@jpx-accounting/contracts";
import { DEFAULT_TAG_DEFINITIONS, type TagDefinition, type VoucherTagsProjection } from "@jpx-accounting/domain";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { apiClient } from "../../lib/client";
import { useDialogFocusTrap } from "../../lib/focus-trap";

type TagDialog = { mode: "add" | "remove"; tagId?: string };
type TagSnapshot = WorkspaceSnapshot & { voucherTags?: VoucherTagsProjection[] };

function replaceVoucherTags(
  snapshot: TagSnapshot | undefined,
  projection: VoucherTagsProjection,
): TagSnapshot | undefined {
  if (!snapshot) return snapshot;
  const voucherTags = (snapshot.voucherTags ?? []).filter((row) => row.voucherId !== projection.voucherId);
  return { ...snapshot, voucherTags: [...voucherTags, projection] };
}

export function VoucherTagList({
  voucherId,
  tagIds,
  definitions = [...DEFAULT_TAG_DEFINITIONS],
}: {
  voucherId: string;
  tagIds: string[];
  definitions?: TagDefinition[];
}) {
  const t = useTranslations("books.ledger.tags");
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<TagDialog | null>(null);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const initialFocusRef = useRef<HTMLButtonElement | null>(null);
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

  const mutation = useMutation({
    mutationFn: ({ tagId, mode }: { tagId: string; mode: "add" | "remove" }) =>
      apiClient.appendVoucherTags(voucherId, { tagIds: [tagId], mode }),
    onSuccess: async (projection) => {
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      queryClient.setQueryData<TagSnapshot>(["workspace"], (snapshot) => replaceVoucherTags(snapshot, projection));
      closeDialog();
    },
  });

  const activeDefinitions = definitions.filter((definition) => tagIds.includes(definition.id));
  const availableDefinitions = definitions.filter((definition) => !tagIds.includes(definition.id));
  const selectedDefinition = definitions.find((definition) => definition.id === (dialog?.tagId ?? selectedTagId));
  const canConfirm = dialog?.mode === "remove" ? Boolean(dialog.tagId) : Boolean(selectedTagId);

  return (
    <section className="mt-4 border-t border-border pt-4" data-testid="ledger-slot-tags-active">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{t("title")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <button
          type="button"
          data-testid="tag-add"
          disabled={availableDefinitions.length === 0}
          onClick={() => {
            mutation.reset();
            setSelectedTagId(null);
            setDialog({ mode: "add" });
          }}
          className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-surface-muted disabled:opacity-50"
        >
          {t("add")}
        </button>
      </div>

      {activeDefinitions.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {activeDefinitions.map((definition) => (
            <li
              key={definition.id}
              data-testid={`tag-chip-${definition.id}`}
              className="inline-flex items-center rounded-full bg-primary-soft text-xs font-semibold text-primary"
            >
              <Link
                href={`/books?view=journal&tag=${encodeURIComponent(definition.id)}`}
                data-testid={`tag-filter-link-${definition.id}`}
                className="rounded-l-full py-1 pl-3 pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {definition.name}
              </Link>
              <button
                type="button"
                aria-label={t("removeAria", { tag: definition.name })}
                onClick={() => {
                  mutation.reset();
                  setDialog({ mode: "remove", tagId: definition.id });
                }}
                className="rounded-r-full py-1 pl-1 pr-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                ×
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
            aria-labelledby="tag-dialog-title"
            aria-describedby="tag-dialog-description"
            data-testid="tag-dialog"
            className="glass-chrome relative w-full max-w-md rounded-t-2xl p-5 pb-[calc(env(safe-area-inset-bottom)+144px)] shadow-xl sm:rounded-2xl sm:p-6 lg:pb-6"
          >
            <h2 id="tag-dialog-title" className="text-lg font-semibold text-foreground">
              {dialog.mode === "add" ? t("addTitle") : t("removeTitle")}
            </h2>
            <p id="tag-dialog-description" className="mt-2 text-sm leading-6 text-muted-foreground">
              {dialog.mode === "add"
                ? t("addConfirmDescription")
                : t("removeConfirmDescription", { tag: selectedDefinition?.name ?? "" })}
            </p>

            {dialog.mode === "add" ? (
              <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={t("registryAria")}>
                {availableDefinitions.map((definition, index) => (
                  <button
                    key={definition.id}
                    ref={index === 0 ? initialFocusRef : undefined}
                    type="button"
                    data-testid={`tag-option-${definition.id}`}
                    aria-pressed={selectedTagId === definition.id}
                    onClick={() => setSelectedTagId(definition.id)}
                    className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${
                      selectedTagId === definition.id
                        ? "border-primary bg-primary-soft text-primary"
                        : "border-border text-foreground"
                    }`}
                  >
                    {definition.name}
                  </button>
                ))}
              </div>
            ) : null}

            {mutation.isError ? (
              <p className="mt-4 text-sm text-danger" role="alert">
                {t("error")}
              </p>
            ) : null}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                ref={dialog.mode === "remove" ? initialFocusRef : undefined}
                type="button"
                disabled={mutation.isPending}
                onClick={closeDialog}
                className="rounded-lg border border-border px-4 py-2 text-sm font-semibold"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                data-testid="tag-confirm"
                disabled={mutation.isPending || !canConfirm}
                onClick={() => {
                  const tagId = dialog.tagId ?? selectedTagId;
                  if (tagId) mutation.mutate({ tagId, mode: dialog.mode });
                }}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {mutation.isPending ? t("working") : dialog.mode === "add" ? t("confirmAdd") : t("confirmRemove")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
