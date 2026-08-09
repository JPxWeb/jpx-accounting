# Wave Share′ (S-fail) + E-1/E-2/E-4/E-5 — report

**Branch / worktree:** `feat/post-wave-c-share-e` @ `.worktrees/feat-post-wave-c-share-e`  
**Base:** `main` @ `3604ba5`  
**Skipped:** E-3 (per brief)  
**Decisions:** Q2 = S-fail; Q3 = draft Art. 50 internal  
**Not done:** commit, push, full `pnpm check`

## Delivered

### Share′ S-fail (P0-4)

- Pure policy helper `apps/web/lib/share-intake-policy.ts` — `normal` refuses file intake; demo forward/pending unchanged.
- `apps/web/app/share/route.ts` consumes the helper; sets `shared=1&pending=<n>&authRequired=1` (no API fetch).
- `capture-screen.tsx` shows `authRequiredBanner` (distinct from generic retry); `data-auth-required` on the banner.
- Unit: `tests/unit/share-route-auth.test.ts`.

### E-1 Art. 50(2) draft + thread metadata

- `docs/compliance/article-50-assessment.md` (internal draft; counsel-gated).
- Additive `aiTransparency` on `assistantThreads.v2` via `prependAssistantThread` / v1 migrate (no storage bump).
- Unit: `tests/unit/assistant-thread-storage.test.ts`.

### E-2 retrieval mode honesty

- `selectChatPassages` returns `{ passages, mode }`; normal stream emits `data-retrieval` `{ mode }`.
- Advisor chrome keyword-degrade banner (`advisor-keyword-degrade-banner`); demo does not emit degrade.
- Advisor unit tests updated + new retrieval-mode assertion.

### E-4 UnavailableState i18n + ratchet

- `UnavailableState` uses `common.unavailable.eyebrow`.
- Dashboard / review-queue hardcodes → `dashboard.unavailable` / `today.unavailable`.
- ESLint ratchet bans `Workspace unavailable` literal + JSXText `Unavailable`.

### E-5 review AI marker parity

- Review suggestion block: `data-testid="ai-generated-marker"` + `today.card.aiGeneratedMarker`.

### i18n

- `en.json` / `sv.json` parity: **932 keys** (`pnpm check:i18n` green).

## Verification (targeted)

```
npx tsx --test \
  tests/unit/share-route-auth.test.ts \
  tests/unit/assistant-thread-storage.test.ts \
  tests/unit/advisor-chat-route.test.ts
→ 28 pass / 0 fail

pnpm check:i18n → green
eslint on touched web files → green
```

Full `pnpm check` / E2E / push left to orchestrator.

## Files touched (high level)

- Share: `share/route.ts`, `share-intake-policy.ts`, `capture-screen.tsx`, share unit test
- Advisor/API: `services/api/src/advisor/chat.ts`, `advisor-chat.tsx`, `message-part.tsx`, `local-demo-transport.ts`
- Storage/docs: `assistant-thread-storage.ts`, `docs/compliance/article-50-assessment.md`
- UX/i18n: `unavailable-state.tsx`, dashboard/review-queue/review-card, `messages/{en,sv}.json`, `eslint.config.mjs`
- Tests: `advisor-chat-route.test.ts`, new share + thread storage units
