# Suggested Commands

## Development

- `pnpm install` — Install all workspace dependencies
- `pnpm dev:web` — Start Next.js dev server
- `pnpm dev:api` — Start Hono API with tsx watch

## Quality

- `pnpm typecheck` — TypeScript check across all packages
- `pnpm build` — Build web + API
- `pnpm check` — Typecheck + build

## Testing

- `pnpm test:unit` — Unit tests: `tsx --test tests/unit/*.test.ts`
- `pnpm test:e2e` — Playwright E2E (builds first, starts both servers)
- `pnpm test:e2e:headed` — E2E with visible browser
- `pnpm test:e2e:install` — Install Chromium for Playwright
- `tsx --test tests/unit/some-file.test.ts` — Run a single unit test
- `pnpm build && npx playwright test tests/e2e/home.spec.ts` — Single E2E test

## System Utils (Windows/Git Bash)

- `git` — version control
- `ls`, `find`, `grep` — file/content search
- `gh` — GitHub CLI (authenticated as JPx-nu)
