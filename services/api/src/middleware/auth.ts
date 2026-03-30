import type { RuntimeMode } from "@jpx-accounting/contracts";
import { createClient } from "@supabase/supabase-js";
import type { Context, MiddlewareHandler } from "hono";

type AuthMiddlewareOptions = {
  runtimeMode: RuntimeMode;
  supabaseUrl?: string | undefined;
  supabaseServiceRoleKey?: string | undefined;
  skipVerification?: boolean | undefined;
};

declare module "hono" {
  interface ContextVariableMap {
    userId: string;
    userEmail: string;
    organizationId: string;
    workspaceId: string;
  }
}

export function authMiddleware(options: AuthMiddlewareOptions): MiddlewareHandler {
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
      context.set("workspaceId", "workspace_main");
      return next();
    }

    if (!options.supabaseUrl || !options.supabaseServiceRoleKey) {
      return context.json({ error: "Auth not configured" }, 503);
    }

    const supabase = createClient(options.supabaseUrl, options.supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      return context.json({ error: "Invalid or expired token" }, 401);
    }

    const organizationId = (user.user_metadata?.organization_id as string) ?? "org_default";
    const workspaceId = (user.user_metadata?.workspace_id as string) ?? "workspace_main";

    context.set("userId", user.id);
    context.set("userEmail", user.email ?? "");
    context.set("organizationId", organizationId);
    context.set("workspaceId", workspaceId);

    return next();
  };
}
