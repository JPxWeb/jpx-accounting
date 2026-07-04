# Phase 5 front-end tech decision memo (verified 2026-07-04)

Verified against live sources + npm registry on 2026-07-04. Feeds the Phase 5 detail plan. Stack context: Next 16.2.0, React 19.2.4, Tailwind 4.2.2, Hono 4.12.8, Zod 4.3.6, next-intl 4.13, nuqs 2.8, idb 8.0.3, React Compiler, Node ≥24.

## 1. Drag & drop — VERDICT: **@dnd-kit/react 0.5.0 (the new rewrite)**

Install (pin exact — 0.x): `pnpm --filter @jpx-accounting/web add @dnd-kit/react@0.5.0 @dnd-kit/helpers@0.5.0`

| Option                   | Version (date)                        | React 19                                 | Keyboard DnD                                                                                                                  | Touch    |
| ------------------------ | ------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------- |
| **@dnd-kit/react (new)** | 0.5.0 (2026-06-11; active)            | peer `^18 \|\| ^19`                      | **KeyboardSensor default**: Space/Enter pick up, arrows move, Esc cancels; built-in ARIA + SR live regions; WCAG 2.1 AA claim | built in |
| @dnd-kit/core (legacy)   | 6.3.1 (2024-12-05) — stale ~19 months | works empirically, no official statement | mature                                                                                                                        | yes      |
| Pragmatic DnD            | core 2.0.1 (2026-06-17)               | yes                                      | **none by design** (build action-menu alternatives yourself)                                                                  | yes      |
| Native HTML5             | —                                     | —                                        | none                                                                                                                          | no       |

EAA/WCAG 2.1.1 keyboard operability is the decider: only dnd-kit ships it first-class. Use the actively-maintained rewrite; wrap in ONE abstraction (`apps/web/components/dashboard/sortable-grid.tsx`) so a 0.x bump touches one file. Long-press-to-drag on mobile via pointer-sensor activation delay. Drag handles = real `<button>`s. Persist order via the layout store, not component state. shadcn ecosystem: Dice UI / ReUI sortables exist but ride the legacy dnd-kit — crib markup/overlay patterns, not deps.

## 2. Streaming AI chat — VERDICT: **AI SDK v7: `ai@7.0.15` + `@ai-sdk/react@4.0.16` + `@ai-sdk/azure@4.0.7`**

- v7 GA 2026-06-25; constraints pass (Node 24 ✓, ESM ✓, zod 4.3.6 ✓, React 19.2.4 ✓). v7 deprecates v6 `needsApproval` for call-level **`toolApproval`**.
- **Hono first-class**: `useChat` + `DefaultChatTransport({ api: "/api-proxy/api/advisor/chat" })`; server returns `result.toUIMessageStreamResponse()` (official Hono example exists).
- Wire protocol: SSE with `x-vercel-ai-ui-message-stream: v1`; events `start` / `text-start|delta|end` / tool parts / custom `data-*` / `finish` / `[DONE]`. Docs bless non-AI backends synthesizing the stream.
- **Demo mode without LLM — confirmed**: synthesize the UI message stream server-side (`createUIMessageStream` from `ai`, or `hono/streaming` streamSSE) so demo deterministically exercises text AND tool/approval parts. One client codepath for demo + normal. (Alternative `TextStreamChatTransport` = plain text only.)
- **Tool approvals**: tool call streams `approval-requested`; client `addToolApprovalResponse(...)` + `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses`. Use `experimental_toolApprovalSecret` (HMAC-signed) — approvals route into the review queue, never direct postings ("AI suggests, never mutates").
- **Azure Responses API clean**: `@ai-sdk/azure` v7 `azure('deployment')` uses Responses API by default (v1 endpoint); `useDeploymentBasedUrls: true` for legacy URLs.

## 3. View Transitions + modern CSS

- **Next 16.2 View Transitions: experimental — do NOT build on the React/Next component API this phase.**
- **Raw same-document `document.startViewTransition()` is Baseline Newly Available (Oct 2025)** (Chrome 111+, Safari 18+, Firefox 144+): progressive-enhance widget add/remove/reorder-commit with a feature-detected guard; never during an active drag.
- **Anchor positioning**: all-engine as of Firefox 147 (2026-01-13) but partial in Safari/Firefox — enhancement-only; keep Base UI positioner for load-bearing popovers.
- **Popover API (Baseline Widely Available since Apr 2025) + `@starting-style` + `transition-behavior: allow-discrete` — ADOPT** for new drawers/sheets/menus (kills the controlled-open + invisible-backdrop workaround; Escape/outside-click free via top layer). Focus-trap semantics differ from dialogs — capture sheet stays on `useDialogFocusTrap`.

## 4. Widget-layout persistence — VERDICT: **localStorage + BroadcastChannel via `useSyncExternalStore`**

- `apps/web/lib/dashboard-layout-storage.ts`: schema-versioned JSON (`{ v: 1, widgets: [...] }`), Zod parse-on-read with defaults fallback.
- Write: `setItem` then `BroadcastChannel("jpx-dashboard-layout").postMessage({ v })`. Subscribe: one `useSyncExternalStore` listening to the channel + `storage` event. Optimistic during drag, commit on drop. IndexedDB buys nothing (no blobs/queries). Server-side layouts can layer later without changing this shape.

## 5. New since Jan 2026 — ship it

- **AI SDK 7** (the big one we'd have missed) — signed tool approvals + agent workflow primitives.
- DnD landscape moved in June 2026 (dnd-kit 0.5, Pragmatic 2.0) — recommendations reflect that.
- Interop 2026 focus areas = view transitions, dialog/popover extensions, scroll-driven animations, container style queries, anchor positioning → progressive enhancement compounds.
- Scroll-driven animations (`animation-timeline`) — enhancement-only for ambient bars.
- **EAA enforcement is live** (fines up to €100k in DE) — best-in-class 2026 = `@axe-core/playwright` as a CI gate (we have this) + a keyboard-only drag-reorder regression test (add in Phase 5).
- Non-events: WCAG 3.0 (years out), React `<ViewTransition>`/`<Activity>` (not stable enough).

**Watch items:** legacy dnd-kit React-19 statement unofficial; AI SDK v7 is 9 days GA — pin exact, update deliberately.
