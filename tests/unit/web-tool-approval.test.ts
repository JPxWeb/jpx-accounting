import assert from "node:assert/strict";
import { test } from "node:test";

import { respondToApprovalPreservingSignature } from "../../apps/web/components/advisor/tool-approval";

/**
 * Regression net for the ai@7.0.15 signature-drop workaround: the SDK's
 * addToolApprovalResponse rebuilds the approval object as {id, approved,
 * reason}, losing the HMAC signature the server streamed — which makes every
 * normal-mode tool approval fail closed ("missing signature"). The web helper
 * must flip the part state while keeping the approval object's fields intact.
 */

function approvalPart(overrides: Record<string, unknown> = {}) {
  return {
    type: "tool-proposeReviewAction",
    toolCallId: "call-1",
    state: "approval-requested",
    approval: { id: "appr-1", signature: "hmac-sig-abc", signedAt: "2026-07-19T00:00:00Z" },
    input: { reviewId: "rev_1", action: "approve" },
    ...overrides,
  };
}

test("flips the matching approval part and preserves signature + extra approval fields", () => {
  const messages = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "boka" }] },
    { id: "a1", role: "assistant", parts: [{ type: "text", text: "förslag" }, approvalPart()] },
  ];

  const updated = respondToApprovalPreservingSignature(messages, "appr-1", true);

  assert.ok(updated, "expected a match");
  const part = updated[1]!.parts[1] as unknown as {
    state: string;
    approval: { id: string; approved: boolean; signature: string; signedAt: string };
    input: unknown;
  };
  assert.equal(part.state, "approval-responded");
  assert.equal(part.approval.approved, true);
  assert.equal(part.approval.signature, "hmac-sig-abc", "signature must survive the response");
  assert.equal(part.approval.signedAt, "2026-07-19T00:00:00Z", "every approval field must survive");
  assert.equal(part.approval.id, "appr-1");
  assert.deepEqual(part.input, { reviewId: "rev_1", action: "approve" }, "non-approval fields untouched");
});

test("records a rejection the same way", () => {
  const messages = [{ id: "a1", role: "assistant", parts: [approvalPart()] }];
  const updated = respondToApprovalPreservingSignature(messages, "appr-1", false);
  assert.ok(updated);
  const part = updated[0]!.parts[0] as unknown as { approval: { approved: boolean; signature: string } };
  assert.equal(part.approval.approved, false);
  assert.equal(part.approval.signature, "hmac-sig-abc");
});

test("returns undefined when no approval-requested part matches", () => {
  const noMatch = respondToApprovalPreservingSignature(
    [{ id: "a1", role: "assistant", parts: [approvalPart({ approval: { id: "other" } })] }],
    "appr-1",
    true,
  );
  assert.equal(noMatch, undefined);

  const alreadyResponded = respondToApprovalPreservingSignature(
    [{ id: "a1", role: "assistant", parts: [approvalPart({ state: "approval-responded" })] }],
    "appr-1",
    true,
  );
  assert.equal(alreadyResponded, undefined);

  assert.equal(respondToApprovalPreservingSignature([], "appr-1", true), undefined);
});

test("mirrors the SDK: only the LAST message is considered", () => {
  const messages = [
    { id: "a1", role: "assistant", parts: [approvalPart()] },
    { id: "u2", role: "user", parts: [{ type: "text", text: "senare fråga" }] },
  ];
  assert.equal(
    respondToApprovalPreservingSignature(messages, "appr-1", true),
    undefined,
    "an approval buried before the last message must not be flipped",
  );
});

test("leaves non-matching parts reference-identical and does not mutate the input", () => {
  const untouched = { type: "text", text: "förslag" };
  const original = approvalPart();
  const messages = [{ id: "a1", role: "assistant", parts: [untouched, original] }];

  const updated = respondToApprovalPreservingSignature(messages, "appr-1", true);

  assert.ok(updated);
  assert.equal(updated[0]!.parts[0], untouched, "non-matching parts keep reference identity");
  assert.equal(original.state, "approval-requested", "input part must not be mutated");
  assert.equal(messages[0]!.parts[1], original, "input array must not be mutated");
});
