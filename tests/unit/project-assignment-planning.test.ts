import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bindProjectAssignmentToPrimaryCostLine,
  ProjectAssignmentLineNotFoundError,
  type LedgerLine,
} from "@jpx-accounting/domain";

const lines: LedgerLine[] = [
  {
    voucherId: "v1",
    lineId: "ln_vat",
    accountNumber: "2641",
    accountName: "VAT",
    description: "VAT",
    debit: 25,
    credit: 0,
    vatCode: "VAT25",
    bookedAt: "2026-08-09",
    deductible: true,
  },
  {
    voucherId: "v1",
    lineId: "ln_cost",
    accountNumber: "6540",
    accountName: "IT",
    description: "Cost",
    debit: 100,
    credit: 0,
    vatCode: "VAT25",
    bookedAt: "2026-08-09",
    deductible: true,
  },
  {
    voucherId: "v1",
    lineId: "ln_bank",
    accountNumber: "1930",
    accountName: "Bank",
    description: "Settlement",
    debit: 0,
    credit: 125,
    vatCode: "NA",
    bookedAt: "2026-08-09",
    deductible: false,
  },
];

test("project intent binds to first non-VAT non-settlement cost line", () => {
  assert.deepEqual(
    bindProjectAssignmentToPrimaryCostLine(
      { kind: "project_assignment", projectId: "proj_1", objectCode: "OBJ-10" },
      lines,
    ),
    {
      kind: "line_enrichment_record",
      lineId: "ln_cost",
      enrichmentType: "project",
      payload: { projectId: "proj_1", objectCode: "OBJ-10" },
    },
  );
});

test("project intent fails before append when no eligible line exists", () => {
  assert.equal(typeof ProjectAssignmentLineNotFoundError, "function");
  assert.throws(
    () =>
      bindProjectAssignmentToPrimaryCostLine({ kind: "project_assignment", projectId: "proj_1" }, [
        lines[0]!,
        lines[2]!,
      ]),
    ProjectAssignmentLineNotFoundError,
  );
});
