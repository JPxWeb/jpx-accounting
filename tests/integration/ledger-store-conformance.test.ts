/**
 * Shared LedgerStore conformance: MemoryLedgerStore and PostgresLedgerStore
 * must agree on accounting behavior (Local Postgres Dev DB plan, Task 5).
 *
 * Memory scenarios always run. Postgres + parity comparisons honor the shared
 * `jpx_test_*` / JPX_REQUIRE_DATABASE_TESTS gate.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { MemoryLedgerStore } from "@jpx-accounting/domain/store";
import { PostgresLedgerStore } from "@jpx-accounting/persistence-postgres";

import {
  assertConformanceParity,
  CONFORMANCE_SCENARIOS,
  type ConformanceHarness,
} from "./helpers/ledger-store-conformance";
import {
  openPostgresTestContext,
  preparePostgresIntegrationGate,
  type PostgresTestContext,
} from "./helpers/postgres-test-context";

const gate = preparePostgresIntegrationGate();
const skipPostgres = gate.skip;

let ctx: PostgresTestContext | undefined;

test.before(async () => {
  if (!gate.skip) {
    ctx = await openPostgresTestContext(gate);
  }
});

test.after(async () => {
  await ctx?.close();
  ctx = undefined;
});

function requireCtx(): PostgresTestContext {
  if (!ctx) {
    throw new Error("Postgres test context was not opened — gate.skip should have skipped this test");
  }
  return ctx;
}

function memoryHarness(): ConformanceHarness {
  return {
    label: "memory",
    store: new MemoryLedgerStore(),
    organizationId: "org_jpx",
    workspaceId: "workspace_main",
    actorId: "user_conformance",
  };
}

test("conformance registry includes enrichment confirmation safety", () => {
  assert.ok(CONFORMANCE_SCENARIOS.some((scenario) => scenario.name === "enrichment confirm never posts twice"));
  assert.ok(CONFORMANCE_SCENARIOS.some((scenario) => scenario.name === "external reference append-only paths"));
});

async function withPostgresHarness(label: string, run: (h: ConformanceHarness) => Promise<void>): Promise<void> {
  const ns = requireCtx().createNamespace(label);
  const store = new PostgresLedgerStore(requireCtx().client, {
    organizationId: ns.organizationId,
    workspaceId: ns.workspaceId,
  });
  try {
    await run({
      label: "postgres",
      store,
      organizationId: ns.organizationId,
      workspaceId: ns.workspaceId,
      actorId: "user_conformance",
    });
  } finally {
    await requireCtx().cleanupOrganization(ns.organizationId);
  }
}

for (const scenario of CONFORMANCE_SCENARIOS) {
  test(`MemoryLedgerStore conformance: ${scenario.name}`, async () => {
    const outcome = await scenario.run(memoryHarness());
    assert.ok(outcome, `scenario "${scenario.name}" must return an outcome`);
  });

  test(`PostgresLedgerStore conformance: ${scenario.name}`, { skip: skipPostgres }, async () => {
    await withPostgresHarness(scenario.name, async (h) => {
      const outcome = await scenario.run(h);
      assert.ok(outcome, `scenario "${scenario.name}" must return an outcome`);
    });
  });

  test(`Memory/Postgres parity: ${scenario.name}`, { skip: skipPostgres }, async () => {
    const memoryOutcome = await scenario.run(memoryHarness());
    await withPostgresHarness(`parity_${scenario.name}`, async (h) => {
      const postgresOutcome = await scenario.run(h);
      assertConformanceParity(memoryOutcome, postgresOutcome, scenario.name);
    });
  });
}
