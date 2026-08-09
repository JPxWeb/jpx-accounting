/**
 * Shared LedgerStore behavior scenarios for Memory ↔ Postgres conformance
 * (Local Postgres Dev DB plan, Task 5).
 *
 * Scenarios return structural facts only — generated IDs, timestamps, hashes,
 * and provider numeric quirks are normalized away so both stores can be compared.
 */
import assert from "node:assert/strict";

import type { EnrichmentProposal, ExtractionResult } from "@jpx-accounting/contracts";
import {
  deriveDeterministicExtraction,
  EnrichmentLineNotFoundError,
  ExternalReferenceNotFoundError,
  InvalidPeriodTokenError,
  InventoryMovementLineNotFoundError,
  LineEnrichmentNotActiveError,
  parseSie,
  today,
} from "@jpx-accounting/domain";
import { ReviewNotFoundError, type LedgerStore } from "@jpx-accounting/domain/store";

export type ConformanceHarness = {
  label: string;
  store: LedgerStore;
  organizationId: string;
  workspaceId: string;
  actorId: string;
  seedTagDefinition?: (definition: { id: string; name: string; color?: string }) => Promise<void>;
};

/** Stable structural outcome — no ids / hashes / wall-clock fields. */
export type ConformanceOutcome = Record<string, unknown>;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeNumber(value: unknown): unknown {
  if (typeof value === "number") return round2(value);
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) return round2(Number(value));
  return value;
}

function sortByKey<T extends Record<string, unknown>>(rows: T[], key: string): T[] {
  return [...rows].sort((a, b) => String(a[key] ?? "").localeCompare(String(b[key] ?? "")));
}

const marchSieFile = () =>
  parseSie(
    [
      "#SIETYP 4",
      '#KONTO 6110 "Kontorsmateriel"',
      '#VER A 42 20260315 "Inkopta parmar"',
      "{",
      "#TRANS 6110 {} 100.00",
      "#TRANS 1930 {} -100.00",
      "}",
    ].join("\n"),
  );

export async function scenarioEvidenceCreateApproveReports(h: ConformanceHarness): Promise<ConformanceOutcome> {
  const journalBefore = (await h.store.getReports()).journal.length;
  const created = await h.store.createEvidence({
    actorId: h.actorId,
    title: "Conformance invoice",
    originalFilename: "conformance-invoice.pdf",
    mimeType: "application/pdf",
    modalities: ["pdf", "upload"],
    extractedText: "Conformance invoice body",
  });

  const events = await h.store.getEvents();
  const createEvents = events.filter(
    (event) =>
      event.aggregateId === created.evidence.id ||
      event.aggregateId === created.voucher.id ||
      event.aggregateId === created.review.id,
  );
  const createTypes = createEvents.map((event) => event.eventType);

  const approved = await h.store.applyReviewDecision(created.review.id, "approve", { actorId: h.actorId });
  const journalAfter = (await h.store.getReports()).journal.length;
  const reapproved = await h.store.applyReviewDecision(created.review.id, "approve", { actorId: h.actorId });
  const journalReplay = (await h.store.getReports()).journal.length;

  return {
    modalitiesIncludePdf: created.evidence.modalities.includes("pdf"),
    voucherStatusAfterCreate: created.voucher.status,
    createEventTypes: createTypes,
    approvedStatus: approved?.status,
    journalDelta: journalAfter - journalBefore,
    reapprovedStatus: reapproved?.status,
    journalReplayDelta: journalReplay - journalAfter,
  };
}

export async function scenarioEvidenceDedupe(h: ConformanceHarness): Promise<ConformanceOutcome> {
  const sha256 = "ab".repeat(32);
  const input = {
    actorId: h.actorId,
    title: "Dedupe receipt",
    originalFilename: "dedupe-receipt.jpg",
    mimeType: "image/jpeg" as const,
    modalities: ["upload" as const],
    sizeBytes: 2048,
    sha256,
  };

  const first = await h.store.createEvidence(input);
  const eventsAfterFirst = (await h.store.getEvents()).length;
  const second = await h.store.createEvidence({
    ...input,
    title: "Dedupe receipt (retried)",
    modalities: ["share"],
  });
  const eventsAfterSecond = (await h.store.getEvents()).length;

  const differentSize = await h.store.createEvidence({ ...input, sizeBytes: 4096 });
  const noHash = await h.store.createEvidence({
    actorId: h.actorId,
    title: "No hash",
    originalFilename: "no-hash.jpg",
    mimeType: "image/jpeg",
    modalities: ["camera"],
    sizeBytes: 100,
  });
  const noHashAgain = await h.store.createEvidence({
    actorId: h.actorId,
    title: "No hash again",
    originalFilename: "no-hash.jpg",
    mimeType: "image/jpeg",
    modalities: ["camera"],
    sizeBytes: 100,
  });

  return {
    firstDeduped: first.deduped ?? false,
    secondDeduped: second.deduped ?? false,
    sameEvidenceId: second.evidence.id === first.evidence.id,
    eventsAppendedOnDedup: eventsAfterSecond - eventsAfterFirst,
    differentSizeDeduped: differentSize.deduped ?? false,
    noHashCollapsed: noHashAgain.evidence.id === noHash.evidence.id,
  };
}

export async function scenarioComposeAndExtraction(h: ConformanceHarness): Promise<ConformanceOutcome> {
  const a = await h.store.createEvidence({
    actorId: h.actorId,
    title: "Compose A",
    originalFilename: "compose-a.jpg",
    mimeType: "image/jpeg",
    modalities: ["camera"],
  });
  const b = await h.store.createEvidence({
    actorId: h.actorId,
    title: "Compose B",
    originalFilename: "compose-b.jpg",
    mimeType: "image/jpeg",
    modalities: ["camera"],
  });

  const composed = await h.store.composeEvidence({
    actorId: h.actorId,
    evidenceIds: [a.evidence.id, b.evidence.id],
  });

  const context = await h.store.getEvidenceContext(a.evidence.id);
  const eventsBeforeRefresh = (await h.store.getEvents()).length;
  const refresh: ExtractionResult = {
    modelId: "prebuilt-invoice",
    fields: deriveDeterministicExtraction({ filename: "compose-a.jpg", sizeBytes: 77777 }, today()),
    extractedAt: new Date().toISOString(),
  };
  const updated = await h.store.updateEvidenceExtraction(a.evidence.id, refresh);
  const eventsAfterRefresh = (await h.store.getEvents()).length;
  const refreshedGross = Number.parseFloat(refresh.fields.find((field) => field.key === "grossAmount")!.value);

  return {
    composedItemCount: composed.evidenceIds.length,
    voucherRelinked: context?.voucher?.evidencePacketId === composed.id,
    refreshGross: normalizeNumber(updated?.voucher?.voucherFields.grossAmount),
    expectedGross: normalizeNumber(refreshedGross),
    extractionEventDelta: eventsAfterRefresh - eventsBeforeRefresh,
  };
}

export async function scenarioReviewOrderingAndSuggestion(h: ConformanceHarness): Promise<ConformanceOutcome> {
  const first = await h.store.createEvidence({
    actorId: h.actorId,
    title: "Review order first",
    originalFilename: "order-1.jpg",
    mimeType: "image/jpeg",
    modalities: ["camera"],
  });
  const second = await h.store.createEvidence({
    actorId: h.actorId,
    title: "Review order second",
    originalFilename: "order-2.jpg",
    mimeType: "image/jpeg",
    modalities: ["camera"],
  });

  const feed = await h.store.getReviewFeed();
  const ours = feed.filter((review) => review.id === first.review.id || review.id === second.review.id);
  const suggested = await h.store.suggestVoucher(first.voucher.id);

  return {
    pendingCount: ours.filter((review) => review.status === "needs-review").length,
    feedIncludesBoth: ours.length === 2,
    suggestionAccount: suggested?.accountNumber ?? null,
    suggestionHasCitations: Array.isArray(suggested?.citations) && suggested.citations.length > 0,
  };
}

export async function scenarioSieImportIdempotency(h: ConformanceHarness): Promise<ConformanceOutcome> {
  const journalBefore = (await h.store.getReports()).journal.length;
  const eventsBefore = (await h.store.getEvents()).length;
  const file = marchSieFile();

  const result = await h.store.importSie({ actorId: h.actorId, file });
  const journalAfter = (await h.store.getReports()).journal.length;
  const eventsAfter = (await h.store.getEvents()).length;
  const replay = await h.store.importSie({ actorId: h.actorId, file });
  const journalReplay = (await h.store.getReports()).journal.length;
  const eventsReplay = (await h.store.getEvents()).length;

  const march = await h.store.getReports({ from: "2026-03-01", to: "2026-03-31" });
  const marchLines = march.journal.map((entry) => [
    entry.accountNumber,
    normalizeNumber(entry.debit),
    normalizeNumber(entry.credit),
    entry.bookedAt,
  ]);

  return {
    importedVouchers: result.importedVouchers,
    importedTransactions: result.importedTransactions,
    journalDelta: journalAfter - journalBefore,
    eventDelta: eventsAfter - eventsBefore,
    replayImported: replay.importedVouchers,
    replaySkippedReason: replay.skipped[0]?.reason ?? null,
    journalReplayDelta: journalReplay - journalAfter,
    eventReplayDelta: eventsReplay - eventsAfter,
    marchLines,
  };
}

export async function scenarioSettingsAlertsSimulation(h: ConformanceHarness): Promise<ConformanceOutcome> {
  assert.equal(await h.store.getCompanySettings(), null);

  const settings = {
    organizationName: "Conformance AB",
    organizationNumber: "556677-8899",
    addressLine1: "Kungsgatan 1",
    postalCode: "111 22",
    city: "Stockholm",
    contactEmail: "conformance@example.com",
    profile: {
      country: "SE" as const,
      locale: "sv-SE",
      currency: "SEK",
      fiscalYearStart: "01-01",
      vatPeriod: "quarterly" as const,
    },
    aiPosture: { advisorEnabled: true, suggestionsEnabled: true },
  };
  const saved = await h.store.putCompanySettings(settings);
  const loaded = await h.store.getCompanySettings();

  const created = await h.store.createEvidence({
    actorId: h.actorId,
    title: "Simulation receipt",
    originalFilename: "sim.jpg",
    mimeType: "image/jpeg",
    modalities: ["camera"],
  });

  const alerts = await h.store.refreshComplianceAlerts();
  const alertsAgain = await h.store.refreshComplianceAlerts();
  // Memory seeds a non-auto "representation-review" alert; Postgres namespaces start empty.
  // Compare only auto-detected kinds so both stores share the same structural contract.
  const autoKinds = new Set(["stale-blocked", "missing-supplier-vat"]);
  const autoAlerts = sortByKey(
    alerts.filter((alert) => autoKinds.has(alert.kind)).map((alert) => ({ kind: alert.kind, status: alert.status })),
    "kind",
  );

  const simulation = await h.store.runSimulation({
    actorId: h.actorId,
    title: "Conformance sim",
    scenario: "approve pending",
    reviewIds: [created.review.id],
    action: "approve",
  });

  let unknownReviewError = "none";
  try {
    await h.store.runSimulation({
      actorId: h.actorId,
      title: "missing",
      scenario: "missing",
      reviewIds: ["review_does_not_exist"],
      action: "approve",
    });
  } catch (error) {
    unknownReviewError =
      error instanceof ReviewNotFoundError ? "ReviewNotFoundError" : error instanceof Error ? error.name : "unknown";
  }

  let unknownPeriodError = "none";
  try {
    await h.store.getReportPack({ period: "not-a-period" });
  } catch (error) {
    unknownPeriodError =
      error instanceof InvalidPeriodTokenError
        ? "InvalidPeriodTokenError"
        : error instanceof Error
          ? error.name
          : "unknown";
  }

  const unknownEvidence = await h.store.getEvidenceContext("evidence_does_not_exist");
  const unknownDecision = await h.store.applyReviewDecision("review_does_not_exist", "approve", {
    actorId: h.actorId,
  });
  const unknownSuggestion = await h.store.suggestVoucher("voucher_does_not_exist");

  return {
    settingsName: saved.organizationName,
    settingsRoundTrip: loaded?.organizationName,
    settingsCurrency: loaded?.profile.currency,
    alertCountStable: alerts.length === alertsAgain.length,
    autoAlerts,
    simulationBalanceDeltaCount: simulation.balanceDelta.length,
    simulationAffectedIncludesVat: simulation.affectedAccounts.includes("2641"),
    unknownReviewError,
    unknownPeriodError,
    unknownEvidence: unknownEvidence === undefined,
    unknownDecision: unknownDecision === undefined,
    unknownSuggestion: unknownSuggestion === undefined,
  };
}

export async function scenarioAppendOnlyEventVocabulary(h: ConformanceHarness): Promise<ConformanceOutcome> {
  const created = await h.store.createEvidence({
    actorId: h.actorId,
    title: "Vocabulary receipt",
    originalFilename: "vocab.jpg",
    mimeType: "image/jpeg",
    modalities: ["camera"],
  });

  await h.store.applyReviewDecision(created.review.id, "approve", { actorId: h.actorId });

  const events = await h.store.getEvents();
  const relevant = events.filter(
    (event) =>
      event.aggregateId === created.evidence.id ||
      event.aggregateId === created.voucher.id ||
      event.aggregateId === created.review.id ||
      (event.eventType === "PostedToLedger" &&
        (event.payload as { voucherId?: string }).voucherId === created.voucher.id),
  );

  const vocabulary = relevant.map((event) => event.eventType);
  // Full-stream linearity: both stores keep a single linear previousHash chain
  // per workspace namespace (Memory seed + scenario appends; Postgres empty ns).
  const chainLinear = events.every((e, i) => i === 0 || e.previousHash === events[i - 1]!.eventHash);
  const chainFieldsPresent = events.every((e) => Boolean(e.previousHash) && Boolean(e.eventHash));

  return {
    vocabulary,
    hasEvidenceReceived: vocabulary.includes("EvidenceReceived"),
    hasFieldsExtracted: vocabulary.includes("FieldsExtracted"),
    hasVoucherCreated: vocabulary.includes("VoucherCreated"),
    hasSuggestionGenerated: vocabulary.includes("SuggestionGenerated"),
    hasReviewApproved: vocabulary.includes("ReviewApproved"),
    hasPostedToLedger: vocabulary.includes("PostedToLedger"),
    chainLinear,
    chainFieldsPresent,
  };
}

export async function scenarioReviewReject(h: ConformanceHarness): Promise<ConformanceOutcome> {
  const created = await h.store.createEvidence({
    actorId: h.actorId,
    title: "Reject conformance receipt",
    originalFilename: "reject-conformance.jpg",
    mimeType: "image/jpeg",
    modalities: ["camera"],
  });

  const journalBefore = (await h.store.getReports()).journal.length;
  await h.store.applyReviewDecision(created.review.id, "reject", { actorId: h.actorId });
  const journalAfter = (await h.store.getReports()).journal.length;
  const events = await h.store.getEvents();

  const rejectForReview = events.some(
    (event) => event.eventType === "ReviewRejected" && event.aggregateId === created.review.id,
  );
  // PostedToLedger aggregateId is the voucher id (payload carries action/suggestion/lines).
  const postedForVoucher = events.some(
    (event) => event.eventType === "PostedToLedger" && event.aggregateId === created.voucher.id,
  );

  return {
    journalDelta: journalAfter - journalBefore,
    hasReviewRejected: rejectForReview,
    hasPostedToLedger: postedForVoucher,
    reviewStatus: (await h.store.findReviewByVoucher(created.voucher.id))?.status ?? null,
  };
}

export async function scenarioReviewApproveEdited(h: ConformanceHarness): Promise<ConformanceOutcome> {
  const created = await h.store.createEvidence({
    actorId: h.actorId,
    title: "Edited approve conformance",
    originalFilename: "edited-approve-conformance.jpg",
    mimeType: "image/jpeg",
    modalities: ["camera"],
  });

  const journalBefore = (await h.store.getReports()).journal.length;
  const edited = {
    accountNumber: "6110",
    accountName: "Kontorsmateriel",
    vatCode: "VAT25",
    grossAmount: 500,
    netAmount: 400,
    vatAmount: 100,
  };
  const decided = await h.store.applyReviewDecision(created.review.id, "approve", {
    actorId: h.actorId,
    edited,
  });
  const journalAfter = (await h.store.getReports()).journal.length;
  const events = await h.store.getEvents();

  const approvedEvt = events.find(
    (event) => event.eventType === "ReviewApproved" && event.aggregateId === created.review.id,
  );
  const postedEvt = events.find(
    (event) => event.eventType === "PostedToLedger" && event.aggregateId === created.voucher.id,
  );
  const postedLines = postedEvt?.payload.lines as
    | Array<{ accountNumber: string; debit: number; credit: number }>
    | undefined;
  // jsonb round-trip may reorder keys / coerce numerics — compare structural fields.
  const payloadEdited = (approvedEvt?.payload as { edited?: Record<string, unknown> } | undefined)?.edited;

  return {
    journalDelta: journalAfter - journalBefore,
    approvedStatus: decided?.status ?? null,
    provenanceLabel: decided?.provenanceTimeline.at(-1)?.label ?? null,
    suggestionAccount: decided?.suggestion?.accountNumber ?? null,
    hasEditedInPayload: Boolean(payloadEdited),
    editedAccount: payloadEdited?.accountNumber ?? null,
    editedVatCode: payloadEdited?.vatCode ?? null,
    editedGross: normalizeNumber(payloadEdited?.grossAmount),
    editedNet: normalizeNumber(payloadEdited?.netAmount),
    editedVat: normalizeNumber(payloadEdited?.vatAmount),
    hasPostedToLedger: Boolean(postedEvt),
    postedLineCount: Array.isArray(postedLines) ? postedLines.length : 0,
    postedExpenseAccount: postedLines?.[0]?.accountNumber ?? null,
    postedExpenseDebit: normalizeNumber(postedLines?.[0]?.debit),
  };
}

export async function scenarioPrePostEnrichmentSinglePosting(h: ConformanceHarness): Promise<ConformanceOutcome> {
  const created = await h.store.createEvidence({
    actorId: h.actorId,
    title: "Pre-post enrichment conformance",
    originalFilename: "pre-post-enrichment-conformance.pdf",
    mimeType: "application/pdf",
    modalities: ["upload"],
  });
  await h.store.attachReviewEnrichmentIntent({
    actorId: h.actorId,
    reviewId: created.review.id,
    proposals: [
      {
        kind: "line_enrichment_record",
        lineId: "ln_not_in_approval_batch",
        enrichmentType: "project",
        payload: { projectId: "project_conformance" },
      },
    ],
  });
  const eventsBeforeRejectedApproval = await h.store.getEvents();
  await assert.rejects(
    () => h.store.applyReviewDecision(created.review.id, "approve", { actorId: h.actorId }),
    EnrichmentLineNotFoundError,
  );
  const eventsAfterRejectedApproval = await h.store.getEvents();
  assert.equal(eventsAfterRejectedApproval.length, eventsBeforeRejectedApproval.length);
  assert.ok(await h.store.getReviewEnrichmentIntent(created.review.id));

  // Replacing the invalid intent proves the failed approval left the review open
  // and permits the ordinary human approval path to post exactly once.
  await h.store.attachReviewEnrichmentIntent({
    actorId: h.actorId,
    reviewId: created.review.id,
    proposals: [{ kind: "noop" }],
  });

  const decided = await h.store.applyReviewDecision(created.review.id, "approve", {
    actorId: h.actorId,
  });
  const events = await h.store.getEvents();
  const postedForVoucher = events.filter(
    (event) => event.eventType === "PostedToLedger" && event.aggregateId === created.voucher.id,
  );

  assert.equal(postedForVoucher.length, 1);
  assert.equal(await h.store.getReviewEnrichmentIntent(created.review.id), undefined);

  return {
    reviewStatus: decided?.status ?? null,
    postedForVoucher: postedForVoucher.length,
    rejectedApprovalEventDelta: eventsAfterRejectedApproval.length - eventsBeforeRejectedApproval.length,
    failedClosed: true,
    intentConsumed: (await h.store.getReviewEnrichmentIntent(created.review.id)) === undefined,
  };
}

export async function scenarioLineTargetWorkItemNeverPosts(h: ConformanceHarness): Promise<ConformanceOutcome> {
  const created = await h.store.createEvidence({
    actorId: h.actorId,
    title: "Line-target work item conformance",
    originalFilename: "line-target-work-item-conformance.pdf",
    mimeType: "application/pdf",
    modalities: ["upload"],
  });
  await h.store.applyReviewDecision(created.review.id, "approve", { actorId: h.actorId });

  const eventsAfterPosting = await h.store.getEvents();
  const posted = eventsAfterPosting.find(
    (event) => event.eventType === "PostedToLedger" && event.aggregateId === created.voucher.id,
  );
  const lineId = (posted?.payload.lines as Array<{ lineId?: string }> | undefined)?.[0]?.lineId;
  assert.ok(lineId);
  assert.match(lineId, /^ln_/);

  const item = await h.store.proposeEnrichmentWorkItem({
    actorId: h.actorId,
    targetKind: "line",
    targetId: lineId,
    proposedChange: {
      kind: "line_enrichment_record",
      lineId,
      enrichmentType: "project",
      payload: { projectId: "project_conformance" },
    },
    source: "ui",
    idempotencyKey: `ui:line-target-never-posts:${lineId}`,
  });
  const eventsAfterProposal = await h.store.getEvents();
  assert.equal(item.status, "pending_confirmation");
  assert.equal(eventsAfterProposal.length, eventsAfterPosting.length);

  const confirmed = await h.store.confirmEnrichmentWorkItem(item.id, { actorId: h.actorId });
  const eventsAfterConfirm = await h.store.getEvents();
  const replayed = await h.store.confirmEnrichmentWorkItem(item.id, { actorId: h.actorId });
  const eventsAfterReplay = await h.store.getEvents();
  const resultingEvents = eventsAfterConfirm.filter((event) => confirmed.resultingEventIds?.includes(event.id));
  const postedForVoucher = eventsAfterReplay.filter(
    (event) => event.eventType === "PostedToLedger" && event.aggregateId === created.voucher.id,
  );
  const recordedForLine = eventsAfterReplay.filter(
    (event) => event.eventType === "LineEnrichmentRecorded" && event.aggregateId === lineId,
  );

  assert.equal(postedForVoucher.length, 1);
  assert.equal(recordedForLine.length, 1);
  assert.equal(resultingEvents.length, 1);
  assert.equal(resultingEvents[0]?.eventType, "LineEnrichmentRecorded");
  assert.equal(resultingEvents[0]?.aggregateId, lineId);
  assert.equal(resultingEvents[0]?.payload.lineId, lineId);
  assert.equal(confirmed.confirmedBy, h.actorId);
  assert.deepEqual(replayed.resultingEventIds, confirmed.resultingEventIds);
  assert.equal(eventsAfterReplay.length, eventsAfterConfirm.length);

  return {
    proposedStatus: item.status,
    workItemStatus: confirmed.status,
    resultingEventTypes: resultingEvents.map((event) => event.eventType),
    postedForVoucher: postedForVoucher.length,
    proposalEventDelta: eventsAfterProposal.length - eventsAfterPosting.length,
    replayEventDelta: eventsAfterReplay.length - eventsAfterConfirm.length,
    recordedForLine: recordedForLine.length,
    confirmedByHuman: confirmed.confirmedBy === h.actorId,
    postingDelta:
      eventsAfterReplay.filter((event) => event.eventType === "PostedToLedger").length -
      eventsAfterPosting.filter((event) => event.eventType === "PostedToLedger").length,
  };
}

export async function scenarioEnrichmentWorkItemConfirmNeverPosts(h: ConformanceHarness): Promise<ConformanceOutcome> {
  const created = await h.store.createEvidence({
    actorId: h.actorId,
    title: "Enrichment conformance",
    originalFilename: "enrichment-conformance.pdf",
    mimeType: "application/pdf",
    modalities: ["upload"],
  });
  await h.store.applyReviewDecision(created.review.id, "approve", { actorId: h.actorId });

  const item = await h.store.proposeEnrichmentWorkItem({
    actorId: h.actorId,
    targetKind: "voucher",
    targetId: created.voucher.id,
    proposedChange: { kind: "noop" },
    source: "ui",
    idempotencyKey: `ui:noop:${created.voucher.id}`,
  });
  const eventsBeforeConfirm = await h.store.getEvents();
  const confirmed = await h.store.confirmEnrichmentWorkItem(item.id, { actorId: h.actorId });
  const eventsAfterConfirm = await h.store.getEvents();
  const replayed = await h.store.confirmEnrichmentWorkItem(item.id, { actorId: h.actorId });
  const eventsAfterReplay = await h.store.getEvents();
  const stored = await h.store.getEnrichmentWorkItem(item.id);
  const postedBeforeConfirm = eventsBeforeConfirm.filter((event) => event.eventType === "PostedToLedger");
  const postedAfterReplay = eventsAfterReplay.filter((event) => event.eventType === "PostedToLedger");
  const postedForVoucher = postedAfterReplay.filter((event) => event.aggregateId === created.voucher.id);

  assert.equal(postedForVoucher.length, 1);
  assert.equal(postedAfterReplay.length, postedBeforeConfirm.length);
  assert.equal(eventsAfterConfirm.length, eventsBeforeConfirm.length);
  assert.equal(eventsAfterReplay.length, eventsAfterConfirm.length);
  assert.deepEqual(confirmed.resultingEventIds, []);
  assert.deepEqual(replayed.resultingEventIds, []);

  return {
    initialStatus: item.status,
    confirmedStatus: confirmed.status,
    storedStatus: stored?.status ?? null,
    resultingEventCount: confirmed.resultingEventIds?.length ?? 0,
    idempotentReplay: replayed.status === "confirmed",
    confirmEventDelta: eventsAfterConfirm.length - eventsBeforeConfirm.length,
    replayEventDelta: eventsAfterReplay.length - eventsAfterConfirm.length,
    postedForVoucher: postedForVoucher.length,
  };
}

export async function scenarioLineEnrichmentSupersession(h: ConformanceHarness): Promise<ConformanceOutcome> {
  const created = await h.store.createEvidence({
    actorId: h.actorId,
    title: "Line enrichment conformance",
    originalFilename: "line-enrichment-conformance.pdf",
    mimeType: "application/pdf",
    modalities: ["upload"],
  });
  await h.store.applyReviewDecision(created.review.id, "approve", { actorId: h.actorId });
  const eventsAfterPosting = await h.store.getEvents();
  const posted = eventsAfterPosting.find(
    (event) => event.eventType === "PostedToLedger" && event.aggregateId === created.voucher.id,
  );
  const lineId = (posted?.payload.lines as Array<{ lineId?: string }> | undefined)?.[0]?.lineId;
  assert.ok(lineId);

  const record = await h.store.proposeEnrichmentWorkItem({
    actorId: h.actorId,
    targetKind: "line",
    targetId: lineId,
    proposedChange: {
      kind: "line_enrichment_record",
      lineId,
      enrichmentType: "project",
      payload: { projectId: "project_1" },
    },
    source: "ui",
    idempotencyKey: `ui:line-record:${lineId}`,
  });
  const confirmedRecord = await h.store.confirmEnrichmentWorkItem(record.id, { actorId: h.actorId });
  const recordedEvent = (await h.store.getEvents()).find((event) =>
    confirmedRecord.resultingEventIds?.includes(event.id),
  );
  const enrichmentId = recordedEvent?.payload.enrichmentId;
  assert.equal(typeof enrichmentId, "string");

  const proposeSupersession = (idempotencyKey: string) =>
    h.store.proposeEnrichmentWorkItem({
      actorId: h.actorId,
      targetKind: "line",
      targetId: lineId,
      proposedChange: {
        kind: "line_enrichment_supersede",
        lineId,
        priorEnrichmentId: String(enrichmentId),
        replacement: { enrichmentType: "project", payload: { projectId: "project_2" } },
      },
      source: "ui",
      idempotencyKey,
    });

  const supersede = await proposeSupersession(`ui:line-supersede:${lineId}`);
  const confirmedSupersede = await h.store.confirmEnrichmentWorkItem(supersede.id, { actorId: h.actorId });
  const stale = await proposeSupersession(`ui:line-supersede-stale:${lineId}`);
  await assert.rejects(
    () => h.store.confirmEnrichmentWorkItem(stale.id, { actorId: h.actorId }),
    LineEnrichmentNotActiveError,
  );
  const eventsAfterSupersession = await h.store.getEvents();

  return {
    recordEventCount: confirmedRecord.resultingEventIds?.length ?? 0,
    supersedeEventCount: confirmedSupersede.resultingEventIds?.length ?? 0,
    postedEventDelta:
      eventsAfterSupersession.filter((event) => event.eventType === "PostedToLedger").length -
      eventsAfterPosting.filter((event) => event.eventType === "PostedToLedger").length,
    staleStatus: (await h.store.getEnrichmentWorkItem(stale.id))?.status ?? null,
  };
}

export async function scenarioExternalReferences(h: ConformanceHarness): Promise<ConformanceOutcome> {
  const created = await h.store.createEvidence({
    actorId: h.actorId,
    title: "External reference conformance",
    originalFilename: "external-reference-conformance.pdf",
    mimeType: "application/pdf",
    modalities: ["upload"],
  });
  await h.store.applyReviewDecision(created.review.id, "approve", { actorId: h.actorId });
  const postingCountBefore = (await h.store.getEvents()).filter((event) => event.eventType === "PostedToLedger").length;

  const linked = await h.store.appendVoucherExternalReference(created.voucher.id, {
    url: "https://example.com/direct",
    label: "Direct",
    actorId: h.actorId,
  });
  const removed = await h.store.removeVoucherExternalReference(created.voucher.id, linked.refId, {
    actorId: h.actorId,
  });

  const proposed = await h.store.proposeEnrichmentWorkItem({
    actorId: "system:mcp",
    targetKind: "voucher",
    targetId: created.voucher.id,
    proposedChange: { kind: "external_reference_link", url: "https://example.com/proposed" },
    source: "mcp",
    idempotencyKey: `mcp:external-reference:${created.voucher.id}`,
  });
  const confirmed = await h.store.confirmEnrichmentWorkItem(proposed.id, { actorId: h.actorId });
  const proposedLink = (await h.store.getEvents()).find((event) => event.id === confirmed.resultingEventIds?.[0]);
  assert.equal(proposedLink?.eventType, "ExternalReferenceLinked");
  const proposedRefId = proposedLink?.payload.refId;
  assert.equal(typeof proposedRefId, "string");

  const unlinkProposal = await h.store.proposeEnrichmentWorkItem({
    actorId: "system:mcp",
    targetKind: "voucher",
    targetId: created.voucher.id,
    proposedChange: { kind: "external_reference_unlink", refId: String(proposedRefId) },
    source: "mcp",
    idempotencyKey: `mcp:external-reference:unlink:${created.voucher.id}`,
  });
  const unlinkConfirmed = await h.store.confirmEnrichmentWorkItem(unlinkProposal.id, { actorId: h.actorId });

  const invalidUnlink = await h.store.proposeEnrichmentWorkItem({
    actorId: "system:mcp",
    targetKind: "voucher",
    targetId: created.voucher.id,
    proposedChange: { kind: "external_reference_unlink", refId: "ref_missing" },
    source: "mcp",
    idempotencyKey: `mcp:external-reference:missing:${created.voucher.id}`,
  });
  const eventCountBeforeInvalid = (await h.store.getEvents()).length;
  let invalidUnlinkError = "none";
  try {
    await h.store.confirmEnrichmentWorkItem(invalidUnlink.id, { actorId: h.actorId });
  } catch (error) {
    invalidUnlinkError =
      error instanceof ExternalReferenceNotFoundError
        ? "ExternalReferenceNotFoundError"
        : error instanceof Error
          ? error.name
          : "unknown";
  }
  const events = await h.store.getEvents();
  const postingCountAfter = events.filter((event) => event.eventType === "PostedToLedger").length;
  const externalEvents = events.filter(
    (event) =>
      event.aggregateId === created.voucher.id &&
      (event.eventType === "ExternalReferenceLinked" || event.eventType === "ExternalReferenceRemoved"),
  );

  return {
    linkedRemovedInitially: linked.removed,
    removedMarked: removed.removed,
    removedRetainsUrl: removed.url,
    eventTypes: externalEvents.map((event) => event.eventType),
    proposedResultCount: confirmed.resultingEventIds?.length ?? 0,
    proposalUnlinkResultCount: unlinkConfirmed.resultingEventIds?.length ?? 0,
    proposalActor: externalEvents.at(-2)?.actorId ?? null,
    invalidUnlinkError,
    invalidUnlinkEventDelta: events.length - eventCountBeforeInvalid,
    postingDelta: postingCountAfter - postingCountBefore,
  };
}

export async function scenarioVoucherTags(h: ConformanceHarness): Promise<ConformanceOutcome> {
  await h.seedTagDefinition?.({ id: "tag_travel", name: "Travel" });
  const created = await h.store.createEvidence({
    actorId: h.actorId,
    title: "Voucher tags conformance",
    originalFilename: "voucher-tags-conformance.pdf",
    mimeType: "application/pdf",
    modalities: ["upload"],
  });
  await h.store.applyReviewDecision(created.review.id, "approve", { actorId: h.actorId });
  const postingCountBefore = (await h.store.getEvents()).filter((event) => event.eventType === "PostedToLedger").length;

  const direct = await h.store.appendVoucherTags(created.voucher.id, {
    tagIds: ["tag_travel"],
    mode: "add",
    actorId: h.actorId,
  });
  const directReplay = await h.store.appendVoucherTags(created.voucher.id, {
    tagIds: ["tag_travel"],
    mode: "add",
    actorId: h.actorId,
  });
  const activeSnapshotTagIds =
    (await h.store.getSnapshot()).voucherTags.find((projection) => projection.voucherId === created.voucher.id)
      ?.tagIds ?? [];
  const removeProposal = await h.store.proposeEnrichmentWorkItem({
    actorId: "system:mcp",
    targetKind: "voucher",
    targetId: created.voucher.id,
    proposedChange: { kind: "voucher_tags_remove", tagIds: ["tag_travel"] },
    source: "mcp",
    idempotencyKey: `mcp:tags:remove:${created.voucher.id}`,
  });
  const removed = await h.store.confirmEnrichmentWorkItem(removeProposal.id, { actorId: h.actorId });
  const replayedRemoval = await h.store.confirmEnrichmentWorkItem(removeProposal.id, { actorId: h.actorId });
  const emptySnapshotTagIds =
    (await h.store.getSnapshot()).voucherTags.find((projection) => projection.voucherId === created.voucher.id)
      ?.tagIds ?? [];

  const events = await h.store.getEvents();
  const tagEvents = events.filter(
    (event) => event.eventType === "VoucherTagsAdded" || event.eventType === "VoucherTagsRemoved",
  );
  const postingCountAfter = events.filter((event) => event.eventType === "PostedToLedger").length;
  return {
    directTags: direct.tagIds,
    directReplayTags: directReplay.tagIds,
    activeSnapshotTagIds,
    emptySnapshotTagIds,
    tagEventTypes: tagEvents.map((event) => event.eventType),
    removeResultCount: removed.resultingEventIds?.length ?? 0,
    idempotentRemoval: replayedRemoval.resultingEventIds?.length === removed.resultingEventIds?.length,
    postingDelta: postingCountAfter - postingCountBefore,
  };
}

export async function scenarioProjectRegistration(h: ConformanceHarness): Promise<ConformanceOutcome> {
  const eventsBefore = (await h.store.getEvents()).length;
  const first = await h.store.registerProject({
    projectId: "proj_conformance",
    name: "Original project",
    actorId: h.actorId,
  });
  const duplicate = await h.store.registerProject({
    projectId: "proj_conformance",
    name: "Replacement name",
    actorId: "user:other",
  });
  const projectEvents = (await h.store.getEvents()).filter(
    (event) => event.eventType === "ProjectRegistered" && event.aggregateId === "proj_conformance",
  );

  return {
    firstName: first.name,
    duplicateName: duplicate.name,
    duplicateStatus: duplicate.status,
    eventDelta: (await h.store.getEvents()).length - eventsBefore,
    projectEventCount: projectEvents.length,
    registrationActor: projectEvents[0]?.actorId ?? null,
  };
}

export async function scenarioInvoicePayments(h: ConformanceHarness): Promise<ConformanceOutcome> {
  const firstInvoice = await h.store.registerInvoice({
    invoiceId: "inv_conformance",
    direction: "ar",
    counterparty: "Original customer",
    dueDate: "2026-09-01",
    currency: "SEK",
    originalAmount: 100,
    actorId: h.actorId,
  });
  const duplicateInvoice = await h.store.registerInvoice({
    invoiceId: "inv_conformance",
    direction: "ap",
    counterparty: "Replacement supplier",
    dueDate: "2026-10-01",
    currency: "EUR",
    originalAmount: 500,
    actorId: "user:other",
  });
  const firstPayment = await h.store.allocatePayment({
    paymentId: "pay_conformance",
    invoiceId: "inv_conformance",
    amount: 40,
    currency: "SEK",
    allocatedAt: "2026-08-15T10:00:00.000Z",
    actorId: h.actorId,
  });
  const duplicatePayment = await h.store.allocatePayment({
    paymentId: "pay_conformance",
    invoiceId: "inv_conformance",
    amount: 99,
    currency: "SEK",
    allocatedAt: "2026-08-16T10:00:00.000Z",
    actorId: "user:other",
  });
  const beforeMismatch = (await h.store.getEvents()).length;
  let mismatchError = "none";
  try {
    await h.store.allocatePayment({
      paymentId: "pay_wrong_currency",
      invoiceId: "inv_conformance",
      amount: 10,
      currency: "EUR",
      allocatedAt: "2026-08-17T10:00:00.000Z",
      actorId: h.actorId,
    });
  } catch (error) {
    mismatchError = error instanceof Error ? error.name : "unknown";
  }
  const events = await h.store.getEvents();
  const invoiceEvents = events.filter(
    (event) => event.eventType === "InvoiceRegistered" && event.aggregateId === "inv_conformance",
  );
  const paymentEvents = events.filter(
    (event) => event.eventType === "PaymentAllocated" && event.payload.paymentId === "pay_conformance",
  );
  assert.equal(duplicateInvoice.counterparty, firstInvoice.counterparty);
  assert.equal(duplicatePayment.amount, firstPayment.amount);
  assert.equal(invoiceEvents.length, 1);
  assert.equal(paymentEvents.length, 1);
  assert.equal(mismatchError, "InvoiceAllocationCurrencyError");
  assert.equal(events.length - beforeMismatch, 0);

  return {
    firstCounterparty: firstInvoice.counterparty,
    duplicateCounterparty: duplicateInvoice.counterparty,
    firstPaymentAmount: firstPayment.amount,
    duplicatePaymentAmount: duplicatePayment.amount,
    invoiceEventCount: invoiceEvents.length,
    paymentEventCount: paymentEvents.length,
    registrationActor: invoiceEvents[0]?.actorId ?? null,
    paymentActor: paymentEvents[0]?.actorId ?? null,
    mismatchError,
    mismatchEventDelta: events.length - beforeMismatch,
  };
}

export async function scenarioInvoiceReviewApproval(h: ConformanceHarness): Promise<ConformanceOutcome> {
  const invalid = await h.store.createEvidence({
    actorId: h.actorId,
    title: "Invalid invoice approval conformance",
    originalFilename: "invalid-invoice-approval-conformance.pdf",
    mimeType: "application/pdf",
    modalities: ["upload"],
  });
  await h.store.attachReviewEnrichmentIntent({
    actorId: h.actorId,
    reviewId: invalid.review.id,
    proposals: [
      {
        kind: "invoice_registration",
        direction: "ap",
        counterparty: "Invalid supplier",
        dueDate: "not-a-date",
      } as EnrichmentProposal,
    ],
  });
  const eventsBeforeInvalidApproval = await h.store.getEvents();
  await assert.rejects(() =>
    h.store.applyReviewDecision(invalid.review.id, "approve", {
      actorId: h.actorId,
    }),
  );
  const eventsAfterInvalidApproval = await h.store.getEvents();
  const invalidReview = (await h.store.getSnapshot()).reviews.find((review) => review.id === invalid.review.id);
  assert.equal(eventsAfterInvalidApproval.length, eventsBeforeInvalidApproval.length);
  assert.equal(invalidReview?.status, "needs-review");

  const created = await h.store.createEvidence({
    actorId: h.actorId,
    title: "Invoice approval conformance",
    originalFilename: "invoice-approval-conformance.pdf",
    mimeType: "application/pdf",
    modalities: ["upload"],
  });
  await h.store.attachReviewEnrichmentIntent({
    actorId: h.actorId,
    reviewId: created.review.id,
    proposals: [
      {
        kind: "invoice_registration",
        direction: "ap",
        counterparty: "Conformance supplier",
        dueDate: "2026-09-01",
      },
    ],
  });

  const approved = await h.store.applyReviewDecision(created.review.id, "approve", { actorId: h.actorId });
  const replayed = await h.store.applyReviewDecision(created.review.id, "approve", { actorId: "user:other" });
  const events = await h.store.getEvents();
  const postedEvents = events.filter(
    (event) => event.eventType === "PostedToLedger" && event.aggregateId === created.voucher.id,
  );
  const registrationEvents = events.filter(
    (event) => event.eventType === "InvoiceRegistered" && event.payload.counterparty === "Conformance supplier",
  );
  const registration = registrationEvents[0];
  const invoiceId = String(registration?.payload.invoiceId ?? "");
  const enrichmentEvents = events.filter(
    (event) =>
      event.eventType === "LineEnrichmentRecorded" &&
      event.payload.enrichmentType === "invoice" &&
      (event.payload.payload as { invoiceId?: string } | undefined)?.invoiceId === invoiceId,
  );
  const postedLineIds = new Set(
    (postedEvents[0]?.payload.lines as Array<{ lineId?: string }> | undefined)
      ?.map((line) => line.lineId)
      .filter((lineId): lineId is string => lineId !== undefined) ?? [],
  );

  assert.equal(approved?.status, "approved");
  assert.equal(replayed?.status, "approved");
  assert.equal(postedEvents.length, 1);
  assert.equal(registrationEvents.length, 1);
  assert.equal(enrichmentEvents.length, 1);
  assert.match(invoiceId, /^inv_/);
  assert.equal(registration?.payload.direction, "ap");
  assert.equal(registration?.payload.dueDate, "2026-09-01");
  assert.equal(registration?.payload.currency, created.voucher.voucherFields.currency);
  assert.equal(registration?.payload.originalAmount, created.voucher.voucherFields.grossAmount);
  assert.equal(registration?.actorId, h.actorId);
  assert.ok(postedLineIds.has(String(enrichmentEvents[0]?.payload.lineId)));
  assert.equal(await h.store.getReviewEnrichmentIntent(created.review.id), undefined);

  return {
    approvedStatus: approved?.status ?? null,
    replayedStatus: replayed?.status ?? null,
    postedCount: postedEvents.length,
    registrationCount: registrationEvents.length,
    enrichmentCount: enrichmentEvents.length,
    direction: registration?.payload.direction ?? null,
    counterparty: registration?.payload.counterparty ?? null,
    dueDate: registration?.payload.dueDate ?? null,
    currency: registration?.payload.currency ?? null,
    originalAmount: normalizeNumber(registration?.payload.originalAmount),
    registrationActor: registration?.actorId ?? null,
    enrichmentBoundToPostedLine: postedLineIds.has(String(enrichmentEvents[0]?.payload.lineId)),
    intentConsumed: (await h.store.getReviewEnrichmentIntent(created.review.id)) === undefined,
    invalidApprovalEventDelta: eventsAfterInvalidApproval.length - eventsBeforeInvalidApproval.length,
    invalidReviewStatus: invalidReview?.status ?? null,
  };
}

export async function scenarioTripReviewApproval(h: ConformanceHarness): Promise<ConformanceOutcome> {
  const created = await h.store.createEvidence({
    actorId: h.actorId,
    title: "Trip approval conformance",
    originalFilename: "trip-approval-conformance.pdf",
    mimeType: "application/pdf",
    modalities: ["upload"],
  });
  const proposal = {
    kind: "trip_registration" as const,
    purpose: "Customer visit",
    traveler: "Ada",
    startDate: "2026-08-01",
    endDate: "2026-08-03",
    evidenceId: created.evidence.id,
  };

  await h.store.attachReviewEnrichmentIntent({
    actorId: h.actorId,
    reviewId: created.review.id,
    proposals: [{ ...proposal, evidenceId: "evidence_outside_packet" }],
  });
  const eventsBeforeInvalid = await h.store.getEvents();
  await assert.rejects(
    () => h.store.applyReviewDecision(created.review.id, "approve", { actorId: h.actorId }),
    /evidence.*packet/i,
  );
  const eventsAfterInvalid = await h.store.getEvents();
  assert.equal(eventsAfterInvalid.length, eventsBeforeInvalid.length);

  await h.store.attachReviewEnrichmentIntent({
    actorId: h.actorId,
    reviewId: created.review.id,
    proposals: [proposal],
  });
  const approved = await h.store.applyReviewDecision(created.review.id, "approve", { actorId: h.actorId });
  const replayed = await h.store.applyReviewDecision(created.review.id, "approve", { actorId: "user:other" });
  const events = await h.store.getEvents();
  const postedEvents = events.filter(
    (event) => event.eventType === "PostedToLedger" && event.aggregateId === created.voucher.id,
  );
  const registrationEvents = events.filter(
    (event) => event.eventType === "TripRegistered" && event.payload.purpose === proposal.purpose,
  );
  const registration = registrationEvents[0];
  const tripId = String(registration?.payload.tripId ?? "");
  const enrichmentEvents = events.filter(
    (event) =>
      event.eventType === "LineEnrichmentRecorded" &&
      event.payload.enrichmentType === "trip" &&
      (event.payload.payload as { tripId?: string } | undefined)?.tripId === tripId,
  );
  const postedLineIds = new Set(
    (postedEvents[0]?.payload.lines as Array<{ lineId?: string }> | undefined)
      ?.map((line) => line.lineId)
      .filter((lineId): lineId is string => lineId !== undefined) ?? [],
  );

  assert.equal(approved?.status, "approved");
  assert.equal(replayed?.status, "approved");
  assert.equal(postedEvents.length, 1);
  assert.equal(registrationEvents.length, 1);
  assert.equal(enrichmentEvents.length, 1);
  assert.match(tripId, /^trip_/);
  assert.equal(registration?.payload.evidenceId, created.evidence.id);
  assert.equal(registration?.actorId, h.actorId);
  assert.ok(postedLineIds.has(String(enrichmentEvents[0]?.payload.lineId)));
  assert.equal(await h.store.getReviewEnrichmentIntent(created.review.id), undefined);

  return {
    invalidApprovalEventDelta: eventsAfterInvalid.length - eventsBeforeInvalid.length,
    approvedStatus: approved?.status ?? null,
    replayedStatus: replayed?.status ?? null,
    postedCount: postedEvents.length,
    registrationCount: registrationEvents.length,
    enrichmentCount: enrichmentEvents.length,
    purpose: registration?.payload.purpose ?? null,
    traveler: registration?.payload.traveler ?? null,
    evidencePreserved: registration?.payload.evidenceId === created.evidence.id,
    registrationActor: registration?.actorId ?? null,
    enrichmentBoundToPostedLine: postedLineIds.has(String(enrichmentEvents[0]?.payload.lineId)),
    intentConsumed: (await h.store.getReviewEnrichmentIntent(created.review.id)) === undefined,
  };
}

export async function scenarioTripSupersessionGuards(h: ConformanceHarness): Promise<ConformanceOutcome> {
  const created = await h.store.createEvidence({
    actorId: h.actorId,
    title: "Trip supersession conformance",
    originalFilename: "trip-supersession-conformance.pdf",
    mimeType: "application/pdf",
    modalities: ["upload"],
  });
  await h.store.applyReviewDecision(created.review.id, "approve", { actorId: h.actorId });
  const posted = (await h.store.getEvents()).find(
    (event) => event.eventType === "PostedToLedger" && event.aggregateId === created.voucher.id,
  );
  const lineId = (posted?.payload.lines as Array<{ lineId?: string }> | undefined)?.[0]?.lineId;
  assert.ok(lineId);

  const tripA = {
    tripId: "trip_supersession_a",
    purpose: "Customer visit",
    traveler: "Ada",
    startDate: "2026-08-01",
    endDate: "2026-08-03",
  };
  const tripB = {
    tripId: "trip_supersession_b",
    purpose: "Conference",
    traveler: "Ada",
    startDate: "2026-08-04",
    endDate: "2026-08-05",
  };
  await h.store.registerTrip({ ...tripA, actorId: h.actorId });
  await h.store.registerTrip({ ...tripB, actorId: h.actorId });

  const proposeRecord = async (enrichmentType: string, payload: Record<string, unknown>, idempotencyKey: string) => {
    const item = await h.store.proposeEnrichmentWorkItem({
      actorId: h.actorId,
      targetKind: "line",
      targetId: lineId,
      proposedChange: { kind: "line_enrichment_record", lineId, enrichmentType, payload },
      source: "ui",
      idempotencyKey,
    });
    return h.store.confirmEnrichmentWorkItem(item.id, { actorId: h.actorId });
  };
  const projectConfirmation = await proposeRecord(
    "project",
    { projectId: "project_trip_supersession" },
    `trip-supersession:project:${lineId}`,
  );
  const projectEvent = (await h.store.getEvents()).find((event) =>
    projectConfirmation.resultingEventIds?.includes(event.id),
  );
  const projectEnrichmentId = String(projectEvent?.payload.enrichmentId ?? "");
  assert.match(projectEnrichmentId, /^le_/);

  const proposeSupersession = (priorEnrichmentId: string, trip: typeof tripA, idempotencyKey: string) =>
    h.store.proposeEnrichmentWorkItem({
      actorId: h.actorId,
      targetKind: "line",
      targetId: lineId,
      proposedChange: {
        kind: "line_enrichment_supersede",
        lineId,
        priorEnrichmentId,
        replacement: { enrichmentType: "trip", payload: trip },
      },
      source: "ui",
      idempotencyKey,
    });

  const unregistered = await proposeSupersession(
    projectEnrichmentId,
    { ...tripB, tripId: "trip_supersession_missing" },
    `trip-supersession:missing:${lineId}`,
  );
  const beforeUnregistered = (await h.store.getEvents()).length;
  await assert.rejects(
    () => h.store.confirmEnrichmentWorkItem(unregistered.id, { actorId: h.actorId }),
    /registered trip/i,
  );
  const afterUnregistered = (await h.store.getEvents()).length;

  const tripAConfirmation = await proposeRecord("trip", tripA, `trip-supersession:trip-a:${lineId}`);
  const tripAEvent = (await h.store.getEvents()).find((event) =>
    tripAConfirmation.resultingEventIds?.includes(event.id),
  );
  const tripAEnrichmentId = String(tripAEvent?.payload.enrichmentId ?? "");
  assert.match(tripAEnrichmentId, /^le_/);

  const crossTrip = await proposeSupersession(projectEnrichmentId, tripB, `trip-supersession:cross-trip:${lineId}`);
  const beforeCrossTrip = (await h.store.getEvents()).length;
  await assert.rejects(
    () => h.store.confirmEnrichmentWorkItem(crossTrip.id, { actorId: h.actorId }),
    /already assigned to trip trip_supersession_a/i,
  );
  const afterCrossTrip = (await h.store.getEvents()).length;

  const move = await proposeSupersession(tripAEnrichmentId, tripB, `trip-supersession:move:${lineId}`);
  const confirmedMove = await h.store.confirmEnrichmentWorkItem(move.id, { actorId: h.actorId });
  const resultingEvents = (await h.store.getEvents()).filter((event) =>
    confirmedMove.resultingEventIds?.includes(event.id),
  );

  return {
    unregisteredEventDelta: afterUnregistered - beforeUnregistered,
    unregisteredStatus: (await h.store.getEnrichmentWorkItem(unregistered.id))?.status ?? null,
    crossTripEventDelta: afterCrossTrip - beforeCrossTrip,
    crossTripStatus: (await h.store.getEnrichmentWorkItem(crossTrip.id))?.status ?? null,
    moveEventTypes: resultingEvents.map((event) => event.eventType),
    moveTripId: (resultingEvents[1]?.payload.payload as { tripId?: string } | undefined)?.tripId ?? null,
  };
}

export async function scenarioQuantityInventoryReviewApproval(h: ConformanceHarness): Promise<ConformanceOutcome> {
  const invalid = await h.store.createEvidence({
    actorId: h.actorId,
    title: "Invalid quantity inventory approval conformance",
    originalFilename: "invalid-quantity-inventory-approval-conformance.pdf",
    mimeType: "application/pdf",
    modalities: ["upload"],
  });
  await h.store.attachReviewEnrichmentIntent({
    actorId: h.actorId,
    reviewId: invalid.review.id,
    proposals: [
      {
        kind: "quantity_inventory_movement",
        skuId: "sku_inventory_invalid",
        quantity: 1,
        uom: "st",
        direction: "in",
      },
    ],
  });
  const eventsBeforeInvalid = await h.store.getEvents();
  await assert.rejects(
    () =>
      h.store.applyReviewDecision(invalid.review.id, "approve", {
        actorId: h.actorId,
        edited: {
          accountNumber: "1930",
          accountName: "Bank",
          vatCode: "VAT25",
          grossAmount: 125,
          netAmount: 100,
          vatAmount: 25,
        },
      }),
    InventoryMovementLineNotFoundError,
  );
  const eventsAfterInvalid = await h.store.getEvents();
  const invalidReview = (await h.store.getSnapshot()).reviews.find((review) => review.id === invalid.review.id);
  assert.equal(eventsAfterInvalid.length, eventsBeforeInvalid.length);
  assert.equal(invalidReview?.status, "needs-review");
  assert.ok(await h.store.getReviewEnrichmentIntent(invalid.review.id));

  const created = await h.store.createEvidence({
    actorId: h.actorId,
    title: "Quantity inventory approval conformance",
    originalFilename: "quantity-inventory-approval-conformance.pdf",
    mimeType: "application/pdf",
    modalities: ["upload"],
  });
  await h.store.attachReviewEnrichmentIntent({
    actorId: h.actorId,
    reviewId: created.review.id,
    proposals: [
      {
        kind: "quantity_inventory_movement",
        skuId: "sku_inventory_conformance",
        quantity: 3,
        uom: "st",
        direction: "out",
      },
    ],
  });

  const approved = await h.store.applyReviewDecision(created.review.id, "approve", { actorId: h.actorId });
  const eventsAfterApproval = await h.store.getEvents();
  const replayed = await h.store.applyReviewDecision(created.review.id, "approve", { actorId: "user:other" });
  const eventsAfterReplay = await h.store.getEvents();
  const postedEvents = eventsAfterReplay.filter(
    (event) => event.eventType === "PostedToLedger" && event.aggregateId === created.voucher.id,
  );
  const movementEvents = eventsAfterReplay.filter(
    (event) => event.eventType === "InventoryMovementRecorded" && event.payload.skuId === "sku_inventory_conformance",
  );
  const movement = movementEvents[0];
  const postedLines =
    (postedEvents[0]?.payload.lines as Array<{ lineId?: string; bookedAt?: string }> | undefined) ?? [];
  const postedLine = postedLines.find((line) => line.lineId === movement?.payload.lineId);

  assert.equal(approved?.status, "approved");
  assert.equal(replayed?.status, "approved");
  assert.equal(postedEvents.length, 1);
  assert.equal(movementEvents.length, 1);
  assert.match(String(movement?.payload.movementId), /^mov_/);
  assert.match(String(movement?.payload.lineId), /^ln_/);
  assert.ok(postedLine);
  assert.equal(movement?.payload.bookedAt, postedLine.bookedAt);
  assert.equal(movement?.actorId, h.actorId);
  assert.equal(await h.store.getReviewEnrichmentIntent(created.review.id), undefined);
  assert.equal(eventsAfterReplay.length, eventsAfterApproval.length);

  return {
    invalidApprovalEventDelta: eventsAfterInvalid.length - eventsBeforeInvalid.length,
    invalidReviewStatus: invalidReview?.status ?? null,
    invalidIntentPreserved: Boolean(await h.store.getReviewEnrichmentIntent(invalid.review.id)),
    approvedStatus: approved?.status ?? null,
    replayedStatus: replayed?.status ?? null,
    postedCount: postedEvents.length,
    movementCount: movementEvents.length,
    serverDerivedMovementId: /^mov_/.test(String(movement?.payload.movementId)),
    serverDerivedLineId: /^ln_/.test(String(movement?.payload.lineId)),
    movementBoundToPostedLine: Boolean(postedLine),
    bookingDateMatchesPostedLine: movement?.payload.bookedAt === postedLine?.bookedAt,
    movementActor: movement?.actorId ?? null,
    intentConsumed: (await h.store.getReviewEnrichmentIntent(created.review.id)) === undefined,
    replayEventDelta: eventsAfterReplay.length - eventsAfterApproval.length,
  };
}

export async function scenarioTripLifecycle(h: ConformanceHarness): Promise<ConformanceOutcome> {
  const first = await h.store.registerTrip({
    tripId: "trip_conformance",
    purpose: "Original purpose",
    traveler: "Ada",
    startDate: "2026-08-01",
    endDate: "2026-08-03",
    actorId: h.actorId,
  });
  const duplicate = await h.store.registerTrip({
    tripId: "trip_conformance",
    purpose: "Replacement purpose",
    traveler: "Grace",
    startDate: "2026-09-01",
    endDate: "2026-09-02",
    actorId: "user:other",
  });
  const firstClose = await h.store.closeTrip({ tripId: "trip_conformance", actorId: h.actorId });
  const duplicateClose = await h.store.closeTrip({ tripId: "trip_conformance", actorId: "user:other" });
  const events = (await h.store.getEvents()).filter(
    (event) =>
      (event.eventType === "TripRegistered" || event.eventType === "TripClosed") &&
      event.aggregateId === "trip_conformance",
  );

  assert.equal(duplicate.purpose, first.purpose);
  assert.equal(duplicate.traveler, first.traveler);
  assert.deepEqual(duplicateClose, firstClose);
  assert.deepEqual(
    events.map((event) => event.eventType),
    ["TripRegistered", "TripClosed"],
  );

  return {
    purpose: duplicate.purpose,
    traveler: duplicate.traveler,
    eventTypes: events.map((event) => event.eventType),
    actors: events.map((event) => event.actorId),
  };
}

export const CONFORMANCE_SCENARIOS: Array<{
  name: string;
  run: (h: ConformanceHarness) => Promise<ConformanceOutcome>;
}> = [
  { name: "evidence create → approve → reports", run: scenarioEvidenceCreateApproveReports },
  { name: "evidence dedupe", run: scenarioEvidenceDedupe },
  { name: "compose + extraction refresh", run: scenarioComposeAndExtraction },
  { name: "review ordering + suggestions", run: scenarioReviewOrderingAndSuggestion },
  { name: "SIE import idempotency + reports window", run: scenarioSieImportIdempotency },
  { name: "settings / alerts / simulation / unknown ids", run: scenarioSettingsAlertsSimulation },
  { name: "append-only event vocabulary", run: scenarioAppendOnlyEventVocabulary },
  { name: "review reject", run: scenarioReviewReject },
  { name: "review approve with edits", run: scenarioReviewApproveEdited },
  { name: "pre-post enrichment single posting", run: scenarioPrePostEnrichmentSinglePosting },
  { name: "line-target work item never posts", run: scenarioLineTargetWorkItemNeverPosts },
  { name: "enrichment confirm never posts twice", run: scenarioEnrichmentWorkItemConfirmNeverPosts },
  { name: "line enrichment supersession", run: scenarioLineEnrichmentSupersession },
  { name: "external reference append-only paths", run: scenarioExternalReferences },
  { name: "voucher tag append-only paths", run: scenarioVoucherTags },
  { name: "project registration is immutable", run: scenarioProjectRegistration },
  { name: "invoice and payment identity is immutable", run: scenarioInvoicePayments },
  { name: "invoice review approval registers once atomically", run: scenarioInvoiceReviewApproval },
  { name: "trip review approval registers once atomically", run: scenarioTripReviewApproval },
  { name: "trip supersession guards", run: scenarioTripSupersessionGuards },
  {
    name: "quantity inventory review approval records once atomically",
    run: scenarioQuantityInventoryReviewApproval,
  },
  { name: "trip registration and close are immutable", run: scenarioTripLifecycle },
];

export function assertConformanceParity(
  memoryOutcome: ConformanceOutcome,
  postgresOutcome: ConformanceOutcome,
  scenarioName: string,
): void {
  assert.deepEqual(postgresOutcome, memoryOutcome, `Memory/Postgres conformance mismatch for "${scenarioName}"`);
}
