"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";

import { apiClient } from "../../lib/client";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenSkeleton } from "../ui/skeleton";
import { UnavailableState } from "../ui/unavailable-state";

export function EvidenceDetailScreen() {
  const params = useParams<{ id: string }>();
  const { data } = useQuery({ queryKey: ["workspace"], queryFn: () => apiClient.getSnapshot() });

  if (!data) return <ScreenSkeleton />;

  const evidence = data.evidence.find((item) => item.id === params.id);
  if (!evidence) {
    return (
      <UnavailableState
        testId="evidence-not-found"
        title="Evidence not found"
        message="This evidence id is not present in the current workspace snapshot."
      />
    );
  }

  return (
    <div className="page-shell space-y-6">
      <ScreenHeader
        eyebrow="Evidence"
        title={evidence.title}
        description="Immutable file record, hash chain, and provenance."
        aside={
          <Link href="/capture" className="text-sm underline" data-testid="evidence-back">
            Back to Capture
          </Link>
        }
      />
      <section className="glass-panel rounded-xl p-5" data-testid="evidence-detail">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-[var(--color-text-muted)]">Hash</dt>
            <dd className="text-mono text-sm" data-testid="evidence-hash">
              {evidence.hash}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-[var(--color-text-muted)]">Original filename</dt>
            <dd className="text-sm">{evidence.originalFilename}</dd>
          </div>
          <div>
            <dt className="text-sm text-[var(--color-text-muted)]">MIME type</dt>
            <dd className="text-sm">{evidence.mimeType}</dd>
          </div>
          <div>
            <dt className="text-sm text-[var(--color-text-muted)]">Uploaded</dt>
            <dd className="text-sm">{evidence.createdAt.slice(0, 10)}</dd>
          </div>
          <div>
            <dt className="text-sm text-[var(--color-text-muted)]">Trust level</dt>
            <dd className="text-sm">{evidence.trustLevel}</dd>
          </div>
          <div>
            <dt className="text-sm text-[var(--color-text-muted)]">Blob path</dt>
            <dd className="text-mono text-xs">{evidence.blobPath}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
