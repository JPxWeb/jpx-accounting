import type { Context } from "hono";

import type { LedgerStore } from "@jpx-accounting/domain/store";

export type ApiRouteEnv = {
  Variables: {
    requestId: string;
    jwtPayload?: Record<string, unknown> | undefined;
  };
};

export type ApiRouteDeps = {
  getStore: () => LedgerStore;
  deriveActorId: (context: Context<ApiRouteEnv>) => string;
};
