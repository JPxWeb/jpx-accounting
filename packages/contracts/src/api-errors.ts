/** Keep in sync with `runtimeModeSchema` in `index.ts`. */
export type ApiJsonErrorRuntimeMode = "demo" | "normal";

export type ApiValidationIssue = {
  path: string[];
  message: string;
};

export type ApiJsonErrorBody = {
  error: string;
  runtimeMode: ApiJsonErrorRuntimeMode;
  requestId: string;
  code?: string;
  issues?: ApiValidationIssue[];
};
