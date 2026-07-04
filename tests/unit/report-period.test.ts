import assert from "node:assert/strict";
import { test } from "node:test";

import type { LedgerLine } from "@jpx-accounting/domain";
import {
  currentMonthToken,
  filterLedgerLines,
  InvalidPeriodTokenError,
  resolvePeriodToken,
} from "@jpx-accounting/domain";

const FY_JAN = { fiscalYearStart: "01-01" };
const FY_JUL = { fiscalYearStart: "07-01" };
const FY_MID_MAY = { fiscalYearStart: "05-15" };

const line = (bookedAt: string): LedgerLine => ({
  voucherId: "v1",
  accountNumber: "6540",
  accountName: "IT-tjänster",
  description: "Test line",
  debit: 100,
  credit: 0,
  vatCode: "VAT25",
  bookedAt,
  deductible: true,
});

test("month token resolves to the calendar month with the preceding month as previous", () => {
  assert.deepEqual(resolvePeriodToken("2026-05", FY_JAN), {
    token: "2026-05",
    kind: "month",
    from: "2026-05-01",
    to: "2026-05-31",
    previous: { from: "2026-04-01", to: "2026-04-30" },
  });
});

test("regression pin: 2026-07 starts on 2026-07-01 (kills the UTC month-edge bug)", () => {
  // The old Books parsePeriod did `new Date(y, m-1, 1).toISOString().slice(0,10)`,
  // which in any UTC+ timezone made 2026-07 span 2026-06-30…2026-07-30.
  const period = resolvePeriodToken("2026-07", FY_JAN);
  assert.equal(period.from, "2026-07-01");
  assert.equal(period.to, "2026-07-31");
});

test("month token handles leap and non-leap February", () => {
  assert.equal(resolvePeriodToken("2024-02", FY_JAN).to, "2024-02-29");
  assert.equal(resolvePeriodToken("2026-02", FY_JAN).to, "2026-02-28");
  // Previous window of March in a leap year covers Feb 29.
  assert.deepEqual(resolvePeriodToken("2024-03", FY_JAN).previous, { from: "2024-02-01", to: "2024-02-29" });
});

test("month token previous window crosses the year boundary", () => {
  assert.deepEqual(resolvePeriodToken("2026-01", FY_JAN).previous, { from: "2025-12-01", to: "2025-12-31" });
});

test("fiscal quarters for a 01-01 fiscal year match calendar quarters", () => {
  assert.deepEqual(resolvePeriodToken("2026-Q1", FY_JAN), {
    token: "2026-Q1",
    kind: "quarter",
    from: "2026-01-01",
    to: "2026-03-31",
    previous: { from: "2025-10-01", to: "2025-12-31" },
  });
  assert.equal(resolvePeriodToken("2026-Q2", FY_JAN).from, "2026-04-01");
  assert.equal(resolvePeriodToken("2026-Q2", FY_JAN).to, "2026-06-30");
  assert.equal(resolvePeriodToken("2026-Q4", FY_JAN).to, "2026-12-31");
});

test("fiscal quarters for a 07-01 fiscal year start in July and wrap the calendar year", () => {
  assert.deepEqual(resolvePeriodToken("2026-Q1", FY_JUL), {
    token: "2026-Q1",
    kind: "quarter",
    from: "2026-07-01",
    to: "2026-09-30",
    previous: { from: "2026-04-01", to: "2026-06-30" },
  });
  const q3 = resolvePeriodToken("2026-Q3", FY_JUL);
  assert.equal(q3.from, "2027-01-01");
  assert.equal(q3.to, "2027-03-31");
  const q4 = resolvePeriodToken("2026-Q4", FY_JUL);
  assert.equal(q4.from, "2027-04-01");
  assert.equal(q4.to, "2027-06-30");
});

test("fiscal quarters for a mid-month 05-15 fiscal year anchor on the start day", () => {
  assert.deepEqual(resolvePeriodToken("2026-Q1", FY_MID_MAY), {
    token: "2026-Q1",
    kind: "quarter",
    from: "2026-05-15",
    to: "2026-08-14",
    // Q4 of the fiscal year starting 2025.
    previous: { from: "2026-02-15", to: "2026-05-14" },
  });
  const q2 = resolvePeriodToken("2026-Q2", FY_MID_MAY);
  assert.equal(q2.from, "2026-08-15");
  assert.equal(q2.to, "2026-11-14");
  const q4 = resolvePeriodToken("2026-Q4", FY_MID_MAY);
  assert.equal(q4.from, "2027-02-15");
  assert.equal(q4.to, "2027-05-14");
});

test("fy token resolves the fiscal year window with the preceding year as previous", () => {
  assert.deepEqual(resolvePeriodToken("fy-2026", FY_JAN), {
    token: "fy-2026",
    kind: "fiscal-year",
    from: "2026-01-01",
    to: "2026-12-31",
    previous: { from: "2025-01-01", to: "2025-12-31" },
  });
  const midMay = resolvePeriodToken("fy-2026", FY_MID_MAY);
  assert.equal(midMay.from, "2026-05-15");
  assert.equal(midMay.to, "2027-05-14");
});

test("ytd resolves from the current fiscal year start to the injected today", () => {
  assert.deepEqual(resolvePeriodToken("ytd", { ...FY_JAN, today: "2026-07-04" }), {
    token: "ytd",
    kind: "ytd",
    from: "2026-01-01",
    to: "2026-07-04",
    previous: { from: "2025-01-01", to: "2025-07-04" },
  });
});

test("ytd with a July fiscal year picks the fiscal year containing today", () => {
  // Today is before 07-01, so the current fiscal year started the year before.
  assert.deepEqual(resolvePeriodToken("ytd", { ...FY_JUL, today: "2026-05-15" }), {
    token: "ytd",
    kind: "ytd",
    from: "2025-07-01",
    to: "2026-05-15",
    previous: { from: "2024-07-01", to: "2025-05-15" },
  });
  // On the fiscal year start day itself the new fiscal year has begun.
  assert.equal(resolvePeriodToken("ytd", { ...FY_JUL, today: "2026-07-01" }).from, "2026-07-01");
});

test("all resolves to the sentinel window with no previous", () => {
  assert.deepEqual(resolvePeriodToken("all", FY_JAN), {
    token: "all",
    kind: "all",
    from: "1900-01-01",
    to: "2999-12-31",
  });
});

test("unknown tokens throw InvalidPeriodTokenError", () => {
  for (const token of ["", "garbage", "2026-13", "2026-00", "2026-Q5", "2026-Q0", "fy-26", "2026-7", "202607"]) {
    assert.throws(() => resolvePeriodToken(token, FY_JAN), InvalidPeriodTokenError, `token "${token}" must throw`);
  }
});

test("currentMonthToken slices an injected today", () => {
  assert.equal(currentMonthToken("2026-07-04"), "2026-07");
});

test("currentMonthToken defaults to the LOCAL calendar month", () => {
  const now = new Date();
  const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  assert.equal(currentMonthToken(), expected);
});

test("filterLedgerLines is inclusive on both edges", () => {
  const lines = [
    line("2026-06-30T23:59:59.000Z"),
    line("2026-07-01T00:00:00.000Z"),
    line("2026-07-15T12:00:00.000Z"),
    line("2026-07-31T23:59:59.999Z"),
    line("2026-08-01T00:00:00.000Z"),
  ];
  const filtered = filterLedgerLines(lines, { from: "2026-07-01", to: "2026-07-31" });
  assert.deepEqual(
    filtered.map((entry) => entry.bookedAt.slice(0, 10)),
    ["2026-07-01", "2026-07-15", "2026-07-31"],
  );
});

test("filterLedgerLines supports open-ended ranges", () => {
  const lines = [line("2026-06-15T00:00:00.000Z"), line("2026-07-15T00:00:00.000Z")];
  assert.equal(filterLedgerLines(lines, { from: "2026-07-01" }).length, 1);
  assert.equal(filterLedgerLines(lines, { to: "2026-06-30" }).length, 1);
});

test("filterLedgerLines without a range returns the input array unchanged", () => {
  const lines = [line("2026-07-15T00:00:00.000Z")];
  assert.equal(filterLedgerLines(lines), lines);
  assert.equal(filterLedgerLines(lines, {}), lines);
});
