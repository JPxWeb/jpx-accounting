import assert from "node:assert/strict";
import { test } from "node:test";

import type { AccountingSuggestion, ReviewTask, Voucher } from "@jpx-accounting/contracts";
import {
  InvoiceRegistrationAmountError,
  InvoiceRegistrationLineNotFoundError,
  mergePrePostEnrichmentsIntoReviewDecisionPlan,
  planPrePostEnrichment,
  planReviewDecision,
} from "@jpx-accounting/domain";

const voucher: Voucher = {
  id: "v1",
  organizationId: "org_jpx",
  workspaceId: "workspace_main",
  evidencePacketId: "p1",
  voucherNumber: "V-v1",
  status: "needs-review",
  accountingMethod: "invoice",
  extractedFields: [],
  voucherFields: {
    grossAmount: 125,
    netAmount: 100,
    vatAmount: 25,
    currency: "SEK",
    description: "Pre-post",
  },
  createdAt: "2026-05-01T00:00:00.000Z",
  createdBy: "user:test",
};

const suggestion: AccountingSuggestion = {
  id: "s_v1",
  voucherId: "v1",
  accountNumber: "6540",
  accountName: "IT-tjanster",
  vatCode: "VAT25",
  confidence: 0.9,
  reasoning: "r",
  kind: "recommendation",
  citations: [],
  ruleHits: [],
};

const review: ReviewTask = {
  id: "r1",
  voucherId: "v1",
  title: "Pre-post fixture",
  status: "needs-review",
  suggestedAction: "approve",
  suggestion,
  provenanceTimeline: [],
};

test("pre-post enrichment emits a companion event without another posting", () => {
  const base = planReviewDecision(review, voucher, "approve", { actorId: "user:abc" }, "2026-08-09T12:00:00.000Z");
  assert.equal(base.kind, "apply");
  const lineId = base.kind === "apply" ? base.lines?.[0]?.lineId : undefined;
  assert.ok(lineId);

  const enrichment = planPrePostEnrichment({
    review,
    proposals: [
      {
        kind: "line_enrichment_record",
        lineId,
        enrichmentType: "project",
        payload: { projectId: "proj_1" },
      },
    ],
    postingLines: base.lines ?? [],
    postingVoucher: base.postingVoucher,
    evidenceIds: [],
    actorId: "user:abc",
    organizationId: voucher.organizationId,
    workspaceId: voucher.workspaceId,
  });
  assert.deepEqual(
    enrichment.companionEvents.map((event) => event.eventType),
    ["LineEnrichmentRecorded"],
  );
  assert.ok(enrichment.companionEvents.every((event) => event.eventType !== "PostedToLedger"));

  const merged = mergePrePostEnrichmentsIntoReviewDecisionPlan(base, enrichment.companionEvents);
  assert.equal(merged.kind, "apply");
  assert.equal(
    merged.kind === "apply" ? merged.events.filter((event) => event.eventType === "PostedToLedger").length : 0,
    1,
  );
  assert.equal(merged.kind === "apply" ? merged.events.at(-1)?.eventType : undefined, "LineEnrichmentRecorded");
});

test("pre-post enrichment rejects a line outside the posting batch", () => {
  assert.throws(
    () =>
      planPrePostEnrichment({
        review,
        proposals: [
          {
            kind: "line_enrichment_record",
            lineId: "ln_missing",
            enrichmentType: "project",
            payload: { projectId: "proj_1" },
          },
        ],
        postingLines: [],
        postingVoucher: voucher,
        evidenceIds: [],
        actorId: "user:abc",
        organizationId: voucher.organizationId,
        workspaceId: voucher.workspaceId,
      }),
    /line|ln_missing/i,
  );
});

test("invoice approval derives identity, currency, amount, and line binding on the server", () => {
  const base = planReviewDecision(
    review,
    voucher,
    "approve",
    {
      actorId: "user:abc",
      edited: {
        accountNumber: "6540",
        vatCode: "VAT25",
        grossAmount: 100.1,
        netAmount: 80.08,
        vatAmount: 20.02,
      },
    },
    "2026-08-09T12:00:00.000Z",
  );
  assert.equal(base.kind, "apply");
  assert.ok(base.postingVoucher);

  const enrichment = planPrePostEnrichment({
    review,
    proposals: [
      {
        kind: "invoice_registration",
        direction: "ap",
        counterparty: "Acme AB",
        dueDate: "2026-09-01",
      },
    ],
    postingLines: base.lines ?? [],
    postingVoucher: base.postingVoucher,
    evidenceIds: [],
    actorId: "user:abc",
    organizationId: voucher.organizationId,
    workspaceId: voucher.workspaceId,
  });

  assert.deepEqual(
    enrichment.companionEvents.map((event) => event.eventType),
    ["InvoiceRegistered", "LineEnrichmentRecorded"],
  );
  const [registered, enriched] = enrichment.companionEvents;
  assert.equal(registered?.actorId, "user:abc");
  assert.match(String(registered?.payload.invoiceId), /^inv_/);
  assert.deepEqual(
    {
      direction: registered?.payload.direction,
      counterparty: registered?.payload.counterparty,
      dueDate: registered?.payload.dueDate,
      currency: registered?.payload.currency,
      originalAmount: registered?.payload.originalAmount,
    },
    {
      direction: "ap",
      counterparty: "Acme AB",
      dueDate: "2026-09-01",
      currency: "SEK",
      originalAmount: 100.1,
    },
  );
  assert.equal(enriched?.actorId, "user:abc");
  assert.equal(enriched?.payload.enrichmentType, "invoice");
  const invoicePayload = enriched?.payload.payload as { invoiceId?: string; direction?: string } | undefined;
  assert.equal(invoicePayload?.invoiceId, registered?.payload.invoiceId);
  assert.equal(invoicePayload?.direction, "ap");
  assert.ok(base.lines?.some((line) => line.lineId === enriched?.payload.lineId));
});

test("invoice approval rejects invalid amount and missing line before planning events", () => {
  assert.throws(
    () =>
      planPrePostEnrichment({
        review,
        proposals: [
          {
            kind: "invoice_registration",
            direction: "ap",
            counterparty: "Acme AB",
            dueDate: "2026-09-01",
          },
        ],
        postingLines: [],
        postingVoucher: { ...voucher, voucherFields: { currency: "SEK" } },
        evidenceIds: [],
        actorId: "user:abc",
        organizationId: voucher.organizationId,
        workspaceId: voucher.workspaceId,
      }),
    InvoiceRegistrationLineNotFoundError,
  );

  const zeroLines = [
    {
      lineId: "ln_zero",
      voucherId: voucher.id,
      accountNumber: "6540",
      accountName: "IT-tjanster",
      description: "Zero",
      debit: 0,
      credit: 0,
      vatCode: "NA",
      bookedAt: "2026-08-09",
      deductible: false,
    },
  ];
  assert.throws(
    () =>
      planPrePostEnrichment({
        review,
        proposals: [
          {
            kind: "invoice_registration",
            direction: "ap",
            counterparty: "Acme AB",
            dueDate: "2026-09-01",
          },
        ],
        postingLines: zeroLines,
        postingVoucher: { ...voucher, voucherFields: { currency: "SEK" } },
        evidenceIds: [],
        actorId: "user:abc",
        organizationId: voucher.organizationId,
        workspaceId: voucher.workspaceId,
      }),
    InvoiceRegistrationAmountError,
  );
});

test("invoice approval rejects duplicate singleton proposals", () => {
  const proposal = {
    kind: "invoice_registration" as const,
    direction: "ap" as const,
    counterparty: "Acme AB",
    dueDate: "2026-09-01",
  };
  assert.throws(
    () =>
      planPrePostEnrichment({
        review,
        proposals: [proposal, proposal],
        postingLines: [
          {
            lineId: "ln_1",
            voucherId: voucher.id,
            accountNumber: "6540",
            accountName: "IT-tjanster",
            description: "Invoice",
            debit: 100,
            credit: 0,
            vatCode: "NA",
            bookedAt: "2026-08-09",
            deductible: false,
          },
        ],
        postingVoucher: voucher,
        evidenceIds: [],
        actorId: "user:abc",
        organizationId: voucher.organizationId,
        workspaceId: voucher.workspaceId,
      }),
    /single|duplicate|one/i,
  );
});

test("trip approval derives identity and binds reviewed fields to a posted cost line", () => {
  const base = planReviewDecision(review, voucher, "approve", { actorId: "user:abc" }, "2026-08-09T12:00:00.000Z");
  assert.equal(base.kind, "apply");

  const enrichment = planPrePostEnrichment({
    review,
    proposals: [
      {
        kind: "trip_registration",
        purpose: "Customer visit",
        traveler: "Ada",
        startDate: "2026-08-01",
        endDate: "2026-08-03",
        evidenceId: "evidence_1",
      },
    ],
    postingLines: base.lines ?? [],
    postingVoucher: base.postingVoucher,
    evidenceIds: ["evidence_1"],
    actorId: "user:abc",
    organizationId: voucher.organizationId,
    workspaceId: voucher.workspaceId,
  });

  assert.deepEqual(
    enrichment.companionEvents.map((event) => event.eventType),
    ["TripRegistered", "LineEnrichmentRecorded"],
  );
  const [registered, enriched] = enrichment.companionEvents;
  assert.match(String(registered?.payload.tripId), /^trip_/);
  assert.equal(registered?.actorId, "user:abc");
  assert.equal(registered?.payload.purpose, "Customer visit");
  assert.equal(registered?.payload.traveler, "Ada");
  assert.equal(registered?.payload.evidenceId, "evidence_1");
  assert.equal(enriched?.payload.enrichmentType, "trip");
  assert.equal((enriched?.payload.payload as { tripId?: string } | undefined)?.tripId, registered?.payload.tripId);
  assert.ok(base.lines?.some((line) => line.lineId === enriched?.payload.lineId));
});

test("trip approval rejects evidence outside the voucher packet before append", () => {
  const base = planReviewDecision(review, voucher, "approve", { actorId: "user:abc" }, "2026-08-09T12:00:00.000Z");
  assert.equal(base.kind, "apply");

  assert.throws(
    () =>
      planPrePostEnrichment({
        review,
        proposals: [
          {
            kind: "trip_registration",
            purpose: "Customer visit",
            traveler: "Ada",
            startDate: "2026-08-01",
            endDate: "2026-08-03",
            evidenceId: "evidence_other",
          },
        ],
        postingLines: base.lines ?? [],
        postingVoucher: base.postingVoucher,
        evidenceIds: ["evidence_1"],
        actorId: "user:abc",
        organizationId: voucher.organizationId,
        workspaceId: voucher.workspaceId,
      }),
    /evidence.*packet/i,
  );
});

test("quantity inventory approval emits one server-derived movement bound to a posted line", () => {
  const base = planReviewDecision(review, voucher, "approve", { actorId: "user:abc" }, "2026-08-09T12:00:00.000Z");
  assert.equal(base.kind, "apply");
  const postingLines = base.kind === "apply" ? (base.lines ?? []) : [];
  const expectedLine = postingLines.find(
    (line) =>
      line.lineId !== undefined &&
      !line.accountNumber.startsWith("26") &&
      !line.accountNumber.startsWith("19") &&
      !line.accountNumber.startsWith("24"),
  );
  assert.ok(expectedLine?.lineId);

  const enrichment = planPrePostEnrichment({
    review,
    proposals: [
      {
        kind: "quantity_inventory_movement",
        skuId: "sku_1",
        quantity: 3,
        uom: "st",
        direction: "out",
      },
    ],
    postingLines,
    postingVoucher: base.postingVoucher,
    evidenceIds: [],
    actorId: "user:abc",
    organizationId: voucher.organizationId,
    workspaceId: voucher.workspaceId,
  });

  assert.equal(enrichment.companionEvents.length, 1);
  const [movement] = enrichment.companionEvents;
  assert.equal(movement?.eventType, "InventoryMovementRecorded");
  assert.equal(movement?.actorId, "user:abc");
  assert.equal(movement?.aggregateId, expectedLine.lineId);
  assert.match(String(movement?.payload.movementId), /^mov_/);
  const { movementId: _movementId, ...movementPayload } = movement?.payload ?? {};
  assert.deepEqual(movementPayload, {
    skuId: "sku_1",
    quantity: 3,
    uom: "st",
    direction: "out",
    lineId: expectedLine.lineId,
    bookedAt: expectedLine.bookedAt,
  });
});

test("merge leaves replay decisions unchanged", () => {
  const closed: ReviewTask = { ...review, status: "approved" };
  const replay = planReviewDecision(closed, { ...voucher, status: "approved" }, "approve", { actorId: "user:abc" });
  const merged = mergePrePostEnrichmentsIntoReviewDecisionPlan(replay, []);
  assert.deepEqual(merged, replay);
});
