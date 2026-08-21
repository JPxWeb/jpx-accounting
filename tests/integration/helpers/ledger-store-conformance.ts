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
  DRAFT_VOUCHER_NUMBER,
  InvalidPeriodTokenError,
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
    composedItemCount: composed.packet.evidenceIds.length,
    voucherRelinked: context?.voucher?.evidencePacketId === composed.packet.id,
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

  // KFR Phase D / Task 1 (readiness G3): the import materializes an
  // already-posted Voucher row so migrated history is attachable and displays
  // its real series+number. Re-import must NOT duplicate or rewrite the row.
  const snapshot = await h.store.getSnapshot();
  const importedVoucher = snapshot.vouchers.find((voucher) => voucher.id === "sie_A_42");
  assert.equal(
    importedVoucher?.voucherNumber,
    "A 42",
    `${h.label}: imported voucher row must exist with its reference`,
  );
  assert.equal(importedVoucher?.origin, "import", `${h.label}: imported voucher origin`);
  assert.equal(importedVoucher?.status, "posted", `${h.label}: imported voucher status`);
  assert.equal(importedVoucher?.evidencePacketId, null, `${h.label}: imported voucher carries no evidence packet`);

  // KFR Phase D / Task 3 (readiness G4): non-fatal parse warnings must survive
  // into the result identically in both stores. Imported LAST so it can't
  // perturb any delta measured above. `#IB` is recognized only to warn — the
  // 15 000,50 opening balance must NOT show up as a ledger line.
  const warningFile = parseSie(
    ["#SIETYP 4", "#IB 0 1930 15000.50", '#VER W 1 20260520 "Warning fixture"', "{", "#TRANS 1930 {} 0.00", "}"].join(
      "\n",
    ),
  );
  const warningResult = await h.store.importSie({ actorId: h.actorId, file: warningFile });
  assert.equal(result.warnings.length, 0, `${h.label}: the clean march fixture must carry no parse warnings`);
  assert.ok(
    warningResult.warnings.some((warning) => warning.includes("#IB") && warning.includes("1930")),
    `${h.label}: a non-zero #IB must surface as an import warning`,
  );
  const balanceLines = (await h.store.getReports()).journal.filter(
    (entry) => normalizeNumber(entry.debit) === 15000.5 || normalizeNumber(entry.credit) === 15000.5,
  );
  assert.equal(balanceLines.length, 0, `${h.label}: #IB opening balances must never be imported as ledger lines`);

  return {
    importedVouchers: result.importedVouchers,
    importedTransactions: result.importedTransactions,
    journalDelta: journalAfter - journalBefore,
    eventDelta: eventsAfter - eventsBefore,
    replayImported: replay.importedVouchers,
    // KFR Phase D / Task 3: ParsedSieFile.warnings threads into the result.
    // The march fixture is clean, so both stores must report exactly 0.
    parseWarningCount: result.warnings.length,
    replayParseWarningCount: replay.warnings.length,
    ibWarnings: warningResult.warnings,
    replaySkippedReason: replay.skipped[0]?.reason ?? null,
    journalReplayDelta: journalReplay - journalAfter,
    eventReplayDelta: eventsReplay - eventsAfter,
    marchLines,
    importedVoucherCount: snapshot.vouchers.filter((voucher) => voucher.origin === "import").length,
    importedVoucherNumber: importedVoucher?.voucherNumber ?? null,
    importedVoucherOrigin: importedVoucher?.origin ?? null,
    importedVoucherStatus: importedVoucher?.status ?? null,
    importedVoucherEvidencePacketId: importedVoucher?.evidencePacketId ?? null,
    importedVoucherDescription: importedVoucher?.voucherFields.description ?? null,
    importedVoucherTransactionDate: importedVoucher?.voucherFields.transactionDate ?? null,
    // The imported voucher has no ReviewTask — it never passed a review decision.
    importedVoucherInReviewFeed: (await h.store.getReviewFeed()).some((review) => review.voucherId === "sie_A_42"),
  };
}

/**
 * KFR Phase D / Task 2: `composeEvidence({ targetVoucherId })` attaches the
 * composed packet to an explicitly named voucher — imported OR native —
 * instead of inferring one from evidence packet history. Imported vouchers
 * start with `evidencePacketId: null` and no prior packet, so auto-detect can
 * never reach them; the explicit target is the only attach path for migrated
 * history. An unknown target throws before any mutation.
 */
export async function scenarioComposeEvidenceTargetVoucher(h: ConformanceHarness): Promise<ConformanceOutcome> {
  const file = parseSie(
    [
      "#SIETYP 4",
      '#KONTO 6110 "Kontorsmateriel"',
      '#VER B 7 20260410 "Inkopta pennor"',
      "{",
      "#TRANS 6110 {} 50.00",
      "#TRANS 1930 {} -50.00",
      "}",
    ].join("\n"),
  );
  await h.store.importSie({ actorId: h.actorId, file });
  const importedVoucherId = "sie_B_7";

  const receipt = await h.store.createEvidence({
    actorId: h.actorId,
    title: "Receipt for imported voucher",
    originalFilename: "receipt-b7.jpg",
    mimeType: "image/jpeg",
    modalities: ["camera"],
  });
  const nativeVoucherId = receipt.voucher.id;
  const nativePacketId = receipt.packet.id;

  // --- attach to the imported (never-linked) voucher -----------------------
  const eventsBeforeCompose = (await h.store.getEvents()).length;
  const composed = await h.store.composeEvidence({
    actorId: h.actorId,
    evidenceIds: [receipt.evidence.id],
    targetVoucherId: importedVoucherId,
  });
  const eventsAfterCompose = await h.store.getEvents();
  // KFR E.5: the attach now appends TWO events — the relink, then the rejection
  // of the receipt's own orphaned intake draft — so the relink is no longer the
  // chain tail. Locate it by type instead of by position.
  const relink = eventsAfterCompose.findLast((event) => event.eventType === "EvidenceRelinked");
  const context = await h.store.getEvidenceContext(receipt.evidence.id);
  const snapshotAfterAttach = await h.store.getSnapshot();
  const nativeVoucherAfterAttach = snapshotAfterAttach.vouchers.find((voucher) => voucher.id === nativeVoucherId);

  assert.equal(
    context?.voucher?.id,
    importedVoucherId,
    `${h.label}: explicit targetVoucherId must attach the packet to the imported voucher`,
  );
  assert.equal(
    context?.voucher?.evidencePacketId,
    composed.packet.id,
    `${h.label}: the imported voucher must point at the freshly composed packet`,
  );
  assert.equal(relink?.eventType, "EvidenceRelinked", `${h.label}: the attach must append an EvidenceRelinked event`);
  assert.equal(relink?.aggregateId, importedVoucherId, `${h.label}: relink event aggregate is the target voucher`);
  assert.deepEqual(
    composed.discardedReviewIds,
    [receipt.review.id],
    `${h.label}: attaching the receipt elsewhere discards its own intake draft (E.5)`,
  );
  assert.equal(
    eventsAfterCompose.at(-1)?.eventType,
    "ReviewRejected",
    `${h.label}: the discard is chain-visible, appended after the relink`,
  );

  // --- unknown target: throws, and changes nothing -------------------------
  const eventsBeforeMiss = (await h.store.getEvents()).length;
  let notFoundError = "none";
  try {
    await h.store.composeEvidence({
      actorId: h.actorId,
      evidenceIds: [receipt.evidence.id],
      targetVoucherId: "sie_does_not_exist",
    });
  } catch (error) {
    // Cross-boundary error identity travels by `name`, never `instanceof`
    // (the Postgres store re-throws through its own module graph).
    notFoundError = error instanceof Error ? error.name : "unknown";
  }
  const eventsAfterMiss = (await h.store.getEvents()).length;
  const contextAfterMiss = await h.store.getEvidenceContext(receipt.evidence.id);

  assert.equal(notFoundError, "VoucherNotFoundError", `${h.label}: unknown targetVoucherId must throw`);
  assert.equal(eventsAfterMiss, eventsBeforeMiss, `${h.label}: the 404 path must append no events`);

  // --- attach to a NATIVE voucher: its review linkage must survive ---------
  const secondCompose = await h.store.composeEvidence({
    actorId: h.actorId,
    evidenceIds: [receipt.evidence.id],
    targetVoucherId: nativeVoucherId,
  });
  const eventsAfterSecond = await h.store.getEvents();
  const secondRelink = eventsAfterSecond.findLast((event) => event.eventType === "EvidenceRelinked");
  const contextAfterSecond = await h.store.getEvidenceContext(receipt.evidence.id);
  const feed = await h.store.getReviewFeed();
  const snapshotFinal = await h.store.getSnapshot();
  const importedVoucherFinal = snapshotFinal.vouchers.find((voucher) => voucher.id === importedVoucherId);
  const nativeVoucherFinal = snapshotFinal.vouchers.find((voucher) => voucher.id === nativeVoucherId);

  assert.equal(
    contextAfterSecond?.voucher?.id,
    nativeVoucherId,
    `${h.label}: an explicit attach to a native voucher wins over the previous link`,
  );
  assert.ok(
    feed.some((review) => review.voucherId === nativeVoucherId),
    `${h.label}: re-pointing a native voucher's packet must not disturb its review linkage`,
  );
  assert.deepEqual(
    secondCompose.discardedReviewIds,
    [],
    `${h.label}: attaching back onto the receipt's OWN intake voucher discards nothing`,
  );

  return {
    // Generated packet ids differ per store — compare linkage, not identity.
    attachedVoucherId: context?.voucher?.id ?? null,
    attachedVoucherOrigin: context?.voucher?.origin ?? null,
    attachedVoucherStatus: context?.voucher?.status ?? null,
    voucherLinkMatchesComposedPacket: context?.voucher?.evidencePacketId === composed.packet.id,
    contextPacketIsComposedPacket: context?.packet?.id === composed.packet.id,
    composeEventDelta: eventsAfterCompose.length - eventsBeforeCompose,
    relinkEventType: relink?.eventType ?? null,
    relinkAggregateId: relink?.aggregateId ?? null,
    relinkActorId: relink?.actorId ?? null,
    relinkVoucherIdInPayload: relink?.payload.voucherId ?? null,
    relinkPacketIsComposedPacket: relink?.payload.packetId === composed.packet.id,
    // First-ever attach to an imported voucher: no previous packet to record.
    relinkPreviousPacketId: relink?.payload.previousPacketId === undefined ? "none" : "present",
    // The receipt's own native voucher is untouched by an attach elsewhere.
    nativeVoucherPacketUnchangedAfterAttach: nativeVoucherAfterAttach?.evidencePacketId === nativePacketId,

    notFoundError,
    notFoundEventDelta: eventsAfterMiss - eventsBeforeMiss,
    notFoundLeavesAttachIntact:
      contextAfterMiss?.voucher?.id === importedVoucherId && contextAfterMiss?.packet?.id === composed.packet.id,

    secondAttachVoucherId: contextAfterSecond?.voucher?.id === nativeVoucherId ? "native" : "other",
    secondRelinkAggregateIsNative: secondRelink?.aggregateId === nativeVoucherId,
    secondRelinkPreviousPacketId: secondRelink?.payload.previousPacketId === nativePacketId ? "native" : "other",
    nativeVoucherLinkedToSecondPacket: nativeVoucherFinal?.evidencePacketId === secondCompose.packet.id,
    // Re-pointing a native voucher's packet never rewrites its review linkage.
    nativeReviewStillLinked: feed.some((review) => review.voucherId === nativeVoucherId),
    // The imported voucher keeps the packet it was attached to.
    importedVoucherKeepsFirstPacket: importedVoucherFinal?.evidencePacketId === composed.packet.id,
    importedVoucherInReviewFeed: feed.some((review) => review.voucherId === importedVoucherId),
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
      // Phase D, Task 6: the optional irregular-first-fiscal-year floor must
      // survive the profile round trip identically in both stores, and both
      // must feed it to `buildReportPack`.
      firstFiscalYearStart: "2025-10-15",
      vatPeriod: "quarterly" as const,
    },
    aiPosture: { advisorEnabled: true, suggestionsEnabled: true },
  };
  const saved = await h.store.putCompanySettings(settings);
  const loaded = await h.store.getCompanySettings();
  const flooredFy = await h.store.getReportPack({ period: "fy-2025" });

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
    settingsFirstFiscalYearStart: loaded?.profile.firstFiscalYearStart,
    // 01-01 anchor + a 2025-10-15 floor → fy-2025 starts at the floor, ends untouched.
    flooredFyFrom: flooredFy.period.from,
    flooredFyTo: flooredFy.period.to,
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

/**
 * Manual N-line journal entry through the review gate (KFR Phase B, Tasks 7/9).
 *
 * Covers the whole lifecycle in one scenario so Memory and Postgres are pinned
 * to the same behavior end to end: create → visible in the review feed →
 * `suggestVoucher` does NOT regenerate over the verbatim lines → approve posts
 * those exact lines to the journal → a second entry's reject path posts
 * nothing. The `suggestVoucher` step is load-bearing, not incidental:
 * `POST /api/vouchers/:id/suggest` is reachable for ANY voucher id, and a
 * store that rebuilds a deterministic single-account suggestion there strips
 * `suggestion.lines` and turns the next approval into the manual-origin
 * invariant throw.
 */
export async function scenarioManualVoucherLifecycle(h: ConformanceHarness): Promise<ConformanceOutcome> {
  const journalBefore = (await h.store.getReports()).journal.length;
  const feedBefore = (await h.store.getReviewFeed()).length;
  const eventsBefore = (await h.store.getEvents()).length;

  const result = await h.store.createManualVoucher({
    actorId: h.actorId,
    description: "Manual conformance entry",
    bookedAt: "2026-03-20",
    lines: [
      { accountNumber: "6991", debit: 100, credit: 0, vatCode: "NA" },
      { accountNumber: "2899", debit: 0, credit: 100, vatCode: "NA" },
    ],
  });

  const feedAfterCreate = await h.store.getReviewFeed();
  const feedIncludesReview = feedAfterCreate.some((review) => review.id === result.reviewId);
  const snapshot = await h.store.getSnapshot();
  const voucher = snapshot.vouchers.find((v) => v.id === result.voucherId);

  const createEvents = (await h.store.getEvents())
    .slice(eventsBefore)
    .filter((event) => event.aggregateId === result.voucherId || event.aggregateId === result.reviewId);

  // Verbatim-line preservation: regeneration must be refused for manual origin
  // in BOTH stores, and it must not clobber the stored review suggestion.
  const regenerated = await h.store.suggestVoucher(result.voucherId);
  const reviewAfterSuggest = await h.store.findReviewByVoucher(result.voucherId);

  const decided = await h.store.applyReviewDecision(result.reviewId, "approve", { actorId: h.actorId });
  const journalAfter = (await h.store.getReports()).journal.length;
  const postedLines = (await h.store.getReports({ from: "2026-03-20", to: "2026-03-20" })).journal.filter(
    (entry) => entry.voucherId === result.voucherId,
  );

  // Reject path on a second manual entry: decided, but nothing posted.
  const rejectedEntry = await h.store.createManualVoucher({
    actorId: h.actorId,
    description: "Manual conformance reject",
    bookedAt: "2026-03-21",
    lines: [
      { accountNumber: "6991", debit: 40, credit: 0, vatCode: "NA" },
      { accountNumber: "2899", debit: 0, credit: 40, vatCode: "NA" },
    ],
  });
  const journalBeforeReject = (await h.store.getReports()).journal.length;
  const rejectedReview = await h.store.applyReviewDecision(rejectedEntry.reviewId, "reject", { actorId: h.actorId });
  const journalAfterReject = (await h.store.getReports()).journal.length;
  const eventsAfterReject = await h.store.getEvents();
  const rejectPosted = eventsAfterReject.some(
    (event) => event.eventType === "PostedToLedger" && event.aggregateId === rejectedEntry.voucherId,
  );
  const rejectRecorded = eventsAfterReject.some(
    (event) => event.eventType === "ReviewRejected" && event.aggregateId === rejectedEntry.reviewId,
  );

  // An unbalanced entry is refused before anything becomes visible. Memory's
  // planner throws before it touches a Map; Postgres runs the same gate INSIDE
  // the transaction, so it is the rollback that makes "no rows, no events"
  // true — worth pinning on both stores rather than assuming.
  const eventsBeforeInvalid = (await h.store.getEvents()).length;
  const vouchersBeforeInvalid = (await h.store.getSnapshot()).vouchers.length;
  let invalidError = "none";
  try {
    await h.store.createManualVoucher({
      actorId: h.actorId,
      description: "Unbalanced conformance entry",
      bookedAt: "2026-03-22",
      lines: [
        { accountNumber: "6991", debit: 100.01, credit: 0, vatCode: "NA" },
        { accountNumber: "2899", debit: 0, credit: 100, vatCode: "NA" },
      ],
    });
  } catch (error) {
    // Cross-boundary error identity: name, never instanceof (tsx keeps a dual
    // module cache, so class identity can differ per import path).
    invalidError = error instanceof Error ? error.name : "unknown";
  }
  const invalidEventDelta = (await h.store.getEvents()).length - eventsBeforeInvalid;
  const invalidVoucherDelta = (await h.store.getSnapshot()).vouchers.length - vouchersBeforeInvalid;

  return {
    feedDelta: feedAfterCreate.length - feedBefore,
    feedIncludesReview,
    createEventTypes: createEvents.map((event) => event.eventType),
    voucherOrigin: voucher?.origin ?? null,
    voucherEvidencePacketId: voucher ? voucher.evidencePacketId : "voucher-missing",
    voucherStatus: voucher?.status ?? null,
    regeneratedAccounts: regenerated?.lines?.map((line) => line.accountNumber) ?? null,
    reviewSuggestionAccounts: reviewAfterSuggest?.suggestion?.lines?.map((line) => line.accountNumber) ?? null,
    decidedStatus: decided?.status ?? null,
    journalDelta: journalAfter - journalBefore,
    postedLineCount: postedLines.length,
    postedAccounts: postedLines.map((line) => [
      line.accountNumber,
      normalizeNumber(line.debit),
      normalizeNumber(line.credit),
    ]),
    postedBookedAt: postedLines[0]?.bookedAt.slice(0, 10) ?? null,
    rejectedStatus: rejectedReview?.status ?? null,
    rejectJournalDelta: journalAfterReject - journalBeforeReject,
    rejectPosted,
    rejectRecorded,
    invalidError,
    invalidEventDelta,
    invalidVoucherDelta,
  };
}

/**
 * Posting-time voucher numbering (KFR E.1 / G8) — the parity that matters most
 * here is that BOTH stores derive the same `V-<n>` from the same sequence of
 * decisions, because the two compute the posted count by completely different
 * means (a Map scan vs. a `COUNT(*)` under the workspace advisory lock).
 *
 * Pinned behavior: intake never numbers; reject never burns a number; approve
 * AND book-without-vat both do; manual entries share the ONE sequence with
 * captured vouchers; a replayed decision never re-mints; and an already-posted
 * voucher is never renumbered by later postings.
 */
export async function scenarioPostingTimeNumbering(h: ConformanceHarness): Promise<ConformanceOutcome> {
  const create = async (label: string) =>
    h.store.createEvidence({
      actorId: h.actorId,
      title: `Numbering ${label}`,
      originalFilename: `numbering-${label}.pdf`,
      mimeType: "application/pdf",
      modalities: ["pdf"],
      extractedText: `Numbering ${label} body`,
    });

  const numberOf = async (voucherId: string): Promise<string | null> =>
    (await h.store.getSnapshot()).vouchers.find((voucher) => voucher.id === voucherId)?.voucherNumber ?? null;

  const rejected = await create("rejected");
  const approved = await create("approved");
  const bookedWithoutVat = await create("booked");

  const numbersAtIntake = [
    await numberOf(rejected.voucher.id),
    await numberOf(approved.voucher.id),
    await numberOf(bookedWithoutVat.voucher.id),
  ];

  await h.store.applyReviewDecision(rejected.review.id, "reject", { actorId: h.actorId });
  const rejectedNumber = await numberOf(rejected.voucher.id);

  await h.store.applyReviewDecision(approved.review.id, "approve", { actorId: h.actorId });
  const approvedNumber = await numberOf(approved.voucher.id);

  await h.store.applyReviewDecision(bookedWithoutVat.review.id, "book-without-vat", { actorId: h.actorId });
  const bookedNumber = await numberOf(bookedWithoutVat.voucher.id);

  // Manual entries run through the SAME posting branch — one shared sequence.
  const manual = await h.store.createManualVoucher({
    actorId: h.actorId,
    description: "Numbering manual entry",
    bookedAt: "2026-03-20",
    lines: [
      { accountNumber: "6991", debit: 100, credit: 0, vatCode: "NA" },
      { accountNumber: "2899", debit: 0, credit: 100, vatCode: "NA" },
    ],
  });
  const manualNumberAtIntake = await numberOf(manual.voucherId);
  await h.store.applyReviewDecision(manual.reviewId, "approve", { actorId: h.actorId });
  const manualNumber = await numberOf(manual.voucherId);

  // Replay: a second decision on a decided review must not re-mint a number.
  await h.store.applyReviewDecision(approved.review.id, "approve", { actorId: h.actorId });

  // Absolute pins, not just parity: both harnesses start with zero POSTED
  // vouchers (Memory's demo seed is needs-review, a fresh PG namespace is
  // empty), so the sequence is deterministic and dense on both sides.
  assert.deepEqual(
    numbersAtIntake,
    [DRAFT_VOUCHER_NUMBER, DRAFT_VOUCHER_NUMBER, DRAFT_VOUCHER_NUMBER],
    `${h.label}: intake must never mint a voucher number`,
  );
  assert.equal(rejectedNumber, DRAFT_VOUCHER_NUMBER, `${h.label}: a rejected draft never burns a V-number`);
  assert.equal(approvedNumber, "V-1001", `${h.label}: the first posting takes V-1001`);
  assert.equal(bookedNumber, "V-1002", `${h.label}: book-without-vat posts, so it takes the next number`);
  assert.equal(manualNumberAtIntake, DRAFT_VOUCHER_NUMBER, `${h.label}: manual entries are drafts at intake too`);
  assert.equal(manualNumber, "V-1003", `${h.label}: manual entries share the ONE posting sequence`);

  return {
    numbersAtIntake,
    rejectedNumber,
    approvedNumber,
    bookedNumber,
    manualNumberAtIntake,
    manualNumber,
    approvedNumberAfterLaterPostings: await numberOf(approved.voucher.id),
    rejectedNumberAtEnd: await numberOf(rejected.voucher.id),
  };
}

/**
 * KFR Phase E / E.5 — the orphaned intake draft is discarded WITH the attach,
 * and nothing else is.
 *
 * The regression this exists for: the first implementation decided "is this the
 * receipt's own draft?" from the live packet graph, whose conditions are all
 * satisfied by ANY voucher the receipt is currently attached to. Two ordinary
 * sequential attaches were therefore enough to reject a bystander's review.
 * `intakeEvidenceId` is a recorded creation-time fact, so a second attach can
 * only ever find the draft the FIRST one already discarded.
 *
 * Pinned: (1) attaching to an approved target discards the receipt's own draft
 * and posts nothing; (2) a SECOND attach discards nothing and leaves an
 * unrelated pending review untouched; (3) attaching a DIFFERENT receipt to a
 * native voucher that has its own pending review never touches that review.
 */
export async function scenarioAttachDiscardsOnlyItsOwnIntakeDraft(h: ConformanceHarness): Promise<ConformanceOutcome> {
  const create = async (label: string) =>
    h.store.createEvidence({
      actorId: h.actorId,
      title: `Attach discard ${label}`,
      originalFilename: `attach-discard-${label}.jpg`,
      mimeType: "image/jpeg",
      modalities: ["camera"],
      extractedText: `Attach discard ${label} body`,
    });

  // A: the receipt that gets moved around. B: an innocent bystander whose own
  // draft is still pending. T: an approved (posted) attach target.
  const a = await create("a");
  const b = await create("b");
  const target = await create("target");
  await h.store.applyReviewDecision(target.review.id, "approve", { actorId: h.actorId });

  const statusOf = async (reviewId: string) =>
    (await h.store.getReviewFeed()).find((review) => review.id === reviewId)?.status ?? null;
  const journalLength = async () => (await h.store.getReports()).journal.length;

  const journalBefore = await journalLength();

  // --- attach 1: A → the approved target ----------------------------------
  const first = await h.store.composeEvidence({
    actorId: h.actorId,
    evidenceIds: [a.evidence.id],
    targetVoucherId: target.voucher.id,
  });
  const aStatusAfterFirst = await statusOf(a.review.id);
  const bStatusAfterFirst = await statusOf(b.review.id);
  const journalAfterFirst = await journalLength();

  assert.deepEqual(
    first.discardedReviewIds,
    [a.review.id],
    `${h.label}: the first attach discards exactly A's own intake draft`,
  );
  assert.equal(aStatusAfterFirst, "rejected", `${h.label}: A's orphaned draft is rejected, not left pending`);
  assert.equal(bStatusAfterFirst, "needs-review", `${h.label}: B's unrelated draft is untouched`);
  assert.equal(journalAfterFirst, journalBefore, `${h.label}: a discard posts no journal lines`);

  // --- attach 2: A → B's still-pending draft (the CRITICAL regression) -----
  // A's own draft is already rejected, so this attach must discard NOTHING —
  // and above all must not reject B's review, which belongs to B's receipt.
  const second = await h.store.composeEvidence({
    actorId: h.actorId,
    evidenceIds: [a.evidence.id],
    targetVoucherId: b.voucher.id,
  });
  const bStatusAfterSecond = await statusOf(b.review.id);

  assert.deepEqual(second.discardedReviewIds, [], `${h.label}: a second attach has no intake draft left to discard`);
  assert.equal(
    bStatusAfterSecond,
    "needs-review",
    `${h.label}: attaching A onto B's draft must NEVER reject B's review`,
  );

  // --- attach 3: a DIFFERENT receipt onto a voucher with a pending review --
  const c = await create("c");
  const third = await h.store.composeEvidence({
    actorId: h.actorId,
    evidenceIds: [c.evidence.id],
    targetVoucherId: b.voucher.id,
  });
  const bStatusAfterThird = await statusOf(b.review.id);

  assert.deepEqual(third.discardedReviewIds, [c.review.id], `${h.label}: C's own draft is the only one discarded`);
  assert.equal(bStatusAfterThird, "needs-review", `${h.label}: the attach target's own review still survives`);

  // Voucher numbers: a discard never posts, so it never burns one.
  const snapshot = await h.store.getSnapshot();
  const numbered = snapshot.vouchers.filter((voucher) => voucher.voucherNumber.startsWith("V-"));
  assert.deepEqual(
    numbered.map((voucher) => voucher.voucherNumber),
    ["V-1001"],
    `${h.label}: only the approved target ever took a number`,
  );

  return {
    firstDiscardIsOwnDraft: first.discardedReviewIds.length === 1 && first.discardedReviewIds[0] === a.review.id,
    aStatusAfterFirst,
    bStatusAfterFirst,
    secondDiscardCount: second.discardedReviewIds.length,
    bStatusAfterSecond,
    thirdDiscardIsOwnDraft: third.discardedReviewIds.length === 1 && third.discardedReviewIds[0] === c.review.id,
    bStatusAfterThird,
    journalUnchangedByDiscards: (await journalLength()) === journalBefore,
    numberedVoucherCount: numbered.length,
    // The recorded intake fact itself must agree across stores.
    intakeEvidenceIdOfOwnDraft:
      snapshot.vouchers.find((voucher) => voucher.id === a.voucher.id)?.intakeEvidenceId === a.evidence.id
        ? "own-evidence"
        : "other",
    intakeEvidenceIdOfApprovedTarget:
      snapshot.vouchers.find((voucher) => voucher.id === target.voucher.id)?.intakeEvidenceId === target.evidence.id
        ? "own-evidence"
        : "other",
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
  { name: "compose evidence with explicit targetVoucherId", run: scenarioComposeEvidenceTargetVoucher },
  { name: "attach discards only its own intake draft", run: scenarioAttachDiscardsOnlyItsOwnIntakeDraft },
  { name: "settings / alerts / simulation / unknown ids", run: scenarioSettingsAlertsSimulation },
  { name: "append-only event vocabulary", run: scenarioAppendOnlyEventVocabulary },
  { name: "review reject", run: scenarioReviewReject },
  { name: "review approve with edits", run: scenarioReviewApproveEdited },
  { name: "manual voucher lifecycle", run: scenarioManualVoucherLifecycle },
  { name: "posting-time voucher numbering", run: scenarioPostingTimeNumbering },
];

export function assertConformanceParity(
  memoryOutcome: ConformanceOutcome,
  postgresOutcome: ConformanceOutcome,
  scenarioName: string,
): void {
  assert.deepEqual(postgresOutcome, memoryOutcome, `Memory/Postgres conformance mismatch for "${scenarioName}"`);
}
