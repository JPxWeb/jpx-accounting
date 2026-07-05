# Agent-harness adoption — plan, discrepancies, decisions

Source: [`ci-johan/agent-harness`](https://github.com/ci-johan/agent-harness) (a portable, manifest-driven
Claude Code harness extracted from CultureDNA). This doc records how it maps onto jpx-accounting, what
was adopted, the discrepancies found, and the open decisions. Produced by a multi-agent analysis
(6 deep-readers → synthesis → 4 adversarial verifiers, each checking claims against the real files).

**The `npx agent-harness init` wizard is not implemented** (no `bootstrap/` in the harness) — incorporation
is manual and staged.

## Corrected dependency order

The harness's own framing (manifest seam first) is **wrong for jpx**: `gen-agent-rules` rejects an empty
`claude_extensions` inventory and lint-checks that agents/skills/hooks match what's on disk. So the manifest
can only _describe_ an inventory that already exists. Real order:

**enforcement plane (hooks/settings) → deterministic ESLint seams + reviewer agents → skills/rules → manifest seam + gate (last) → wiki: SKIP → tracker: SKIP**

## Increments

| PR    | Scope                                                                                                                                                                                                                                | Status               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| **1** | **Deterministic seam gates** (ESLint `no-restricted-imports` for @dnd-kit / ai·@ai-sdk / recharts) + **i18n en↔sv parity** check wired into `pnpm check`                                                                             | **LANDED** (this PR) |
| 2     | Enforcement-plane hooks (guard-destructive via `node`; block-secrets + format-and-lint via pinned Git Bash; harness.config.sh; Edit-plane migration guard; settings.json surgical merge) — **needs the shell-pinning fix below**     | planned              |
| 3     | Reviewer agents (`frontend`, `security`, bespoke `ledger`, bespoke `advisor`) + skills (`doc-propagation`, `adr-write` + ADR scaffold) + `plan-writing` rule (@-referenced from CLAUDE.md)                                           | planned              |
| 4     | Manifest seam: `gen-agent-rules.mjs` + `.agents/rules-manifest.yaml` + GEN regions in CLAUDE.md/copilot + `check:agent-rules` gate + `review.mjs` (warn-only) + deterministic doc-checkers                                           | planned              |
| —     | **SKIP:** dotnet module, wiki subsystem, tracker subsystem, `AGENTS.template.md`/`CLAUDE.template.md` wholesale, `validate-skills.mjs`, `tdd-discipline.md`, `worktree-setup` (all redundant with superpowers/husky or inapplicable) | —                    |

## Increment 1 — what landed

- `eslint.config.mjs`: four ordered `no-restricted-imports` blocks converting the manual grep gates in
  `AGENTS.md` into CI-enforced rules. Zero pre-existing violations (verified); deliberate violations fail
  lint (verified); the sortable-grid/advisor exemptions are expressed as ordered overrides because ESLint
  applies only the _last_ matching `no-restricted-imports` per file.
- `scripts/check-i18n-parity.mjs` + `check:i18n` in the `check` chain: enforces the en↔sv key-parity
  invariant `AGENTS.md` declares but nothing enforced (next-intl fails at runtime on a missing key). Pure
  Node — runs without pnpm on the off-PATH dev box.

## Discrepancy register (verified against the real files)

1. **Manifest ↔ inventory hard coupling** — the manifest cannot land before the hooks/reviewers exist. _Resolution:_ sequence inverted (above); manifest is last.
2. **`Co-Authored-By` trailer** — the harness `AGENTS.template.md` **forbids** attribution trailers; jpx's convention **requires** `Co-Authored-By: Claude …`. _Resolution:_ **jpx wins.** Moot for the generator (AGENTS.md is never a generated target). Do not adopt `AGENTS.template.md`. → **Decision A.**
3. **`settings.json` posture** — harness template is allow-all `Bash(*)`/`Read(*)` + `enableAllProjectMcpServers`. _Resolution:_ jpx's enumerated allow-list + rich deny-list **win**; adopt only the additive hook wiring + 3 scoped Read-denies. `bypassPermissions` is already jpx's mode — the guard hook makes it _safer_, not looser.
4. **Stop-hook vs husky/lint-staged** — complementary, not conflicting (Stop hook = prettier on the working tree per turn; lint-staged = prettier+eslint at commit; prettier is idempotent).
5. **Windows / off-PATH pnpm** — hooks must invoke `node`/`npx`/pinned-`bash`, never pnpm. See the HIGH item below.
6. **Generator vs hand-written AGENTS.md** — non-issue: the generator only edits content _between_ `GEN:agent-rules` markers and never targets AGENTS.md. A human must seed the marker pair before `--write` (it can't bootstrap a marker-less file).
7. **superpowers overlap** — `plan-writing`'s no-checkbox rule and `tdd-discipline`'s relaxed-RED **contradict** the superpowers skills jpx runs. _Resolution:_ superpowers wins; skip `tdd-discipline`; keep checkboxes. → **Decision C.**
8. **Rules auto-load** — `.claude/rules/*.md` is not auto-loaded by stock Claude Code; @-reference from CLAUDE.md instead.

### Corrections the adversarial pass caught (fold into PR-2/PR-4)

- **HIGH — the hook shell.** Bare `bash` on this box resolves via the Windows PATH to **WSL Ubuntu**, not
  Git Bash; WSL can't see `C:\…` (it's `/mnt/c/…`) or Windows `node`, so every `.sh` hook would exit 127
  and — because a PreToolUse hook that errors is treated as non-blocking — the guard would be **silently
  absent while appearing installed** (worse than not adopting it). _Fix:_ invoke `guard-destructive.mjs`
  directly via `node` (shell-independent); for `.sh` hooks pin the absolute Git Bash path
  `"C:\Program Files\Git\bin\bash.exe"`; add a canary hook to confirm the runner's shell before trusting PR-2.
- **`harness.config.sh` formatter keys must be `*.ts=…`, not `ts=…`** — the hook matches repo-relative paths
  with a bash `case` glob; bare `ts=` matches nothing (silent no-op). Keep `export` on every var or the
  env-passed `HARNESS_GUARD_EXTRA` (the migration guard) is inert.
- **`.env.example` over-block** — the secret guards block `.env.example`, which CLAUDE.md tells agents to
  read. Scope the Read-deny to `**/.env` + `**/.env.local` (not `**/.env.*`); document the Bash/Edit-plane
  over-block as an accepted trade-off.
- **Edit-plane migration guard** — the bash-plane guard misses the likely mutation path (Edit tool
  overwriting an existing `infra/supabase/migrations/000N_*.sql`). Adapt the dotnet module's
  `block-migration-edits.sh` (Edit-matcher) to `infra/supabase/migrations/*.sql`.
- **`review.mjs` dual parser** — its manifest reader is stricter than `gen-agent-rules.mjs`'s
  (`  scope:` / 4-space `    - "glob"`, double-quoted). The manifest must satisfy both or `review.mjs`
  silently selects zero reviewers (false CLEAN).
- **Deterministic doc-checkers** (`check-doc-anchors.mjs`, `check-doc-crosslinks.mjs`) were dropped by the
  initial plan — they're CI-safe (no `claude` binary) and worth adopting-with-retarget in PR-4.
- **Enforcement honesty** — after PR-1, exactly one invariant class (seam imports) + i18n parity get
  deterministic CI enforcement. The ledger/review-gate/Article-50/data-visual-mask invariants rely on
  warn-only LLM reviewers (PR-3) that do **not** run in CI; `critical_rules` are doc-existence tripwires,
  not code guards.

## Open decisions (Johan)

- **A. Commit trailers** — keep jpx's `Co-Authored-By: Claude` trailer (recommended) vs adopt the harness's no-trailer rule.
- **B. Review push-gate** — keep `HARNESS_REVIEW_GATE=0` (recommended) until a reviewer stamp-writer exists.
- **C. Plan checkboxes** — keep superpowers' `- [ ]` tracking (recommended) vs the harness no-checkbox override.
- **D. Manifest gate strength** — `pnpm check` + pre-commit advisory (recommended) vs a blocking CI job; keep AGENTS.md hand-written, only CLAUDE.md/copilot get thin GEN regions.
- **E. Tracker** — stay trackerless via GitHub PRs + `docs/superpowers/plans/` (recommended) vs wire Linear.
