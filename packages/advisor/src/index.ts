/**
 * @jpx-accounting/advisor — the pure, isomorphic advisor brain (Phase 5).
 *
 * Deps: contracts + reporting ONLY. Never ai-core (its `openai` import must
 * not reach the web bundle) and never node built-ins on this surface — the
 * web's local demo transport bundles this package. The fs-reading corpus
 * builder lives in `./corpus-source` and is deliberately NOT re-exported.
 */
export { KNOWLEDGE_CORPUS } from "./corpus.generated";
export * from "./excerpt";
export * from "./retrieval";
export * from "./sanitize";
export * from "./context";
export * from "./demo-turn";
export * from "./prompts";
