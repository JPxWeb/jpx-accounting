"use client";

import type { EnrichmentWorkItem } from "@jpx-accounting/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { parseAsString, useQueryState } from "nuqs";
import { useCallback, useEffect, useRef } from "react";

import { apiClient } from "../../lib/client";
import { useDialogFocusTrap } from "../../lib/focus-trap";

const STATUS_KEYS = {
  pending_confirmation: "pending",
  confirmed: "confirmed",
  rejected: "rejected",
  superseded: "superseded",
} as const;

export function EnrichmentConfirmShell() {
  const t = useTranslations("books.ledger.enrichmentConfirm");
  const [workItemId, setWorkItemId] = useQueryState("enrichmentWorkItem", parseAsString);
  const queryClient = useQueryClient();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const open = workItemId !== null;

  const close = useCallback(() => {
    void setWorkItemId(null);
  }, [setWorkItemId]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const returnTarget = returnFocusRef.current;
      window.requestAnimationFrame(() => {
        if (returnTarget?.isConnected) {
          returnTarget.focus();
        }
      });
    };
  }, [open]);

  useDialogFocusTrap(panelRef, open, close, closeButtonRef);

  const queryKey = ["enrichment-work-item", workItemId] as const;
  const workItemQuery = useQuery({
    queryKey,
    queryFn: () => apiClient.getEnrichmentWorkItem(workItemId!),
    enabled: open,
    retry: false,
  });

  const decisionMutation = useMutation({
    mutationFn: async (decision: "confirm" | "reject") => {
      if (!workItemId) {
        throw new Error("Missing enrichment work-item id.");
      }
      return decision === "confirm"
        ? apiClient.confirmEnrichmentWorkItem(workItemId)
        : apiClient.rejectEnrichmentWorkItem(workItemId);
    },
    onSuccess: async (workItem) => {
      queryClient.setQueryData<EnrichmentWorkItem>(queryKey, workItem);
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });

  if (!open) {
    return null;
  }

  const workItem = workItemQuery.data;
  const isPending = workItem?.status === "pending_confirmation";
  const sourceMarker =
    workItem?.source === "advisor" ? t("advisorMarker") : workItem?.source === "mcp" ? t("externalMarker") : undefined;
  const proposalDescription =
    workItem?.proposedChange.kind === "external_reference_link"
      ? workItem.proposedChange.label
        ? t("externalReferenceLinkWithLabel", {
            url: workItem.proposedChange.url,
            label: workItem.proposedChange.label,
          })
        : t("externalReferenceLink", { url: workItem.proposedChange.url })
      : workItem?.proposedChange.kind === "external_reference_unlink"
        ? t("externalReferenceUnlink", { refId: workItem.proposedChange.refId })
        : t("noopProposal");

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/35 backdrop-blur-sm sm:items-center print:hidden">
      <button
        type="button"
        aria-label={t("closeAria")}
        data-testid="enrichment-confirm-backdrop"
        className="absolute inset-0 cursor-default"
        onClick={close}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="enrichment-confirm-title"
        aria-describedby="enrichment-confirm-description"
        data-testid="enrichment-confirm-shell"
        className="glass-chrome relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded-t-2xl p-5 pb-[calc(env(safe-area-inset-bottom)+144px)] shadow-xl sm:rounded-2xl sm:p-6 lg:pb-6"
      >
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-eyebrow">{t("eyebrow")}</p>
            <h2 id="enrichment-confirm-title" className="mt-2 text-xl font-semibold text-foreground">
              {t("title")}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            data-testid="enrichment-confirm-close"
            onClick={close}
            className="rounded-md bg-surface px-3 py-2 text-sm font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t("close")}
          </button>
        </header>

        <p id="enrichment-confirm-description" className="mt-3 text-sm leading-6 text-muted-foreground">
          {t("description")}
        </p>

        {workItemQuery.isPending ? (
          <p className="mt-5 text-sm text-muted-foreground" role="status">
            {t("loading")}
          </p>
        ) : workItemQuery.isError ? (
          <p className="mt-5 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger" role="alert">
            {t("loadError")}
          </p>
        ) : !workItem ? (
          <p className="mt-5 rounded-lg border border-border bg-surface-muted p-3 text-sm text-muted-foreground">
            {t("notFound")}
          </p>
        ) : (
          <>
            {sourceMarker ? (
              <p
                data-testid="enrichment-article-50-marker"
                className="mt-5 inline-flex w-fit rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-primary"
              >
                {sourceMarker}
              </p>
            ) : null}

            <dl className="mt-5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 border-y border-border py-4 text-sm">
              <dt className="text-muted-foreground">{t("target")}</dt>
              <dd className="break-all font-medium text-foreground">{workItem.targetId}</dd>
              <dt className="text-muted-foreground">{t("proposal")}</dt>
              <dd data-testid="enrichment-proposal" className="break-all font-medium text-foreground">
                {proposalDescription}
              </dd>
              <dt className="text-muted-foreground">{t("statusLabel")}</dt>
              <dd data-testid="enrichment-status" className="font-medium text-foreground">
                {t(`status.${STATUS_KEYS[workItem.status]}`)}
              </dd>
            </dl>

            <p className="mt-4 text-sm leading-6 text-muted-foreground">{t("appendOnlyNote")}</p>

            {decisionMutation.isError ? (
              <p className="mt-4 text-sm text-danger" role="alert">
                {t("decisionError")}
              </p>
            ) : null}

            {isPending ? (
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  data-testid="enrichment-reject"
                  disabled={decisionMutation.isPending}
                  onClick={() => decisionMutation.mutate("reject")}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground disabled:opacity-50"
                >
                  {decisionMutation.isPending ? t("working") : t("reject")}
                </button>
                <button
                  type="button"
                  data-testid="enrichment-confirm"
                  disabled={decisionMutation.isPending}
                  onClick={() => decisionMutation.mutate("confirm")}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
                >
                  {decisionMutation.isPending ? t("working") : t("confirm")}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
