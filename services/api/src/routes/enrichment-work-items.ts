import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { proposeEnrichmentWorkItemInputSchema } from "@jpx-accounting/contracts";

import type { ApiRouteDeps, ApiRouteEnv } from "../route-types";
import { jsonValidated } from "../validation";

export function registerEnrichmentWorkItemRoutes(app: Hono<ApiRouteEnv>, deps: ApiRouteDeps) {
  app.post("/api/enrichment-work-items", jsonValidated(proposeEnrichmentWorkItemInputSchema), async (context) => {
    const body = context.req.valid("json");
    const item = await deps.getStore().proposeEnrichmentWorkItem({
      ...body,
      actorId: deps.deriveActorId(context),
    });
    return context.json(item, 201);
  });

  app.get("/api/enrichment-work-items/:id", async (context) => {
    const item = await deps.getStore().getEnrichmentWorkItem(context.req.param("id"));
    if (!item) throw new HTTPException(404, { message: "Enrichment work item not found" });
    return context.json(item);
  });

  app.post("/api/enrichment-work-items/:id/confirm", async (context) =>
    context.json(
      await deps
        .getStore()
        .confirmEnrichmentWorkItem(context.req.param("id"), { actorId: deps.deriveActorId(context) }),
    ),
  );

  app.post("/api/enrichment-work-items/:id/reject", async (context) =>
    context.json(
      await deps.getStore().rejectEnrichmentWorkItem(context.req.param("id"), { actorId: deps.deriveActorId(context) }),
    ),
  );
}
