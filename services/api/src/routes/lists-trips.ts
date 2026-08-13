import { Hono } from "hono";

import { tripClosedPayloadSchema, tripRegisteredPayloadSchema, tripsListSchema } from "@jpx-accounting/contracts";
import { buildTripsList } from "@jpx-accounting/domain";

import type { ApiRouteDeps, ApiRouteEnv } from "../route-types";
import { jsonValidated } from "../validation";

export function registerTripListRoutes(app: Hono<ApiRouteEnv>, deps: ApiRouteDeps) {
  app.post("/api/trips", jsonValidated(tripRegisteredPayloadSchema), async (context) =>
    context.json(
      await deps.getStore().registerTrip({
        ...context.req.valid("json"),
        actorId: deps.deriveActorId(context),
      }),
      201,
    ),
  );
  app.post("/api/trips/close", jsonValidated(tripClosedPayloadSchema), async (context) =>
    context.json(
      await deps.getStore().closeTrip({
        ...context.req.valid("json"),
        actorId: deps.deriveActorId(context),
      }),
      201,
    ),
  );
  app.get("/api/lists/trips", async (context) => {
    const rows = buildTripsList(await deps.getStore().getEvents());
    return context.json(tripsListSchema.parse(rows));
  });
}
