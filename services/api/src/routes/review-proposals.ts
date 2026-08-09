import { Hono } from "hono";

import { submitReviewProposalInputSchema, submitReviewProposalResultSchema } from "@jpx-accounting/contracts";
import { EnrichmentIntentClosedError } from "@jpx-accounting/domain";
import { ReviewNotFoundError } from "@jpx-accounting/domain/store";

import type { ApiRouteDeps, ApiRouteEnv } from "../route-types";
import { jsonValidated } from "../validation";

export function registerReviewProposalRoutes(app: Hono<ApiRouteEnv>, deps: ApiRouteDeps) {
  app.post("/api/review-proposals", jsonValidated(submitReviewProposalInputSchema), async (context) => {
    const body = context.req.valid("json");
    const review = await deps.getStore().findReviewByVoucher(body.voucherId);
    if (!review || review.id !== body.reviewId) {
      throw new ReviewNotFoundError([body.reviewId]);
    }
    if (review.status !== "needs-review") {
      throw new EnrichmentIntentClosedError(body.reviewId);
    }

    await deps.getStore().attachReviewEnrichmentIntent({
      reviewId: body.reviewId,
      proposals: body.proposals,
      actorId: deps.deriveActorId(context),
    });
    return context.json(
      submitReviewProposalResultSchema.parse({
        reviewId: body.reviewId,
        deepLink: `/today?view=queue&review=${encodeURIComponent(body.reviewId)}`,
        status: "pending_review",
      }),
    );
  });
}
