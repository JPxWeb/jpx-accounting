import assert from "node:assert/strict";
import { test } from "node:test";

import { buildVoucherDraft } from "@jpx-accounting/domain";

test("buildVoucherDraft produces voucher + review + suggestion from extracted fields", () => {
  const draft = buildVoucherDraft({
    voucherId: "v1",
    packetId: "p1",
    voucherNumber: "V-1001",
    createdAt: "2026-05-19T00:00:00.000Z",
    actorUserId: "user_authenticated",
    input: {
      organizationId: "o",
      workspaceId: "w",
      actorId: "attacker_from_body",
      title: "OpenAI subscription invoice",
      originalFilename: "openai.pdf",
      mimeType: "application/pdf",
      modalities: ["pdf"],
    },
  });
  assert.equal(draft.voucher.voucherFields.grossAmount, 1249);
  assert.equal(draft.review.voucherId, "v1");
  assert.equal(draft.review.provenanceTimeline.length, 4);
  assert.deepEqual(
    draft.review.provenanceTimeline.map((s) => s.label),
    ["Evidence received", "Fields extracted", "Rules applied", "Suggestion generated"],
  );
  assert.equal(draft.suggestion.voucherId, "v1");
  // The initial provenance step must attribute to the authenticated actor, never the
  // request body's actorId — same audit invariant as the EvidenceReceived/VoucherCreated events.
  assert.equal(draft.review.provenanceTimeline[0]?.actor, "user_authenticated");
  // domain entity attribution still comes from the body
  assert.equal(draft.voucher.createdBy, "attacker_from_body");
});
