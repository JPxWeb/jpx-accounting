"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiClient } from "../../lib/client";
import { listCaptureDrafts, removeCaptureDraft } from "../../lib/draft-queue";
import type { CaptureDraft } from "../../lib/draft-queue-core";
import { Button } from "../ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

function modalityFromMode(mode: string): "camera" | "upload" | "paste" | "share" {
  if (mode === "camera" || mode === "paste" || mode === "share") return mode;
  return "upload";
}

export function DraftsTable() {
  const queryClient = useQueryClient();
  const draftsQuery = useQuery({ queryKey: ["capture-drafts"], queryFn: () => listCaptureDrafts() });

  const promote = useMutation({
    mutationFn: async (draft: CaptureDraft) => {
      await apiClient.createEvidence({
        organizationId: "org_jpx",
        workspaceId: "workspace_main",
        actorId: "user_founder",
        title: draft.title,
        originalFilename: `${draft.id}.bin`,
        mimeType: "application/octet-stream",
        modalities: [modalityFromMode(draft.mode)],
      });
      await removeCaptureDraft(draft.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["capture-drafts"] });
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
      toast.success("Draft promoted to ledger evidence.");
    },
    onError: () => toast.error("Could not promote the draft."),
  });

  const drafts = draftsQuery.data ?? [];

  return (
    <section className="glass-panel rounded-xl p-5" data-testid="drafts-table">
      <h2 className="text-lg font-semibold">Drafts in progress</h2>
      {drafts.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--color-text-muted)]" data-testid="drafts-empty">
          No local drafts. Use Quick add above or the capture button.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Mode</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {drafts.map((draft) => (
              <TableRow key={draft.id} data-testid="draft-row">
                <TableCell>{draft.mode}</TableCell>
                <TableCell>{draft.title}</TableCell>
                <TableCell>{draft.createdAt.slice(0, 10)}</TableCell>
                <TableCell className="text-right">
                  <Button
                    data-testid="draft-promote"
                    disabled={promote.isPending}
                    onClick={() => promote.mutate(draft)}
                  >
                    Promote to ledger
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
