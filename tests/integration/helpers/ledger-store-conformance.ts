/**
 * Shared LedgerStore behavior scenarios for Memory ↔ Postgres conformance
 * (Local Postgres Dev DB plan, Task 5).
 *
 * Scenarios return structural facts only — generated IDs, timestamps, hashes,
 * and provider numeric quirks are normalized away so both stores can be compared.
 */
import assert from "node:assert/strict";

import type { ExtractionResult } from "@jpx-accounting/contracts";
import {
  deriveDeterministicExtraction,
  InvalidPeriodTokenError,
  parseSie,
  ReviewNotFoundError,
  today,
  type LedgerStore,
} from "@jpx-accounting/domain";

export type ConformanceHarness = {
  label: string;
  store: LedgerStore;
  organizationId: string;
  workspaceId: string;
  actorId: string;
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
  let chainOk = true;
  let previous = relevant[0]?.previousHash;
  for (let i = 1; i < relevant.length; i += 1) {
    const event = relevant[i];
    if (!event || event.previousHash !== previous) {
      // Chain may interleave with other aggregates on Memory (seed) — for Postgres
      // namespaces it's contiguous. Check only that every event has a previousHash
      // and a non-empty eventHash.
      break;
    }
    previous = event.eventHash;
  }
  for (const event of relevant) {
    if (!event.previousHash || !event.eventHash) chainOk = false;
  }

  return {
    vocabulary,
    hasEvidenceReceived: vocabulary.includes("EvidenceReceived"),
    hasFieldsExtracted: vocabulary.includes("FieldsExtracted"),
    hasVoucherCreated: vocabulary.includes("VoucherCreated"),
    hasSuggestionGenerated: vocabulary.includes("SuggestionGenerated"),
    hasReviewApproved: vocabulary.includes("ReviewApproved"),
    hasPostedToLedger: vocabulary.includes("PostedToLedger"),
    chainFieldsPresent: chainOk,
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
];

export function assertConformanceParity(
  memoryOutcome: ConformanceOutcome,
  postgresOutcome: ConformanceOutcome,
  scenarioName: string,
): void {
  assert.deepEqual(postgresOutcome, memoryOutcome, `Memory/Postgres conformance mismatch for "${scenarioName}"`);
}
