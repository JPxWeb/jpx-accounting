import assert from "node:assert/strict";
import test from "node:test";

import type { TaxDeadline } from "@jpx-accounting/contracts";
import { taxDeadlineSchema } from "@jpx-accounting/contracts";
import { buildTaxTimeline, currentVatPeriodToken, TAX_DEADLINE_SOURCES } from "@jpx-accounting/domain";

const byId = (deadlines: TaxDeadline[], id: string) => deadlines.find((deadline) => deadline.id === id);

test("every deadline validates against the contract and cites a known source", () => {
  const timeline = buildTaxTimeline({
    profile: { vatPeriod: "monthly", fiscalYearStart: "01-01" },
    today: "2026-07-04",
    limit: 20,
  });
  assert.ok(timeline.length > 0);
  for (const deadline of timeline) {
    assert.equal(taxDeadlineSchema.safeParse(deadline).success, true);
    assert.ok(TAX_DEADLINE_SOURCES[deadline.sourceKey], `unknown sourceKey ${deadline.sourceKey}`);
  }
});

test("pinned: quarterly Q2 (fy 01-01) moms lands on 2026-08-17 — August 17th rule", () => {
  const timeline = buildTaxTimeline({
    profile: { vatPeriod: "quarterly", fiscalYearStart: "01-01" },
    today: "2026-07-04",
  });
  const q2 = byId(timeline, "tax_vat_2026-Q2");
  assert.ok(q2, "expected the Q2 VAT deadline in the horizon");
  assert.equal(q2.kind, "vat-return");
  assert.equal(q2.dueDate, "2026-08-17");
  assert.equal(q2.periodToken, "2026-Q2");
  assert.equal(q2.amountRef, "box49");
  assert.equal(q2.sourceKey, "sv-vat-12");
});

test("pinned: monthly May moms shifts from Sunday the 12th to Monday 2026-07-13", () => {
  const timeline = buildTaxTimeline({
    profile: { vatPeriod: "monthly", fiscalYearStart: "01-01" },
    today: "2026-07-04",
  });
  const may = byId(timeline, "tax_vat_2026-05");
  assert.ok(may, "expected the May VAT deadline in the horizon");
  assert.equal(may.dueDate, "2026-07-13");
  assert.equal(may.periodLabel, "2026-05");
  assert.equal(may.periodToken, "2026-05");
  assert.equal(may.amountRef, "box49");
});

test("pinned: yearly moms for the FY ending December 2026 is due 2027-02-26", () => {
  const timeline = buildTaxTimeline({
    profile: { vatPeriod: "yearly", fiscalYearStart: "01-01" },
    today: "2027-01-15",
  });
  const yearly = byId(timeline, "tax_vat_fy-2026");
  assert.ok(yearly, "expected the yearly VAT deadline in the horizon");
  assert.equal(yearly.dueDate, "2027-02-26");
  assert.equal(yearly.periodToken, "fy-2026");
  assert.equal(yearly.sourceKey, "sv-vat-yearly-26");
});

test("yearly moms December rule: FY ending October → 27th, then weekend-shifted", () => {
  // fy-2025 with start 11-01 ends 2026-10-31; second month after is December
  // → the 27th, which is a Sunday in 2026 → Monday 2026-12-28.
  const timeline = buildTaxTimeline({
    profile: { vatPeriod: "yearly", fiscalYearStart: "11-01" },
    today: "2026-11-15",
  });
  const yearly = byId(timeline, "tax_vat_fy-2025");
  assert.ok(yearly, "expected the yearly VAT deadline in the horizon");
  assert.equal(yearly.dueDate, "2026-12-28");
});

test("pinned: årsredovisning for the FY ending 2026-06-30 is due 2027-01-31 (no weekend shift)", () => {
  const timeline = buildTaxTimeline({
    profile: { vatPeriod: "quarterly", fiscalYearStart: "07-01" },
    today: "2026-12-01",
  });
  const annual = byId(timeline, "tax_arsredovisning_fy-2025");
  assert.ok(annual, "expected the annual-report deadline in the horizon");
  assert.equal(annual.kind, "annual-report");
  // 2027-01-31 is a Sunday: the statutory month-end date is rendered as-is.
  assert.equal(annual.dueDate, "2027-01-31");
  assert.equal(annual.amountRef, null);
  assert.equal(annual.sourceKey, "sv-arsredovisning-7m");
});

test("årsredovisning for a calendar FY lands on the following July 31st", () => {
  const timeline = buildTaxTimeline({
    profile: { vatPeriod: "yearly", fiscalYearStart: "01-01" },
    today: "2027-05-01",
  });
  const annual = byId(timeline, "tax_arsredovisning_fy-2026");
  assert.ok(annual, "expected the annual-report deadline in the horizon");
  assert.equal(annual.dueDate, "2027-07-31");
});

test("employer declaration and F-skatt fall on the 12th, with the January 17th rule composing with the weekend shift", () => {
  const timeline = buildTaxTimeline({
    profile: { vatPeriod: "quarterly", fiscalYearStart: "01-01" },
    today: "2025-12-20",
    limit: 12,
  });
  // 2026-01-17 (January rule) is a Saturday → Monday 2026-01-19.
  const employer = byId(timeline, "tax_employer_2025-12");
  assert.ok(employer, "expected the December employer declaration");
  assert.equal(employer.kind, "employer-declaration");
  assert.equal(employer.dueDate, "2026-01-19");
  assert.equal(employer.amountRef, null);

  const fskatt = byId(timeline, "tax_fskatt_2026-01");
  assert.ok(fskatt, "expected the January F-skatt payment");
  assert.equal(fskatt.dueDate, "2026-01-19");
  assert.equal(fskatt.amountRef, null);
});

test("horizon and limit bound the timeline; order is dueDate then id", () => {
  const timeline = buildTaxTimeline({
    profile: { vatPeriod: "monthly", fiscalYearStart: "01-01" },
    today: "2026-07-04",
  });
  assert.ok(timeline.length <= 8);
  const horizonEnd = "2026-11-01"; // 2026-07-04 + 120 days
  for (const deadline of timeline) {
    assert.ok(deadline.dueDate >= "2026-07-04");
    assert.ok(deadline.dueDate <= horizonEnd);
  }
  const sortKeys = timeline.map((deadline) => `${deadline.dueDate}|${deadline.id}`);
  assert.deepEqual(sortKeys, [...sortKeys].sort());

  const tight = buildTaxTimeline({
    profile: { vatPeriod: "monthly", fiscalYearStart: "01-01" },
    today: "2026-07-04",
    horizonDays: 10,
  });
  // Only the three 12th/13th deadlines of July fit a 10-day horizon.
  assert.deepEqual(
    tight.map((deadline) => deadline.id),
    ["tax_employer_2026-06", "tax_fskatt_2026-07", "tax_vat_2026-05"],
  );

  const limited = buildTaxTimeline({
    profile: { vatPeriod: "monthly", fiscalYearStart: "01-01" },
    today: "2026-07-04",
    limit: 2,
  });
  assert.equal(limited.length, 2);
});

test("timeline is deterministic for identical inputs", () => {
  const build = () =>
    buildTaxTimeline({ profile: { vatPeriod: "quarterly", fiscalYearStart: "07-01" }, today: "2026-07-04" });
  assert.deepEqual(build(), build());
});

test("fiscal start 07-01: quarterly deadlines are CALENDAR quarters, joined via the matching fiscal token", () => {
  // Statutory kalenderkvartal Apr–Jun 2026 → due 2026-08-17 (August 17th
  // rule). The id/label name the CALENDAR quarter; the periodToken is the
  // fiscal-grammar token that resolves to the same window (fy-2025 Q4 with
  // start 07-01 spans exactly Apr–Jun 2026), keeping the box-49 join alive.
  const timeline = buildTaxTimeline({
    profile: { vatPeriod: "quarterly", fiscalYearStart: "07-01" },
    today: "2026-07-04",
  });
  const q2 = byId(timeline, "tax_vat_2026-Q2");
  assert.ok(q2, "expected calendar Q2 2026 in the horizon");
  assert.equal(q2.dueDate, "2026-08-17");
  assert.equal(q2.periodLabel, "2026-Q2");
  assert.equal(q2.periodToken, "2025-Q4");
  assert.equal(q2.amountRef, "box49");
  // The old fiscal-quarter schedule (fy quarters ending Jul/Oct/Jan) must be gone.
  assert.equal(byId(timeline, "tax_vat_2025-Q4"), undefined);
  assert.equal(byId(timeline, "tax_vat_2026-Q1"), undefined);
});

test("broken fiscal year (05-01): quarterly VAT deadlines stay on calendar quarters, date-only", () => {
  // A May fiscal year is not calendar-quarter-aligned: the statutory windows
  // (kalenderkvartal) have no unified-grammar token, so the rows are honest
  // date-only entries — no periodToken, amountRef null — but the DATES follow
  // the statutory calendar-quarter schedule, not the fiscal quarters.
  const timeline = buildTaxTimeline({
    profile: { vatPeriod: "quarterly", fiscalYearStart: "05-01" },
    today: "2026-07-04",
    horizonDays: 240,
    limit: 20,
  });
  const vatDeadlines = timeline.filter((deadline) => deadline.kind === "vat-return");
  assert.deepEqual(
    vatDeadlines.map((deadline) => [deadline.id, deadline.dueDate]),
    [
      ["tax_vat_2026-Q2", "2026-08-17"], // Apr–Jun → Aug 17th rule (Monday)
      ["tax_vat_2026-Q3", "2026-11-12"], // Jul–Sep → Nov 12th
      ["tax_vat_2026-Q4", "2027-02-12"], // Oct–Dec → Feb 12th
    ],
  );
  for (const deadline of vatDeadlines) {
    assert.equal(taxDeadlineSchema.safeParse(deadline).success, true);
    assert.equal(deadline.periodToken, undefined, `${deadline.id} must not claim a fiscal-window token`);
    assert.equal(deadline.amountRef, null, `${deadline.id} must render date-only`);
  }
});

test("currentVatPeriodToken resolves the containing period for all cadences", () => {
  assert.equal(currentVatPeriodToken("monthly", "01-01", "2026-07-04"), "2026-07");
  assert.equal(currentVatPeriodToken("quarterly", "01-01", "2026-07-04"), "2026-Q3");
  assert.equal(currentVatPeriodToken("quarterly", "07-01", "2026-07-04"), "2026-Q1");
  assert.equal(currentVatPeriodToken("quarterly", "07-01", "2026-06-30"), "2025-Q4");
  assert.equal(currentVatPeriodToken("yearly", "01-01", "2026-07-04"), "fy-2026");
  assert.equal(currentVatPeriodToken("yearly", "07-01", "2026-06-30"), "fy-2025");
});

test("currentVatPeriodToken quarterly is the CALENDAR quarter; broken fiscal years fall back to the month", () => {
  // Calendar-quarter-aligned fiscal years resolve the calendar quarter through
  // the fiscal grammar: Apr–Jun 2026 is fy-2026 Q1 for an April start, and
  // Jan–Mar 2026 is fy-2025 Q2 for an October start.
  assert.equal(currentVatPeriodToken("quarterly", "04-01", "2026-05-15"), "2026-Q1");
  assert.equal(currentVatPeriodToken("quarterly", "10-01", "2026-01-15"), "2025-Q2");
  // A May fiscal year has no token for the statutory calendar quarter — fall
  // back to the resolvable current-month token (honest subset window).
  assert.equal(currentVatPeriodToken("quarterly", "05-01", "2026-05-15"), "2026-05");
});
