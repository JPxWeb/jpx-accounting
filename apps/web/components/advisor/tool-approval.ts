/**
 * Signature-preserving replacement for `AbstractChat.addToolApprovalResponse`.
 *
 * ai@7.0.15 rebuilds the approval object as `{ id, approved, reason }` when
 * responding to a tool-approval request, DROPPING every other field — including
 * the HMAC `signature` the server streamed in the approval request. On replay,
 * `streamText`'s `validateApprovedToolApprovals` then rejects the turn with
 * "missing signature" whenever `experimental_toolApprovalSecret` is set, which
 * is ALWAYS in normal mode (`services/api/src/advisor/chat.ts`). The API-side
 * behavior is pinned by `tests/integration/advisor-normal-mode.test.ts`; this
 * module keeps the web client honest until the upstream drop is fixed —
 * re-test on every `ai` package bump and delete this file when the SDK
 * preserves the approval object.
 *
 * The transition mirrors the SDK exactly (only the LAST message is considered,
 * only `approval-requested` tool parts match) — the sole difference is
 * `approval: { ...part.approval, approved }` instead of a rebuilt object.
 */

type ApprovalRequestedPart = {
  type: string;
  state: "approval-requested";
  approval: { id: string; signature?: string };
};

function isApprovalRequestedPart(part: unknown, approvalId: string): part is ApprovalRequestedPart {
  if (typeof part !== "object" || part === null) return false;
  const candidate = part as { type?: unknown; state?: unknown; approval?: { id?: unknown } };
  return (
    typeof candidate.type === "string" &&
    candidate.type.startsWith("tool-") &&
    candidate.state === "approval-requested" &&
    candidate.approval?.id === approvalId
  );
}

/**
 * Returns a new messages array with the matching approval part flipped to
 * `approval-responded` (signature intact), or `undefined` when the last
 * message holds no matching `approval-requested` part.
 */
export function respondToApprovalPreservingSignature<Message extends { parts: readonly unknown[] }>(
  messages: readonly Message[],
  approvalId: string,
  approved: boolean,
): Message[] | undefined {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) return undefined;

  let matched = false;
  const parts = lastMessage.parts.map((part) => {
    if (!isApprovalRequestedPart(part, approvalId)) return part;
    matched = true;
    return {
      ...part,
      state: "approval-responded",
      approval: { ...part.approval, approved },
    };
  });
  if (!matched) return undefined;

  return [...messages.slice(0, -1), { ...lastMessage, parts }];
}
