# Updated Future-Proof Stack Plan (March 18, 2026)

## Summary
- Core inference stack: `Azure OpenAI v1` + `Responses API` + official `openai` JavaScript/TypeScript SDK pointed at Azure’s `/openai/v1/` endpoint.
- Managed agent stack: `Microsoft Foundry Agent Service`, but only for advisory/research/automation sidecars. Do not put bookkeeping correctness or ledger posting behind managed-agent state.
- Web stack: `Next.js 16` + `React 19.2` + `Tailwind CSS v4` + `shadcn/ui` + `Motion`.
- App/API stack: `Hono` + `Zod 4` + `TanStack Query` + `TanStack Form`, so the web app and future native app share contracts and behavior without relying on web-only server actions.
- Native-later path: keep web first today, but reserve a clean `Expo SDK 55` path for iOS/Android later. Do not use React Native Web or Expo UI beta as the V1 foundation.

## AI Stack Decisions
- Use `Responses API` for all core model calls, structured outputs, tool calls, background work, and chained multi-step tasks.
- Build an internal `ai-core` package around the official `openai` client so the rest of the app never talks to Azure/OpenAI directly.
- Keep three adapters:
  - `responses-adapter`: the default and required path for production bookkeeping flows.
  - `foundry-agent-adapter`: for managed agents that need identity, publishing, tracing, MCP tools, or long-running research.
  - `mock-adapter`: for tests and local deterministic replay.
- Treat `Foundry Agent Service` as an outer runtime, not the source of truth:
  - Prompt agents are allowed for advisory and grounded Q&A.
  - Workflow agents can be adopted later for approval pipelines once they are no longer preview-risk for this product.
  - Hosted agents are deferred until they leave preview and private networking support is production-ready.
- If we use the OpenAI `Agents SDK`, use it only inside an isolated orchestration module. It must not own ledger state, tax rules, or audit state.
- Do not use Assistants API anywhere new.
- Do not rely on provider-side conversation memory for financial records. Azure Responses retains stored response data for 30 days by default, so persist required state in our own store and delete provider-side responses when we don’t need them.

## Architecture Changes
- Split the system into four clear layers:
  - `apps/web`: Next.js app shell, mobile-first UX, PWA installability, streamed assistant UI.
  - `services/api`: Hono app for all product APIs used by web now and native later.
  - `packages/domain`: accounting rules, event models, BAS/VAT logic, review policy, report generation.
  - `packages/ai-core`: provider adapters, prompt/schema management, citations, traces, eval hooks.
- Keep all business mutations behind explicit typed APIs. Avoid using Next.js Server Actions for domain writes so the future native app does not force a rewrite.
- Use `Hono` RPC-style typed contracts plus `Zod 4` schemas for request/response definitions shared across web and future Expo apps.
- Use `TanStack Query` for cached server state and `TanStack Form` for complex financial/mobile forms. This avoids coupling data and validation to browser-only patterns.
- Keep an internal MCP boundary:
  - Expose company policy lookup, BAS lookup, VAT rule lookup, supplier history lookup, and ledger/report queries as internal tools.
  - Every MCP-backed tool must also have a normal service/API equivalent so we are not locked into MCP as the only integration contract.

## Model and Retrieval Policy
- Use pinned named model deployments for compliance-critical flows.
- Use a faster/cheaper deployment for extraction classification and account suggestions.
- Use a stronger reasoning deployment for advisory explanations, tax edge-case review, and anomaly analysis.
- Allow `model-router` or a latest-model lane only for low-risk exploratory advisory and internal research, not for deterministic posting recommendations.
- Retrieval stack:
  - Primary KB: curated Swedish law/rule/company corpus with effective dates and citation metadata.
  - Search: start with Supabase `pgvector`; add Azure AI Search only if retrieval quality or scale requires it.
  - Rerank before answer generation when the assistant is answering advisory/tax questions.
- Document AI stack:
  - Primary extractor: Azure Document Intelligence.
  - Secondary evaluation lane: evaluate Azure-hosted document-capable models like Mistral Document AI for messy PDFs and edge-case receipts before productizing them.

## Framework Choices
- Use `Next.js 16` for the web shell and rendering layer because it is stable now; do not switch the whole product to TanStack Start because it is still RC/community-stage.
- Use `React 19.2` features where they solve real problems:
  - `useEffectEvent` for event-heavy mobile capture/report flows.
  - `Activity` for keeping review/report panels alive without expensive reinitialization.
- Use `Tailwind CSS v4` and custom design tokens for the glass/minimal system.
- Keep `shadcn/ui` as the component code-distribution base, not a full design system. Customize heavily.
- Use `Motion` for route and panel transitions.
- Native later:
  - When the native app starts, use `Expo SDK 55` + Expo Router.
  - Share `domain`, `schemas`, `api-client`, and `tokens`.
  - Do not plan on sharing web UI components directly.
- Avoid as foundations today:
  - Assistants API
  - Foundry classic connection-string projects
  - Foundry hosted agents for core flows
  - TanStack Start as the main product framework
  - Expo UI beta as the main component system

## UX and Mobile Implications
- Keep the mobile-first PWA decision from the previous plan.
- Add one new rule: every AI workflow must be operable through a touch-first review flow, not only through a chat surface.
- The assistant UI can use AI SDK 6 style streaming patterns, but it should call our own `/api/assistant/*` routes, never Azure directly from the browser.
- Human-in-the-loop approval remains mandatory for all postings in V1, including any tool execution that changes accounting state.

## Test Plan
- Provider abstraction tests:
  - swap `responses-adapter` and `mock-adapter` without changing domain code
  - run advisory flows through `foundry-agent-adapter` without changing UI contracts
- Privacy/compliance tests:
  - provider-side response deletion job works
  - no accounting mutation depends on provider memory or thread state
  - locked periods and correction postings are unaffected by agent/runtime changes
- API portability tests:
  - same typed API client works from web and a small Expo prototype
- AI quality tests:
  - structured output schemas remain stable across model upgrades
  - advisory answers always include citations or return “insufficient basis”
  - low-risk model-router lane is blocked from compliance-critical actions
- Mobile tests:
  - capture, review, and approval remain fast and touch-safe on phone widths
  - streamed assistant UI degrades gracefully on low bandwidth

## Assumptions and Defaults
- Default inference path is official `openai` SDK -> Azure `/openai/v1/` -> `responses`.
- Foundry Agent Service is used selectively, not as the universal AI runtime.
- We prefer Azure-managed capabilities where they are stable, but we avoid preview-only features in compliance-critical flows.
- Web remains the first shipped client; native starts later with Expo, not before the web bookkeeping flow is proven.
- Key sources used for this update:
  - [Azure v1 API lifecycle](https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle)
  - [Azure Responses API](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses)
  - [Foundry Agent Service overview](https://learn.microsoft.com/en-us/azure/foundry/agents/overview)
  - [Foundry Agent Service updates](https://learn.microsoft.com/en-us/azure/ai-foundry/agents/whats-new?view=foundry-classic&viewFallbackFrom=foundry)
  - [Use your own resources with Agent Service](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/use-your-own-resources)
  - [OpenAI Agents SDK](https://developers.openai.com/api/docs/guides/agents-sdk)
  - [OpenAI Agents SDK TypeScript](https://openai.github.io/openai-agents-js/)
  - [AI SDK 6](https://vercel.com/blog/ai-sdk-6)
  - [Next.js 16](https://nextjs.org/blog/next-16)
  - [React 19.2](https://react.dev/blog/2025/10/01/react-19-2)
  - [Tailwind CSS v4](https://tailwindcss.com/blog/tailwindcss-v4)
  - [Expo SDK 55](https://expo.dev/sdk)
  - [Hono](https://hono.dev/)
  - [Hono RPC](https://hono.dev/docs/guides/rpc)
  - [Zod 4](https://zod.dev/)
  - [TanStack Query defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)
  - [TanStack Form](https://tanstack.com/form/docs)
