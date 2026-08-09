import { Hono } from "hono";

import { tripsListSchema } from "@jpx-accounting/contracts";
import { buildTripsList } from "@jpx-accounting/domain";

import type { ApiRouteDeps, ApiRouteEnv } from "../route-types";

export function registerTripListRoutes(app: Hono<ApiRouteEnv>, deps: ApiRouteDeps) {
  app.get("/api/lists/trips", async (context) => {
    const rows = buildTripsList(await deps.getStore().getEvents());
    return context.json(tripsListSchema.parse(rows));
  });
}
