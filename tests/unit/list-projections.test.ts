import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { buildListProjection } from "@jpx-accounting/domain";

test("Wave 5 list projection framework returns no rows for unregistered kinds", () => {
  assert.deepEqual(buildListProjection("unknown", []), []);
});

test("Wave 5 exposes no user-facing list routes", () => {
  const appSource = readFileSync("services/api/src/app.ts", "utf8");

  assert.equal(/\/api\/lists\//.test(appSource), false);
});
