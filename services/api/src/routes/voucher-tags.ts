import { Hono } from "hono";
import { z } from "zod";

import { voucherTagsAddedPayloadSchema } from "@jpx-accounting/contracts";

import type { ApiRouteDeps, ApiRouteEnv } from "../route-types";
import { jsonValidated } from "../validation";

const appendVoucherTagsBodySchema = voucherTagsAddedPayloadSchema
  .pick({ tagIds: true })
  .extend({ mode: z.enum(["add", "remove"]) });

export function registerVoucherTagRoutes(app: Hono<ApiRouteEnv>, deps: ApiRouteDeps) {
  app.post("/api/vouchers/:id/tags", jsonValidated(appendVoucherTagsBodySchema), async (context) => {
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
