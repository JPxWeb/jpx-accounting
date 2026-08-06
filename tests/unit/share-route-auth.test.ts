import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { decideShareFileIntake } from "../../apps/web/lib/share-intake-policy.ts";

/**
 * P0-4 / Wave Share′ S-fail: normal-mode share intake must refuse forwarding
 * and surface `authRequired=1` instead of the generic retry banner.
 * The Next route pulls in `server-only`, so the decision is unit-tested via the
 * pure helper and the route is source-pinned to consume it (same pattern as
 * the api-proxy Authorization allowlist test).
 */

test("decideShareFileIntake refuses file shares in normal mode", () => {
  assert.deepEqual(
    decideShareFileIntake({
      fileCount: 2,
      runtimeMode: "normal",
      apiBaseUrl: "http://api.test.local:3999",
    }),
    { kind: "refuse-auth", pending: 2 },
  );
});

test("decideShareFileIntake forwards in demo when an API base URL exists", () => {
  assert.deepEqual(
    decideShareFileIntake({
      fileCount: 1,
      runtimeMode: "demo",
      apiBaseUrl: "http://localhost:3001",
    }),
    { kind: "forward" },
  );
});

test("decideShareFileIntake uses legacy pending when demo has no API", () => {
  assert.deepEqual(
    decideShareFileIntake({
      fileCount: 3,
      runtimeMode: "demo",
      apiBaseUrl: undefined,
    }),
    { kind: "pending-unreachable", pending: 3 },
  );
});

test("share route wires S-fail policy + authRequired redirect params", () => {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  const routeSource = readFileSync(path.join(repoRoot, "apps", "web", "app", "share", "route.ts"), "utf8");
  assert.match(routeSource, /decideShareFileIntake/);
  assert.match(routeSource, /refuse-auth/);
  assert.match(routeSource, /params\.set\("authRequired", "1"\)/);
  const captureSource = readFileSync(
    path.join(repoRoot, "apps", "web", "components", "screens", "capture-screen.tsx"),
    "utf8",
  );
  assert.match(captureSource, /authRequiredBanner/);
  assert.match(captureSource, /data-auth-required/);
});
