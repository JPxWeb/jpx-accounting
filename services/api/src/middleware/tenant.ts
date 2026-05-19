export class MissingTenantClaimError extends Error {
  constructor(claimPath: string) {
    super(`Authenticated token is missing required claim: ${claimPath}`);
    this.name = "MissingTenantClaimError";
  }
}

export type ParsedTenant = {
  userId: string;
  userEmail: string;
  organizationId: string;
  workspaceId: string;
};

export function parseTenantFromClaims(claims: Record<string, unknown>): ParsedTenant {
  const appMeta = (claims.app_metadata ?? {}) as Record<string, unknown>;
  const sub = claims.sub;
  const organizationId = appMeta.organization_id;
  const workspaceId = appMeta.workspace_id;

  if (typeof sub !== "string" || sub.length === 0) throw new MissingTenantClaimError("sub");
  if (typeof organizationId !== "string" || organizationId.length === 0) {
    throw new MissingTenantClaimError("app_metadata.organization_id");
  }
  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    throw new MissingTenantClaimError("app_metadata.workspace_id");
  }

  return {
    userId: sub,
    userEmail: typeof claims.email === "string" ? claims.email : "",
    organizationId,
    workspaceId,
  };
}
