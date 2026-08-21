import assert from "node:assert/strict";
import test from "node:test";

import {
  attachCandidateDate,
  attachCandidateLabel,
  selectAttachCandidates,
  type AttachCandidate,
} from "../../apps/web/lib/evidence-attach";

function candidate(overrides: Partial<AttachCandidate> & { id: string }): AttachCandidate {
  return {
    voucherNumber: "V-1001",
    status: "posted",
    createdAt: "2026-08-01T09:00:00.000Z",
    voucherFields: { currency: "SEK" },
    ...overrides,
  };
}

test("attachCandidateDate prefers the business event over the row's creation time", () => {
  // Same order as `deriveBookedAt`: a voucher is dated by what happened.
  assert.equal(
    attachCandidateDate(
      candidate({
        id: "v1",
        voucherFields: { currency: "SEK", transactionDate: "2026-07-04", receiptDate: "2026-07-01" },
      }),
    ),
    "2026-07-04",
  );
  assert.equal(
    attachCandidateDate(candidate({ id: "v2", voucherFields: { currency: "SEK", receiptDate: "2026-07-01" } })),
    "2026-07-01",
  );
  assert.equal(attachCandidateDate(candidate({ id: "v3" })), "2026-08-01T09:00:00.000Z");
});

test("attachCandidateLabel falls back description → supplier → empty", () => {
  assert.equal(
    attachCandidateLabel(
      candidate({ id: "v1", voucherFields: { currency: "SEK", description: "Taxi", supplierName: "Uber" } }),
    ),
    "Taxi",
  );
  assert.equal(
    attachCandidateLabel(candidate({ id: "v2", voucherFields: { currency: "SEK", supplierName: "Uber" } })),
    "Uber",
  );
  assert.equal(attachCandidateLabel(candidate({ id: "v3" })), "");
});

test("selectAttachCandidates excludes the evidence's current voucher and rejected dead ends", () => {
  const result = selectAttachCandidates(
    [candidate({ id: "own" }), candidate({ id: "rejected", status: "rejected" }), candidate({ id: "keep" })],
    { excludeVoucherId: "own", query: "", limit: 20 },
  );
  assert.deepEqual(
    result.map((v) => v.id),
    ["keep"],
  );
});

test("selectAttachCandidates matches number, date, description and supplier, case-insensitively", () => {
  const vouchers = [
    candidate({ id: "byNumber", voucherNumber: "A 42" }),
    candidate({ id: "byDate", voucherFields: { currency: "SEK", transactionDate: "2026-03-17" } }),
    candidate({
      id: "byDescription",
      voucherFields: { currency: "SEK", description: "Second receipt for attach test" },
    }),
    candidate({ id: "bySupplier", voucherFields: { currency: "SEK", supplierName: "Skånemejerier" } }),
  ];
  const ids = (query: string) =>
    selectAttachCandidates(vouchers, { excludeVoucherId: undefined, query, limit: 20 }).map((v) => v.id);

  assert.deepEqual(ids("a 4"), ["byNumber"]);
  assert.deepEqual(ids("2026-03"), ["byDate"]);
  assert.deepEqual(ids("second receipt"), ["byDescription"]);
  assert.deepEqual(ids("SKÅNE"), ["bySupplier"]);
  // A blank query is "show everything", not "match nothing".
  assert.equal(ids("   ").length, 4);
});

test("selectAttachCandidates sorts newest business date first, then caps", () => {
  const vouchers = [
    candidate({ id: "old", voucherFields: { currency: "SEK", transactionDate: "2026-01-05" } }),
    candidate({ id: "new", voucherFields: { currency: "SEK", transactionDate: "2026-08-05" } }),
    candidate({ id: "middle", voucherFields: { currency: "SEK", transactionDate: "2026-04-05" } }),
  ];
  const frozen = [...vouchers];

  assert.deepEqual(
    selectAttachCandidates(vouchers, { excludeVoucherId: undefined, query: "", limit: 20 }).map((v) => v.id),
    ["new", "middle", "old"],
  );
  assert.deepEqual(
    selectAttachCandidates(vouchers, { excludeVoucherId: undefined, query: "", limit: 2 }).map((v) => v.id),
    ["new", "middle"],
  );
  // Rule 17: the snapshot array the cache owns must not be reordered in place.
  assert.deepEqual(vouchers, frozen);
});
