import assert from "node:assert/strict";
import { test } from "node:test";

import { today } from "@jpx-accounting/domain";

test("today returns an ISO yyyy-mm-dd date", () => {
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
});
