import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { attachReviewEnrichmentIntentInputSchema } from "@jpx-accounting/contracts";

import type { ApiRouteDeps, ApiRouteEnv } from "../route-types";
import { jsonValidated } from "../validation";

export function registerReviewEnrichmentIntentRoutes(app: Hono<ApiRouteEnv>, deps: ApiRouteDeps) {
  app.post(
    "/api/reviews/:id/enrichment-intents",
    jsonValidated(attachReviewEnrichmentIntentInputSchema),
    async (context) => {
      const body = context.req.valid("json");
      const reviewId = context.req.param("id");
      if (body.reviewId !== reviewId) {
        throw new HTTPException(400, { message: "Body reviewId must match route review id." });
      }
      return context.json(
        await deps.getStore().attachReviewEnrichmentIntent({
          ...body,
          reviewId,
          actorId: deps.deriveActorId(context),
        }),
      );
    },
  );

  app.get("/api/reviews/:id/enrichment-intents", async (context) => {
    const intent = await deps.getStore().getReviewEnrichmentIntent(context.req.param("id"));
    if (!intent) throw new HTTPException(404, { message: "Review enrichment intent not found" });
    return context.json(intent);
  });
}
