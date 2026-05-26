import assert from "node:assert/strict";
import { test } from "node:test";

import { buildAssistantScaffold } from "@jpx-accounting/domain";

test("buildAssistantScaffold returns a grounded session with one citation", () => {
  const session = buildAssistantScaffold("Can we deduct VAT?");
  assert.equal(session.question, "Can we deduct VAT?");
  assert.equal(session.status, "grounded");
  assert.equal(session.citations.length, 1);
  assert.match(session.id, /^assistant_/);
  assert.ok(session.answer.length > 0);
});

test("buildAssistantScaffold answer and citation are deterministic; ids unique", () => {
  const a = buildAssistantScaffold("Q");
  const b = buildAssistantScaffold("Q");
  assert.equal(a.answer, b.answer);
  assert.equal(a.citations[0]?.title, b.citations[0]?.title);
  assert.notEqual(a.id, b.id);
});
