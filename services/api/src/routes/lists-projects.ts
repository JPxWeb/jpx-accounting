import { Hono } from "hono";

import { registerProjectInputSchema } from "@jpx-accounting/contracts";
import { buildProjectsList } from "@jpx-accounting/domain";

import type { ApiRouteDeps, ApiRouteEnv } from "../route-types";
import { jsonValidated } from "../validation";

export function registerProjectListRoutes(app: Hono<ApiRouteEnv>, deps: ApiRouteDeps) {
  app.post("/api/projects", jsonValidated(registerProjectInputSchema), async (context) => {
    const project = await deps.getStore().registerProject({
      ...context.req.valid("json"),
      actorId: deps.deriveActorId(context),
    });
    return context.json(project, 201);
  });

  app.get("/api/lists/projects", async (context) => context.json(buildProjectsList(await deps.getStore().getEvents())));
}
