import { Hono } from "hono";

import { skuMovementListSchema } from "@jpx-accounting/contracts";
import { buildSkuMovementList } from "@jpx-accounting/domain";

import type { ApiRouteDeps, ApiRouteEnv } from "../route-types";

export function registerSkuMovementListRoutes(app: Hono<ApiRouteEnv>, deps: ApiRouteDeps) {
  app.get("/api/lists/sku-movements", async (context) => {
    const rows = buildSkuMovementList(await deps.getStore().getEvents());
    return context.json(skuMovementListSchema.parse(rows));
  });
}
