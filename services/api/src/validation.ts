import { zValidator } from "@hono/zod-validator";
import type { ZodType } from "zod";

import type { ApiValidationIssue } from "@jpx-accounting/contracts";

/**
 * Thrown (or surfaced via `validationErrorHook`) so `app.onError` can emit the
 * contract-pinned `{ code: "validation_error", issues[] }` 400 body that
 * `tests/unit/api-runtime.test.ts` asserts on — same shape the legacy
 * `parseBody` helper produced before the `@hono/zod-validator` migration.
 */
export class ApiValidationError extends Error {
  readonly code = "validation_error" as const;

  constructor(
    message: string,
    readonly issues: ApiValidationIssue[],
  ) {
    super(message);
    this.name = "ApiValidationError";
  }
}

type ZodIssueLike = { path: PropertyKey[]; message: string };

function mapZodIssues(issues: readonly ZodIssueLike[]): ApiValidationIssue[] {
  return issues.map((issue) => ({
    path: issue.path.map((segment) => String(segment)),
    message: issue.message,
  }));
}

function summarizeIssues(issues: ApiValidationIssue[]): string {
  return (
    issues
      .map((issue) => (issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
      .join("; ") || "Invalid request body"
  );
}

function throwValidationError(issues: readonly ZodIssueLike[]): never {
  const mapped = mapZodIssues(issues);
  throw new ApiValidationError(summarizeIssues(mapped), mapped);
}

/**
 * `@hono/zod-validator` hook: throw `ApiValidationError` instead of returning
 * a generic 400 text response so the global error handler keeps one JSON shape.
 * Duck-types Zod issue paths so the hook stays compatible with Zod v4's internal
 * `$ZodError` type that `@hono/zod-validator` 0.8 passes through.
 */
export function validationErrorHook(
  result: { success: true; data: unknown } | { success: false; error: { issues: readonly ZodIssueLike[] } },
  _c: unknown,
) {
  if (!result.success) {
    throwValidationError(result.error.issues);
  }
}

/** Route middleware: validate JSON body with Zod v4 and the shared error hook. */
export function jsonValidated<T extends ZodType>(schema: T) {
  return zValidator("json", schema, (result, _c) => {
    validationErrorHook(result, _c);
  });
}
