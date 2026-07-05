/**
 * Single home for the deferred-auth workspace identity. Real authentication is a later
 * phase; until it lands, every client-originated write (evidence creation, review
 * decisions, draft promotion) attributes to this fixed founder identity. Spread it into
 * API inputs instead of repeating the string literals.
 */
export const WORKSPACE_IDENTITY = {
  organizationId: "org_jpx",
  workspaceId: "workspace_main",
  actorId: "user_founder",
} as const;
