import { Hono } from "hono";

import { externalReferenceLinkedPayloadSchema } from "@jpx-accounting/contracts";

import type { ApiRouteDeps, ApiRouteEnv } from "../route-types";
import { jsonValidated } from "../validation";

const linkExternalReferenceBodySchema = externalReferenceLinkedPayloadSchema.pick({
  url: true,
  label: true,
});

export function registerVoucherExternalReferenceRoutes(app: Hono<ApiRouteEnv>, deps: ApiRouteDeps) {
  app.post("/api/vouchers/:id/external-references", jsonValidated(linkExternalReferenceBodySchema), async (context) => {
    const body = context.req.valid("json");
    const reference = await deps.getStore().appendVoucherExternalReference(context.req.param("id"), {
      url: body.url,
      ...(body.label !== undefined ? { label: body.label } : {}),
      actorId: deps.deriveActorId(context),
    });
    return context.json(reference, 201);
  });

  app.post("/api/vouchers/:id/external-references/:refId/unlink", async (context) =>
    context.json(
      await deps.getStore().removeVoucherExternalReference(context.req.param("id"), context.req.param("refId"), {
        actorId: deps.deriveActorId(context),
      }),
    ),
  );
}
