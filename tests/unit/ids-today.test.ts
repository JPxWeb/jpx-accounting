import assert from "node:assert/strict";
import { test } from "node:test";

import { thisMonth, today } from "@jpx-accounting/domain";

test("today returns an ISO yyyy-mm-dd date", () => {
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
});

test("thisMonth returns yyyy-mm", () => {
  assert.match(thisMonth(), /^\d{4}-\d{2}$/);
});
