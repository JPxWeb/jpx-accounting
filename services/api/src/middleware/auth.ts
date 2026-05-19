import type { RuntimeMode } from "@jpx-accounting/contracts";
import { createClient } from "@supabase/supabase-js";
import type { Context, MiddlewareHandler } from "hono";

import { MissingTenantClaimError, type ParsedTenant, parseTenantFromClaims } from "./tenant";

type AuthMiddlewareOptions = {
  runtimeMode: RuntimeMode;
  supabaseUrl?: string | undefined;
  supabaseSecretKey?: string | undefined;
  skipVerification?: boolean | undefined;
};

declare module "hono" {
  interface ContextVariableMap {
    userId: string;
    userEmail: string;
    organizationId: string;
    workspaceId: string;
    store: import("@jpx-accounting/domain").LedgerStore;
  }
}

export function authMiddleware(options: AuthMiddlewareOptions): MiddlewareHandler {
  const supabaseClient =
    options.supabaseUrl && options.supabaseSecretKey
      ? createClient(options.supabaseUrl, options.supabaseSecretKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        })
      : null;

  return async (context: Context, next) => {
    if (options.runtimeMode === "demo") {
      context.set("userId", "user_demo");
      context.set("userEmail", "demo@jpx.se");
      context.set("organizationId", "org_jpx");
      context.set("workspaceId", "workspace_main");
      return next();
    }

    const authHeader = context.req.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return context.json({ error: "Missing or invalid Authorization header" }, 401);
    }

    const token = authHeader.slice(7);

    if (options.skipVerification) {
      context.set("userId", "user_test");
      context.set("userEmail", "test@jpx.se");
      context.set("organizationId", "org_test");
      context.set("workspaceId", "workspace_test");
      return next();
    }

    if (!supabaseClient) {
      return context.json({ error: "Auth not configured" }, 503);
    }

    const { data, error } = await supabaseClient.auth.getClaims(token);
    if (error || !data?.claims) {
      return context.json({ error: "Invalid or expired token" }, 401);
    }

    let tenant: ParsedTenant;
    try {
      tenant = parseTenantFromClaims(data.claims as Record<string, unknown>);
    } catch (err) {
      if (err instanceof MissingTenantClaimError) {
        return context.json({ error: "Token is missing organization claims" }, 401);
      }
      throw err;
    }
    context.set("userId", tenant.userId);
    context.set("userEmail", tenant.userEmail);
    context.set("organizationId", tenant.organizationId);
    context.set("workspaceId", tenant.workspaceId);

    return next();
  };
}
