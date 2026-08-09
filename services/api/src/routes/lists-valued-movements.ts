import { Hono } from "hono";

import { valuedMovementListSchema } from "@jpx-accounting/contracts";
import { buildValuedMovementList } from "@jpx-accounting/domain";

import type { ApiRouteDeps, ApiRouteEnv } from "../route-types";

export function registerValuedMovementListRoutes(app: Hono<ApiRouteEnv>, deps: ApiRouteDeps) {
  app.get("/api/lists/valued-movements", async (context) => {
    const rows = buildValuedMovementList(await deps.getStore().getEvents());
    return context.json(valuedMovementListSchema.parse(rows));
  });
}
