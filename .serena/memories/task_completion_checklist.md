# Task Completion Checklist

When a coding task is completed, run the following:

1. `pnpm typecheck` — Ensure no TypeScript errors across all packages
2. `pnpm build` — Verify the build succeeds
3. `pnpm test:unit` — Run unit tests
4. If UI changes: `pnpm test:e2e` — Run E2E tests (requires build first)

## Quick check (combines typecheck + build)

- `pnpm check`

## Notes

- E2E tests run against built output (`next start`), so always build first
- E2E uses demo mode with test reset enabled on port 3201 (API) and 3200 (web)
- Do not commit `.env` or credential files
