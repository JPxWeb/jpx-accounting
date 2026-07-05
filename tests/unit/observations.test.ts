import assert from "node:assert/strict";
import test from "node:test";

import type {
  EvidencePacket,
  JournalEntryProjection,
  MonthlyPoint,
  ReportPack,
  StatementGroup,
  TaxDeadline,
  Voucher,
  WorkspaceSnapshot,
} from "@jpx-accounting/contracts";
import { observationSchema } from "@jpx-accounting/contracts";
import {
  buildObservations,
  detectCashRunway,
  detectDeadlineProximity,
  detectExpenseAnomaly,
  detectMissingEvidence,
  detectSupplierSpike,
  detectVatSetAside,
  OBSERVATION_LIMIT,
} from "@jpx-accounting/reporting";

const TODAY = "2026-07-04";

const group = (key: StatementGroup["key"]): StatementGroup => ({ key, lines: [], total: 0 });

function makePack(partial: Partial<ReportPack> = {}): ReportPack {
  return {
    period: { token: "2026-07", kind: "month", from: "2026-07-01", to: "2026-07-31" },
    profitLoss: {
      period: { from: "2026-07-01", to: "2026-07-31" },
      groups: [],
      operatingResult: 0,
      financialNet: 0,
      periodResult: 0,
    },
    balanceSheet: {
      asOf: "2026-07-31",
      assets: group("assets"),
      equityAndLiabilities: group("equityAndLiabilities"),
      computedResult: 0,
      balanced: true,
    },
    vatReturn: [],
    cashBridge: { opening: 0, drivers: [], other: { amount: 0, accountNumbers: [] }, closing: 0 },
    monthly: [],
    generatedAt: "2026-07-04T00:00:00.000Z",
    ...partial,
  };
}

function point(month: string, cashIn: number, cashOut: number, cashClosing: number): MonthlyPoint {
  return { month, cashIn, cashOut, cashClosing, revenue: 0, result: 0 };
}

function makeSnapshot(partial: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    evidence: [],
    vouchers: [],
    reviews: [],
    reports: { journal: [], balances: [], vat: [] },
    assistantExamples: [],
    closeRun: { id: "close_test", period: "2026-07", generatedAt: "2026-07-04T00:00:00.000Z", checklist: [] },
    alerts: [],
    packets: [],
    ...partial,
  };
}

function makeVoucher(input: {
  id: string;
  packetId: string;
  supplier?: string;
  gross?: number;
  month?: string;
}): Voucher {
  return {
    id: input.id,
    organizationId: "org_jpx",
    workspaceId: "workspace_main",
    evidencePacketId: input.packetId,
    voucherNumber: `V-${input.id}`,
    status: "needs-review",
    accountingMethod: "invoice",
    extractedFields: [],
    voucherFields: {
      currency: "SEK",
      ...(input.supplier !== undefined ? { supplierName: input.supplier } : {}),
      ...(input.gross !== undefined ? { grossAmount: input.gross } : {}),
      ...(input.month !== undefined ? { transactionDate: `${input.month}-15` } : {}),
    },
    createdAt: "2026-07-01T10:00:00.000Z",
    createdBy: "user_founder",
  };
}

function packet(id: string, evidenceIds: string[]): EvidencePacket {
  return { id, evidenceIds };
}

function journalLine(input: {
  accountNumber: string;
  bookedAt: string;
  debit?: number;
  credit?: number;
}): JournalEntryProjection {
  return {
    id: `j_${input.accountNumber}_${input.bookedAt}`,
    voucherId: "v_journal",
    accountNumber: input.accountNumber,
    accountName: `Konto ${input.accountNumber}`,
    description: "Test line",
    debit: input.debit ?? 0,
    credit: input.credit ?? 0,
    bookedAt: input.bookedAt,
  };
}

function deadline(id: string, dueDate: string): TaxDeadline {
  return {
    id,
    kind: "vat-return",
    dueDate,
    periodLabel: "2026-Q2",
    periodToken: "2026-Q2",
    amountRef: "box49",
    sourceKey: "sv-vat-12",
  };
}

// --- cash-runway ------------------------------------------------------------

test("cash-runway: burning fixture yields runway = cash / trailing burn (reconciled)", () => {
  const pack = makePack({
    monthly: [
      point("2026-05", 0, 10_000, 30_000),
      point("2026-06", 0, 10_000, 20_000),
      point("2026-07", 0, 10_000, 10_000),
    ],
  });
  const [obs] = detectCashRunway(pack);
  assert.ok(obs);
  assert.equal(obs.severity, "critical"); // 10 000 / 10 000 = 1.0 < 1.5
  assert.equal(obs.titleKey, "cashRunway.burning");
  // Reconciliation guard: every params number is derivable from the fixture.
  assert.deepEqual(obs.params, { runwayMonths: 1, cash: 10_000, monthlyBurn: 10_000 });
  assert.deepEqual(obs.provenance, [{ kind: "report", target: "cash-bridge" }]);
  assert.equal(obs.action?.href, "/reports#cash-bridge");
  assert.equal(observationSchema.safeParse(obs).success, true);
});

test("cash-runway severities: warning below 3 months, info above", () => {
  const warning = detectCashRunway(
    makePack({ monthly: [point("2026-06", 0, 10_000, 30_000), point("2026-07", 0, 10_000, 20_000)] }),
  );
  assert.equal(warning[0]?.severity, "warning"); // 20 000 / 10 000 = 2.0

  const info = detectCashRunway(
    makePack({ monthly: [point("2026-06", 0, 10_000, 70_000), point("2026-07", 0, 10_000, 60_000)] }),
  );
  assert.equal(info[0]?.severity, "info"); // 6.0 months
});

test("cash-runway: only the last three ACTIVE points feed the burn", () => {
  const pack = makePack({
    monthly: [
      point("2026-02", 0, 90_000, 400_000),
      point("2026-03", 0, 90_000, 310_000),
      point("2026-04", 0, 0, 310_000), // inactive — skipped entirely
      point("2026-05", 0, 100, 309_900),
      point("2026-06", 0, 100, 309_800),
      point("2026-07", 0, 100, 309_700),
    ],
  });
  const [obs] = detectCashRunway(pack);
  assert.ok(obs);
  assert.equal(obs.params.monthlyBurn, 100);
  assert.equal(obs.severity, "info");
});

test("cash-runway: net-positive months become a positive info observation", () => {
  const pack = makePack({
    monthly: [point("2026-06", 20_000, 5_000, 40_000), point("2026-07", 20_000, 5_000, 55_000)],
  });
  const [obs] = detectCashRunway(pack);
  assert.ok(obs);
  assert.equal(obs.severity, "info");
  assert.equal(obs.titleKey, "cashRunway.positive");
  assert.deepEqual(obs.params, { cash: 55_000, monthlyNet: 15_000 });
});

test("cash-runway: fewer than two active months yields nothing", () => {
  assert.deepEqual(detectCashRunway(makePack({ monthly: [point("2026-07", 0, 10_000, 5_000)] })), []);
  assert.deepEqual(detectCashRunway(makePack({ monthly: [] })), []);
});

// --- expense-anomaly --------------------------------------------------------

test("expense-anomaly: a ≥2σ month on a cost account warns with reconciled params", () => {
  const journal = [
    journalLine({ accountNumber: "6110", bookedAt: "2026-03-05", debit: 900 }),
    journalLine({ accountNumber: "6110", bookedAt: "2026-04-05", debit: 1_100 }),
    journalLine({ accountNumber: "6110", bookedAt: "2026-05-05", debit: 1_000 }),
    journalLine({ accountNumber: "6110", bookedAt: "2026-06-05", debit: 1_000 }),
    journalLine({ accountNumber: "6110", bookedAt: "2026-07-05", debit: 2_000 }),
  ];
  const snapshot = makeSnapshot({ reports: { journal, balances: [], vat: [] } });
  const [obs] = detectExpenseAnomaly(snapshot, makePack());
  assert.ok(obs);
  assert.equal(obs.severity, "warning");
  assert.equal(obs.id, "obs_expense-anomaly_6110");
  // history mean = (900 + 1100 + 1000 + 1000) / 4 = 1000; σ ≈ 70.7; z ≈ 14.
  assert.deepEqual(obs.params, {
    account: "6110",
    accountName: "Konto 6110",
    amount: 2_000,
    typicalAmount: 1_000,
    month: "2026-07",
  });
  assert.deepEqual(obs.provenance, [{ kind: "account", target: "6110" }]);
  assert.equal(obs.action?.href, "/books?view=general-ledger&period=2026-07");
});

test("expense-anomaly: below-threshold months, thin history, zero variance, and non-cost classes stay silent", () => {
  const history = (account: string, amounts: number[], current: number) => [
    ...amounts.map((debit, index) => journalLine({ accountNumber: account, bookedAt: `2026-0${index + 3}-05`, debit })),
    journalLine({ accountNumber: account, bookedAt: "2026-07-05", debit: current }),
  ];

  // z ≈ 1.41 < 2 → silent.
  const mild = makeSnapshot({
    reports: { journal: history("6110", [900, 1_100, 1_000, 1_000], 1_100), balances: [], vat: [] },
  });
  assert.deepEqual(detectExpenseAnomaly(mild, makePack()), []);

  // Only 3 history months → silent.
  const thin = makeSnapshot({
    reports: { journal: history("6110", [900, 1_100, 1_000], 5_000), balances: [], vat: [] },
  });
  assert.deepEqual(detectExpenseAnomaly(thin, makePack()), []);

  // σ = 0 → silent (guarded, no division by zero).
  const flat = makeSnapshot({
    reports: { journal: history("6110", [1_000, 1_000, 1_000, 1_000], 5_000), balances: [], vat: [] },
  });
  assert.deepEqual(detectExpenseAnomaly(flat, makePack()), []);

  // Asset account (1930) is outside cost classes 4–7 → silent.
  const asset = makeSnapshot({
    reports: { journal: history("1930", [900, 1_100, 1_000, 1_000], 9_000), balances: [], vat: [] },
  });
  assert.deepEqual(detectExpenseAnomaly(asset, makePack()), []);
});

// --- vat-set-aside ----------------------------------------------------------

test("vat-set-aside: positive box 49 is money to reserve; refunds stay silent", () => {
  const positive = makePack({ vatReturn: [{ box: "49", label: "Moms att betala eller få tillbaka", amount: 5_000 }] });
  const [obs] = detectVatSetAside(positive);
  assert.ok(obs);
  assert.equal(obs.severity, "info");
  assert.deepEqual(obs.params, { amount: 5_000, periodLabel: "2026-07" });
  assert.equal(obs.action?.href, "/reports#vat-preparation");

  const refund = makePack({ vatReturn: [{ box: "49", label: "Moms att betala eller få tillbaka", amount: -250 }] });
  assert.deepEqual(detectVatSetAside(refund), []);
  assert.deepEqual(detectVatSetAside(makePack()), []);
});

// --- deadline-proximity -----------------------------------------------------

test("deadline-proximity: within 14 days warns with the day distance; outside stays silent", () => {
  const deadlines = [
    deadline("tax_vat_2026-Q2", "2026-07-14"), // 10 days out
    deadline("tax_vat_2026-Q3", "2026-11-12"), // far future
    deadline("tax_vat_2026-Q1", "2026-05-12"), // past
  ];
  const observations = detectDeadlineProximity(deadlines, TODAY);
  assert.equal(observations.length, 1);
  const [obs] = observations;
  assert.ok(obs);
  assert.equal(obs.severity, "warning");
  assert.deepEqual(obs.params, { kind: "vat-return", dueDate: "2026-07-14", daysUntil: 10 });
  assert.deepEqual(obs.provenance, [{ kind: "deadline", target: "tax_vat_2026-Q2" }]);

  // Due today counts (0 days) — the boundary day 14 counts too.
  assert.equal(detectDeadlineProximity([deadline("tax_a", TODAY)], TODAY).length, 1);
  assert.equal(detectDeadlineProximity([deadline("tax_b", "2026-07-18")], TODAY)[0]?.params.daysUntil, 14);
  assert.equal(detectDeadlineProximity([deadline("tax_c", "2026-07-19")], TODAY).length, 0);
});

// --- missing-evidence -------------------------------------------------------

test("missing-evidence: vouchers without packet evidence aggregate into one warning, ≤3 drill targets", () => {
  const vouchers = [
    makeVoucher({ id: "v_ok", packetId: "p_ok" }),
    makeVoucher({ id: "v_gone", packetId: "p_gone" }), // packet missing entirely
    makeVoucher({ id: "v_empty", packetId: "p_empty" }), // packet with no evidence
    makeVoucher({ id: "v_gone2", packetId: "p_gone2" }),
    makeVoucher({ id: "v_gone3", packetId: "p_gone3" }),
  ];
  const snapshot = makeSnapshot({
    vouchers,
    packets: [packet("p_ok", ["evidence_1"]), packet("p_empty", [])],
  });
  const observations = detectMissingEvidence(snapshot);
  assert.equal(observations.length, 1);
  const [obs] = observations;
  assert.ok(obs);
  assert.equal(obs.severity, "warning");
  assert.deepEqual(obs.params, { count: 4 });
  assert.equal(obs.provenance.length, 3);
  assert.deepEqual(obs.provenance[0], { kind: "voucher", target: "v_gone" });
  assert.equal(obs.action?.href, "/capture");
});

test("missing-evidence: fully evidenced workspaces stay silent", () => {
  const snapshot = makeSnapshot({
    vouchers: [makeVoucher({ id: "v_ok", packetId: "p_ok" })],
    packets: [packet("p_ok", ["evidence_1"])],
  });
  assert.deepEqual(detectMissingEvidence(snapshot), []);
});

// --- supplier-spike ---------------------------------------------------------

function spikeSnapshot(currentGross: number, trailingGross: number[]): WorkspaceSnapshot {
  const vouchers: Voucher[] = trailingGross.map((gross, index) =>
    makeVoucher({
      id: `v_t${index}`,
      packetId: `p_t${index}`,
      supplier: "Acme AB",
      gross,
      month: `2026-0${4 + index}`, // Apr, May, Jun
    }),
  );
  vouchers.push(
    makeVoucher({ id: "v_now", packetId: "p_now", supplier: "Acme AB", gross: currentGross, month: "2026-07" }),
  );
  return makeSnapshot({
    vouchers,
    packets: vouchers.map((voucher) => packet(voucher.evidencePacketId, ["evidence_x"])),
  });
}

test("supplier-spike: current month ≥2× trailing average and ≥500 warns with reconciled params", () => {
  const snapshot = spikeSnapshot(900, [300, 300, 300]);
  const [obs] = detectSupplierSpike(snapshot, makePack());
  assert.ok(obs);
  assert.equal(obs.id, "obs_supplier-spike_acme-ab");
  assert.equal(obs.severity, "warning");
  assert.deepEqual(obs.params, { supplier: "Acme AB", amount: 900, typicalAmount: 300 });
  assert.deepEqual(obs.provenance, [{ kind: "voucher", target: "v_now" }]);
  assert.equal(obs.action?.href, "/books?view=suppliers");
});

test("supplier-spike: below the factor, below 500, or without trailing history stays silent", () => {
  // 500 ≥ min amount but < 2 × 300-average → silent.
  assert.deepEqual(detectSupplierSpike(spikeSnapshot(500, [300, 300, 300]), makePack()), []);
  // 400 < 500 minimum even though it doubles the 100-average → silent.
  assert.deepEqual(detectSupplierSpike(spikeSnapshot(400, [100, 100, 100]), makePack()), []);
  // No trailing history → no "typical" to spike against (new supplier) → silent.
  assert.deepEqual(detectSupplierSpike(spikeSnapshot(10_000, []), makePack()), []);
});

// --- composite --------------------------------------------------------------

function compositeFixture() {
  const pack = makePack({
    monthly: [
      point("2026-05", 0, 10_000, 30_000),
      point("2026-06", 0, 10_000, 20_000),
      point("2026-07", 0, 10_000, 10_000),
    ],
    vatReturn: [{ box: "49", label: "Moms att betala eller få tillbaka", amount: 5_000 }],
  });
  const snapshot = spikeSnapshot(900, [300, 300, 300]);
  snapshot.vouchers.push(makeVoucher({ id: "v_gone", packetId: "p_gone" }));
  const deadlines = [deadline("tax_vat_2026-Q2", "2026-07-14"), deadline("tax_fskatt_2026-07", "2026-07-13")];
  return { pack, snapshot, deadlines, today: TODAY };
}

test("buildObservations ranks severity → detector priority → id and bounds to the limit", () => {
  const observations = buildObservations(compositeFixture(), { limit: 10 });
  assert.deepEqual(
    observations.map((obs) => obs.id),
    [
      "obs_cash-runway", // critical
      "obs_deadline-proximity_tax_fskatt_2026-07", // warnings: detector priority, then id
      "obs_deadline-proximity_tax_vat_2026-Q2",
      "obs_missing-evidence",
      "obs_supplier-spike_acme-ab",
      "obs_vat-set-aside", // info last
    ],
  );
  for (const obs of observations) {
    assert.equal(observationSchema.safeParse(obs).success, true);
  }

  const bounded = buildObservations(compositeFixture());
  assert.equal(OBSERVATION_LIMIT, 5);
  assert.equal(bounded.length, 5);
  // The info observation is what the bound drops.
  assert.ok(!bounded.some((obs) => obs.id === "obs_vat-set-aside"));
});

test("buildObservations is deterministic for identical inputs", () => {
  assert.deepEqual(buildObservations(compositeFixture()), buildObservations(compositeFixture()));
});
