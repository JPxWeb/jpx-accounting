import assert from "node:assert/strict";
import test from "node:test";

import { joinInFlight, runWithConcurrencyLimit } from "../../apps/web/lib/promotion";

/**
 * WS-D R19 client seam: the in-flight promotion registry. `joinInFlight` is pure
 * over the passed Map, so the drafts-table retry / double-click race semantics
 * are provable without touching the network pipeline.
 */

/** A manually-settled task so the test controls exactly when a run is "in flight". */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("joinInFlight runs the task once and hands every concurrent caller the same result", async () => {
  const registry = new Map<string, Promise<string>>();
  const gate = deferred<string>();
  let runs = 0;

  const task = () => {
    runs += 1;
    return gate.promise;
  };

  const first = joinInFlight(registry, "draft_1", task);
  const second = joinInFlight(registry, "draft_1", task); // double-click / retry while in flight
  assert.equal(second, first, "joiners receive the in-flight promise itself");
  assert.equal(registry.size, 1);
  await Promise.resolve(); // one tick: the task starts on the microtask queue
  assert.equal(runs, 1, "the second call must join, not start a parallel pipeline");

  gate.resolve("evidence_1");
  assert.equal(await first, "evidence_1");
  assert.equal(await second, "evidence_1");
  assert.equal(registry.size, 0, "registry must clear on settle");
});

test("joinInFlight clears on rejection so a retry starts a fresh run", async () => {
  const registry = new Map<string, Promise<string>>();
  const gate = deferred<string>();
  let runs = 0;

  const failing = joinInFlight(registry, "draft_1", () => {
    runs += 1;
    return gate.promise;
  });
  const joined = joinInFlight(registry, "draft_1", () => {
    runs += 1;
    return gate.promise;
  });

  gate.reject(new Error("API down"));
  await assert.rejects(failing, /API down/);
  await assert.rejects(joined, /API down/, "joiners share the failure of the run they joined");
  assert.equal(runs, 1);
  assert.equal(registry.size, 0, "a settled (failed) run must leave the registry");

  // The drafts-table retry path: a post-failure call is a brand-new run.
  const retried = await joinInFlight(registry, "draft_1", () => {
    runs += 1;
    return Promise.resolve("evidence_after_retry");
  });
  assert.equal(retried, "evidence_after_retry");
  assert.equal(runs, 2);
  assert.equal(registry.size, 0);
});

test("joinInFlight keeps different keys independent and routes sync throws into the promise", async () => {
  const registry = new Map<string, Promise<string>>();
  const gateA = deferred<string>();

  const runA = joinInFlight(registry, "draft_a", () => gateA.promise);
  const runB = joinInFlight(registry, "draft_b", () => Promise.resolve("b"));
  assert.notEqual(runA, runB, "distinct drafts promote independently");
  assert.equal(await runB, "b");

  // A synchronously-throwing task must reject (not throw) and still clear its entry.
  await assert.rejects(
    joinInFlight(registry, "draft_c", () => {
      throw new Error("sync boom");
    }),
    /sync boom/,
  );
  assert.equal(registry.has("draft_c"), false);

  gateA.resolve("a");
  assert.equal(await runA, "a");
  assert.equal(registry.size, 0);
});

/**
 * Readiness G9 (bulk capture): the promotion pool. Pure over its inputs like
 * `joinInFlight`, so the "never more than N pipelines in flight" property that
 * keeps a ~70-receipt drop under the API's 60/min mutation budget is provable
 * without touching the network.
 */

test("runWithConcurrencyLimit never runs more than `limit` workers at once, and runs every item", async () => {
  const items = Array.from({ length: 10 }, (_, index) => index);
  let inFlight = 0;
  let maxInFlight = 0;
  const completed: number[] = [];

  await runWithConcurrencyLimit(items, 4, async (item) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 0));
    inFlight -= 1;
    completed.push(item);
  });

  assert.ok(maxInFlight <= 4, `expected at most 4 concurrent workers, saw ${maxInFlight}`);
  assert.equal(completed.length, 10);
  assert.deepEqual(
    [...completed].sort((a, b) => a - b),
    items,
  );
});

test("runWithConcurrencyLimit with a limit >= items.length behaves like Promise.all", async () => {
  const items = [1, 2, 3];
  const seen: number[] = [];
  await runWithConcurrencyLimit(items, 10, async (item) => {
    seen.push(item);
  });
  assert.deepEqual([...seen].sort(), items);
});

test("runWithConcurrencyLimit completes independent of settle order and tolerates an empty list", async () => {
  // Items settle in reverse order: a lane must pull the next item as soon as ITS
  // own worker settles, never wait on a slower sibling lane.
  const items = [40, 30, 20, 10];
  const finished: number[] = [];

  await runWithConcurrencyLimit(items, 2, async (item) => {
    await new Promise((resolve) => setTimeout(resolve, item));
    finished.push(item);
  });

  assert.equal(finished.length, 4);
  assert.notDeepEqual(finished, items, "completion order follows duration, not input order");

  let ran = false;
  await runWithConcurrencyLimit([], 4, async () => {
    ran = true;
  });
  assert.equal(ran, false, "an empty list must resolve without starting a lane");

  // A non-positive limit must still do the work (sequentially), never silently drop the batch.
  const sequential: number[] = [];
  await runWithConcurrencyLimit([1, 2, 3], 0, async (item) => {
    sequential.push(item);
  });
  assert.deepEqual(sequential, [1, 2, 3]);
});

test("runWithConcurrencyLimit drains every item even when a worker rejects, then surfaces the failure", async () => {
  const items = Array.from({ length: 8 }, (_, index) => index);
  const attempted: number[] = [];

  await assert.rejects(
    runWithConcurrencyLimit(items, 2, async (item) => {
      attempted.push(item);
      if (item < 2) throw new Error(`boom ${item}`);
    }),
    /boom 0/,
    "the first failure is the surfaced reason",
  );

  assert.equal(attempted.length, 8, "a failing worker must not stall its lane or strand later items");
});
