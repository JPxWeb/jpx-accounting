"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { useObjectUrl } from "../../hooks/use-object-url";
import { listCaptureDrafts } from "../../lib/draft-queue";
import type { CaptureDraft } from "../../lib/draft-queue-core";
import { promoteDraft } from "../../lib/promotion";
import { Button } from "../ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

function DraftThumb({ draft, alt }: { draft: CaptureDraft; alt: string }) {
  const url = useObjectUrl(draft.file);
  const mimeType = draft.mimeType ?? "";

  if (url && mimeType.startsWith("image/")) {
    // next/image cannot optimize transient blob: object URLs — a plain <img> is correct here.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={alt} data-testid="draft-thumb" className="size-10 rounded-md object-cover" />;
  }

  if (mimeType === "application/pdf") {
    return <FileText aria-label={alt} data-testid="draft-thumb" className="size-5 text-muted-foreground" />;
  }

  // Metadata-only draft (text/share or degraded fallback storage) — nothing to preview.
  return <span aria-hidden="true">—</span>;
}

export function DraftsTable() {
  const t = useTranslations("capture.drafts");
  const queryClient = useQueryClient();
  const draftsQuery = useQuery({ queryKey: ["capture-drafts"], queryFn: () => listCaptureDrafts() });

  // Promotion normally fires automatically at capture time — this button is the retry
  // path for drafts whose fire-and-forget promotion failed (offline, API down).
  const promote = useMutation({
    mutationFn: (draft: CaptureDraft) => promoteDraft(draft, { queryClient }),
    onSuccess: () => toast.success(t("promoted")),
    onError: () => toast.error(t("promoteError")),
  });

  const drafts = draftsQuery.data ?? [];

  return (
    <section className="glass-panel rounded-xl p-5" data-testid="drafts-table">
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      {drafts.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground" data-testid="drafts-empty">
          {t("empty")}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("headerPreview")}</TableHead>
              <TableHead>{t("headerMode")}</TableHead>
              <TableHead>{t("headerTitle")}</TableHead>
              <TableHead>{t("headerCreated")}</TableHead>
              <TableHead className="text-right">{t("headerAction")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {drafts.map((draft) => (
              <TableRow key={draft.id} data-testid="draft-row">
                <TableCell>
                  <DraftThumb draft={draft} alt={t("thumbAlt", { name: draft.title })} />
                </TableCell>
                <TableCell>{draft.mode}</TableCell>
                <TableCell>{draft.title}</TableCell>
                <TableCell>{draft.createdAt.slice(0, 10)}</TableCell>
                <TableCell className="text-right">
                  <Button
                    data-testid="draft-promote"
                    disabled={promote.isPending}
                    onClick={() => promote.mutate(draft)}
                  >
                    {t("promote")}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
