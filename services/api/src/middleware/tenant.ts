export function parseTenantFromClaims(claims: Record<string, unknown>) {
  const appMeta = (claims.app_metadata ?? {}) as Record<string, unknown>;
  return {
    userId: claims.sub as string,
    userEmail: (claims.email as string) ?? "",
    organizationId: (appMeta.organization_id as string) ?? "org_jpx",
    workspaceId: (appMeta.workspace_id as string) ?? "workspace_main",
  };
}
