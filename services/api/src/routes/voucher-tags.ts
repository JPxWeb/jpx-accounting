import { Hono } from "hono";

import { appendVoucherTagsInputSchema } from "@jpx-accounting/contracts";

import type { ApiRouteDeps, ApiRouteEnv } from "../route-types";
import { jsonValidated } from "../validation";

export function registerVoucherTagRoutes(app: Hono<ApiRouteEnv>, deps: ApiRouteDeps) {
  app.post("/api/vouchers/:id/tags", jsonValidated(appendVoucherTagsInputSchema), async (context) => {
    const body = context.req.valid("json");
    return context.json(
      await deps.getStore().appendVoucherTags(context.req.param("id"), {
        tagIds: body.tagIds,
        mode: body.mode,
        actorId: deps.deriveActorId(context),
      }),
    );
  });
}
