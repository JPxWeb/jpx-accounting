"use client";

import type { EvidenceObject, ExtractedField } from "@jpx-accounting/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { useObjectUrl } from "../../hooks/use-object-url";
import { apiClient } from "../../lib/client";
import { getEvidenceBlob } from "../../lib/evidence-blob-cache";
import {
  attachCandidateDate,
  attachCandidateLabel,
  findOrphanedDraftReviewId,
  selectAttachCandidates,
} from "../../lib/evidence-attach";
import { formatPercent } from "../../lib/presentation";
import { invalidateLedgerDerived } from "../../lib/query-invalidation";
import { isDraftVoucherNumber } from "../../lib/voucher-link-display";
import { useWorkspaceProfile } from "../providers/workspace-profile-provider";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Money } from "../ui/money";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenSkeleton } from "../ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { UnavailableState } from "../ui/unavailable-state";

/** Extracted-field keys rendered as workspace-formatted money instead of raw strings. */
const MONEY_FIELD_KEYS = new Set(["grossAmount", "netAmount", "vatAmount"]);

function formatSizeBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} kB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FieldValue({ field }: { field: ExtractedField }) {
  if (MONEY_FIELD_KEYS.has(field.key)) {
    const parsed = Number.parseFloat(field.value);
    if (Number.isFinite(parsed)) {
      return <Money value={parsed} />;
    }
  }
  return <>{field.value}</>;
}

/**
 * File preview with an honest resolution order:
 * 1. the local evidence blob cache (the device that captured the file),
 * 2. a short-lived read SAS from the API (Azure-backed storage only),
 * 3. an explicit "no preview" state — never a fake placeholder.
 */
function EvidencePreview({ evidence }: { evidence: EvidenceObject }) {
  const t = useTranslations("evidence.preview");
  const isImage = evidence.mimeType.startsWith("image/");
  const isPdf = evidence.mimeType === "application/pdf";
  const previewable = isImage || isPdf;

  const blobQuery = useQuery({
    queryKey: ["evidence-blob", evidence.id],
    // react-query cannot cache `undefined` — map the cache miss to null.
    queryFn: async () => (await getEvidenceBlob(evidence.id)) ?? null,
    enabled: previewable,
  });
  const localUrl = useObjectUrl(blobQuery.data);

  const fileUrlQuery = useQuery({
    queryKey: ["evidence-file-url", evidence.id],
    queryFn: async () => (await apiClient.getEvidenceFileUrl(evidence.id)) ?? null,
    // Only consulted after the local cache definitively missed.
    enabled: previewable && blobQuery.isSuccess && blobQuery.data === null,
  });

  const src = localUrl ?? fileUrlQuery.data?.url;
  // v5 `isLoading` = pending AND actually fetching, so disabled queries don't count.
  const resolving = previewable && (blobQuery.isLoading || fileUrlQuery.isLoading);

  return (
    <section className="glass-panel rounded-xl p-5" data-testid="evidence-preview">
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      <div className="mt-3">
        {src && isImage ? (
          // next/image cannot optimize transient blob:/SAS URLs — a plain <img> is correct here.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={t("imageAlt", { title: evidence.title })}
            className="max-h-96 w-full rounded-lg object-contain"
          />
        ) : src && isPdf ? (
          <iframe src={src} title={t("frameTitle", { title: evidence.title })} className="h-96 w-full rounded-lg" />
        ) : resolving ? (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        ) : (
          <div
            className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground"
            data-testid="evidence-preview-unavailable"
          >
            <p>{t("unavailable")}</p>
            <p className="mt-1">{t("unavailableHint")}</p>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Audit note stamped on the auto-discarded draft. A stable English constant,
 * not a translated string: it lands in an append-only event payload, where the
 * reader's UI locale years from now is nobody's business (same call as
 * `ADVISOR_APPROVAL_NOTES`).
 */
const DRAFT_DISCARD_NOTES = "Draft discarded — evidence attached to another voucher";

/** Rendered candidate cap; the search box is how you reach past it. */
const MAX_ATTACH_CANDIDATES = 20;

const ATTACH_SEARCH_INPUT_ID = "evidence-attach-search-input";

/**
 * What actually happened, so the toast can say it. The attach is the operation;
 * discarding this evidence's own orphaned draft is cleanup that either happened
 * or didn't — never a reason to report the attach itself as failed.
 */
type AttachOutcome = "attached" | "draft-discarded" | "draft-kept";

/**
 * "Attach to voucher" (KFR Phase E / Task E.5) — relink this evidence to an
 * EXISTING voucher, which for imported SIE history is the only way to give a
 * migrated entry its receipt (imported vouchers start with
 * `evidencePacketId: null`, so there is no packet breadcrumb to auto-detect).
 *
 * An inline section, not a modal: the whole flow is the browser's own tab order
 * (search field → one Attach button per row), so it needs no focus trap.
 *
 * Candidates come from the workspace snapshot the journal view and command
 * palette already read — no new endpoint for the picker.
 */
function AttachToVoucherPicker({
  evidenceId,
  currentVoucherId,
  orphanedDraftReviewId,
}: {
  evidenceId: string;
  currentVoucherId: string | undefined;
  orphanedDraftReviewId: string | undefined;
}) {
  const t = useTranslations("evidence.attach");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const workspaceQuery = useQuery({ queryKey: ["workspace"], queryFn: () => apiClient.getSnapshot() });

  const attach = useMutation({
    mutationFn: async (targetVoucherId: string): Promise<AttachOutcome> => {
      await apiClient.composeEvidence({ evidenceIds: [evidenceId], targetVoucherId });
      if (!orphanedDraftReviewId) return "attached";
      // Attach first, discard second — the reverse order would destroy a draft
      // on the way to a failed attach. Reject appends no ledger lines and
      // consumes no voucher number (KFR E.1 numbers at posting time only).
      try {
        await apiClient.rejectReview(orphanedDraftReviewId, { notes: DRAFT_DISCARD_NOTES });
        return "draft-discarded";
      } catch {
        // The attach already landed; calling that a failure would be a lie.
        // The toast names the leftover draft so the human can finish the job.
        return "draft-kept";
      }
    },
    onSuccess: (outcome) => {
      invalidateLedgerDerived(queryClient);
      if (outcome === "draft-kept") {
        toast.warning(t("attachDraftKept"));
        return;
      }
      toast.success(outcome === "draft-discarded" ? t("attachSuccessDraftDiscarded") : t("attachSuccess"));
    },
    onError: () => toast.error(t("attachError")),
  });

  const candidates = selectAttachCandidates(workspaceQuery.data?.vouchers ?? [], {
    excludeVoucherId: currentVoucherId,
    query,
    limit: MAX_ATTACH_CANDIDATES,
  });

  return (
    <section className="glass-panel rounded-xl p-5" data-testid="evidence-attach-picker">
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{t("description")}</p>
      <label className="sr-only" htmlFor={ATTACH_SEARCH_INPUT_ID}>
        {t("searchLabel")}
      </label>
      <Input
        id={ATTACH_SEARCH_INPUT_ID}
        data-testid="evidence-attach-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("searchPlaceholder")}
        className="mt-3 h-9"
      />
      {attach.isError ? (
        // Inline AND toasted: a toast alone is a message you can miss, and the
        // 404 here means the snapshot went stale under the picker.
        <p
          role="alert"
          className="mt-3 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger"
          data-testid="evidence-attach-error"
        >
          {t("attachError")}
        </p>
      ) : null}
      {workspaceQuery.isPending ? null : candidates.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground" data-testid="evidence-attach-empty">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {candidates.map((voucher) => {
            // KFR E.1: an unposted voucher carries the Swedish draft sentinel —
            // translate it, never print it (`en` is the default UI locale).
            const number = isDraftVoucherNumber(voucher.voucherNumber)
              ? tCommon("draftVoucher")
              : voucher.voucherNumber;
            const label = attachCandidateLabel(voucher);
            return (
              <li
                key={voucher.id}
                className="glass-panel-soft flex items-center justify-between gap-3 rounded-lg px-3 py-2"
              >
                <span className="text-sm">
                  <span className="text-mono font-semibold">{number}</span>
                  {voucher.origin === "import" ? (
                    <span className="ml-2 text-xs text-muted-foreground">{t("importedBadge")}</span>
                  ) : null}
                  {" · "}
                  {/* Seeded/demo vouchers are dated off the clock — mask for stable baselines (Rule 27). */}
                  <span data-visual-mask>{attachCandidateDate(voucher).slice(0, 10)}</span>
                  {label ? ` · ${label}` : ""}
                </span>
                <Button
                  size="sm"
                  aria-label={t("attachAriaLabel", { voucher: label ? `${number} — ${label}` : number })}
                  disabled={attach.isPending}
                  onClick={() => attach.mutate(voucher.id)}
                >
                  {t("attachButton")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function EvidenceDetailScreen() {
  const t = useTranslations("evidence");
  const tCommon = useTranslations("common");
  const params = useParams<{ id: string }>();
  const { locale } = useWorkspaceProfile();
  const queryClient = useQueryClient();
  const evidenceId = params.id;

  const contextQuery = useQuery({
    queryKey: ["evidence", evidenceId],
    // react-query cannot cache `undefined` — map unknown evidence to null (→ not-found state).
    queryFn: async () => (await apiClient.getEvidenceContext(evidenceId)) ?? null,
  });

  const extract = useMutation({
    mutationFn: () => apiClient.extractEvidence(evidenceId),
    onSuccess: () => {
      // Covers ["evidence", evidenceId] via the ["evidence"] prefix, plus every
      // other ledger-derived family the refreshed extraction feeds (R18).
      invalidateLedgerDerived(queryClient);
      toast.success(t("links.extractSuccess"));
    },
    onError: () => toast.error(t("links.extractError")),
  });

  if (contextQuery.isPending) return <ScreenSkeleton />;

  const context = contextQuery.data;
  if (!context) {
    return <UnavailableState testId="evidence-not-found" title={t("notFound.title")} message={t("notFound.message")} />;
  }

  const { evidence, packet, voucher, review } = context;
  const extractedFields = voucher?.extractedFields ?? [];
  // Append-only: once the review is decided the voucher is history — re-extraction is locked.
  const reviewDecided = Boolean(review && review.status !== "needs-review");

  return (
    <div className="page-shell space-y-6">
      <ScreenHeader
        eyebrow={t("eyebrow")}
        title={evidence.title}
        description={t("description")}
        aside={
          <Link href="/capture" className="text-sm underline" data-testid="evidence-back">
            {t("back")}
          </Link>
        }
      />

      <EvidencePreview evidence={evidence} />

      <section className="glass-panel rounded-xl p-5" data-testid="evidence-detail">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted-foreground">{t("meta.hash")}</dt>
            <dd className="text-mono text-sm" data-testid="evidence-hash">
              {evidence.hash}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">{t("meta.originalFilename")}</dt>
            <dd className="text-sm">{evidence.originalFilename}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">{t("meta.mimeType")}</dt>
            <dd className="text-sm">{evidence.mimeType}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">{t("meta.size")}</dt>
            <dd className="text-sm" data-testid="evidence-size">
              {evidence.sizeBytes === undefined ? "—" : formatSizeBytes(evidence.sizeBytes)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">{t("meta.uploaded")}</dt>
            <dd className="text-sm">{evidence.createdAt.slice(0, 10)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">{t("meta.trustLevel")}</dt>
            <dd className="text-sm">{evidence.trustLevel}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">{t("meta.blobPath")}</dt>
            <dd className="text-mono text-xs">{evidence.blobPath}</dd>
          </div>
        </dl>
      </section>

      <section className="glass-panel rounded-xl p-5" data-testid="evidence-extracted-fields">
        <h2 className="text-lg font-semibold">{t("fields.title")}</h2>
        {extractedFields.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t("fields.empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("fields.headerField")}</TableHead>
                <TableHead>{t("fields.headerValue")}</TableHead>
                <TableHead className="text-right">{t("fields.headerConfidence")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {extractedFields.map((field) => (
                <TableRow key={field.key}>
                  <TableCell>{field.label}</TableCell>
                  <TableCell>
                    <FieldValue field={field} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(field.confidence, locale)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="glass-panel rounded-xl p-5" data-testid="evidence-review-links">
        <h2 className="text-lg font-semibold">{t("links.title")}</h2>
        {voucher ? (
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <span className="text-sm text-muted-foreground">
              {/* KFR E.1: an unposted voucher has no number — show the translated draft label. */}
              {t("links.voucher", {
                number: isDraftVoucherNumber(voucher.voucherNumber) ? tCommon("draftVoucher") : voucher.voucherNumber,
              })}
            </span>
            {review ? (
              <Link
                href={`/today?review=${review.id}`}
                className="text-sm underline"
                data-testid="evidence-open-review"
              >
                {t("links.openReview")}
              </Link>
            ) : null}
            <Button
              data-testid="evidence-extract"
              disabled={extract.isPending || reviewDecided}
              onClick={() => extract.mutate()}
            >
              {extract.isPending ? t("links.extracting") : t("links.extract")}
            </Button>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">{t("links.noVoucher")}</p>
        )}
        {reviewDecided ? <p className="mt-2 text-xs text-muted-foreground">{t("links.extractLocked")}</p> : null}
      </section>

      <AttachToVoucherPicker
        evidenceId={evidence.id}
        currentVoucherId={voucher?.id}
        orphanedDraftReviewId={findOrphanedDraftReviewId({ evidenceId: evidence.id, packet, voucher, review })}
      />
    </div>
  );
}
