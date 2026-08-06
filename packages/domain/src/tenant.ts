/**
 * The ONE deferred-auth tenant scope. Multi-tenancy later replaces reads of
 * this with per-request claims — keep the name grep-replaceable.
 */
export const DEFAULT_TENANT_SCOPE = {
  organizationId: "org_jpx",
  workspaceId: "workspace_main",
} as const;

export type TenantScope = { organizationId: string; workspaceId: string };
