/**
 * Single home for the deferred-auth workspace scope. Spread it into API inputs
 * instead of repeating the string literals. Actor attribution is deliberately
 * ABSENT (WS-C R5): the server derives the actor from the verified JWT subject
 * (or the demo sentinel) — clients can no longer stamp identities into the
 * audit trail, and the request schemas dropped the `actorId` field.
 */
export const WORKSPACE_IDENTITY = {
  organizationId: "org_jpx",
  workspaceId: "workspace_main",
} as const;
