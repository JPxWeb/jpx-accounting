# Visual baselines: generation, review, re-baselining

`tests/e2e/visual-regression.spec.ts` keeps 20 themed full-page screenshots
(5 screens x light/dark x desktop-chromium/mobile-chromium) as the visual
regression net. This doc is the single workflow reference for creating and
updating those baselines.

## Where baselines live and why filenames end in `-win32` / `-linux`

`playwright.config.ts` sets an **explicit** `snapshotPathTemplate`:

```
{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}{-projectName}{-snapshotSuffix}{ext}
```

This is byte-for-byte Playwright's default screenshot template — made explicit
so the contract is visible. `{-snapshotSuffix}` defaults to `process.platform`,
so baselines land in `tests/e2e/visual-regression.spec.ts-snapshots/` as:

```
<screen>-<theme>-<project>-<platform>.png
e.g. today-dark-desktop-chromium-win32.png
     today-dark-desktop-chromium-linux.png
```

Baselines are **per-platform** because font rasterization and scrollbar
metrics differ across OSes. A run only ever compares against its own
platform's files:

- `-win32` baselines — captured on Windows dev machines, compared by local runs.
- `-linux` baselines — captured inside the pinned Playwright Docker image,
  compared by the ubuntu CI E2E job.

Both sets are committed. **Never delete one platform's set to "fix" the
other** — a platform with no baselines fails all 20 comparisons with
"snapshot doesn't exist", which is exactly the vacuous-red CI state this
workflow exists to prevent.

## Golden rule (CONVENTIONS.md rule 27)

Re-baseline **only after reviewing every diff image**. A diff localized to a
date/timestamp/hash region means a missing `data-visual-mask` attribute, not a
legitimate visual change — fix the mask, never re-baseline over it.

## Windows baselines (local dev)

```powershell
corepack pnpm test:e2e:visual          # compare (build:e2e runs first)
corepack pnpm test:e2e:visual:update   # re-baseline after reviewing every diff
```

Diff images for failures land under `test-results/`; the HTML report
(`npx playwright show-report`) shows expected/actual/diff side by side.

## Linux baselines (Docker, required for CI honesty)

CI runs on ubuntu, so it compares `-linux` baselines. Generate them inside the
**pinned** Playwright image whose version exactly matches the repo's
`@playwright/test` (see `devDependencies` in `package.json`) — a version or
distro drift changes the bundled Chromium and the rendering.

From the repo root on any Docker-capable host:

```bash
# 0. Version — keep in lockstep with @playwright/test in package.json
IMG=mcr.microsoft.com/playwright:v1.58.2-jammy

# 1. Snapshot the working tree (tracked + untracked, no node_modules/.git)
git ls-files -co --exclude-standard -z > /tmp/filelist.z
tar --null -T /tmp/filelist.z --ignore-failed-read -czf /tmp/tree.tar.gz

# 2. Container with its own Linux filesystem (never mount Windows node_modules)
docker run -d --name jpx-visual --init --ipc=host $IMG sleep infinity
docker cp /tmp/tree.tar.gz jpx-visual:/tmp/tree.tar.gz
docker exec jpx-visual bash -c 'mkdir -p /work && tar -xzf /tmp/tree.tar.gz -C /work'

# 3. Install + build inside the container (its own pnpm store).
#    HUSKY=0: the tree snapshot has no .git, husky's prepare would fail.
#    (cd inside bash -c, not `docker exec -w /work`: Git Bash on Windows
#    path-mangles `-w /work` into a host path and the exec fails.)
docker exec -e HUSKY=0 -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 jpx-visual \
  bash -c 'cd /work && corepack enable && corepack pnpm install --frozen-lockfile && corepack pnpm build:e2e'

# 4. Generate linux baselines (both projects; servers run inside the container)
docker exec jpx-visual \
  bash -c 'cd /work && npx playwright test tests/e2e/visual-regression.spec.ts --update-snapshots'

# 5. VERIFY: re-run WITHOUT --update-snapshots — must be 20/20 green
docker exec jpx-visual \
  bash -c 'cd /work && npx playwright test tests/e2e/visual-regression.spec.ts'

# 6. Copy the -linux.png files back into the repo
docker cp jpx-visual:/work/tests/e2e/visual-regression.spec.ts-snapshots /tmp/snaps
cp /tmp/snaps/*-linux.png tests/e2e/visual-regression.spec.ts-snapshots/

# 7. Cleanup
docker rm -f jpx-visual
```

Node inside the image: the v1.58.2 image ships Node 24 (v24.13.0 verified),
which satisfies the repo's `engines` (>=24). When bumping the image tag,
re-check `node --version` in the container; if a future image ships an older
Node, install 24+ first
(`curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt-get install -y nodejs`)
before step 3.

If the snapshotted tree's `pnpm-lock.yaml` is momentarily out of sync with
`package.json` (mid-flight branch state), step 3's `--frozen-lockfile` fails
with `ERR_PNPM_OUTDATED_LOCKFILE`; prefer fixing the lockfile, but inside the
throwaway container `--no-frozen-lockfile` is an acceptable fallback — it
never touches the host tree.

### Review before committing

1. Open a sample of the new/changed PNGs — they must look like real app
   screens (shell chrome, nav, content), not error pages or blank frames.
2. For an update (not first generation), review **every** diff image from the
   failing run you are re-baselining, per the golden rule above.
3. Commit the `-linux.png` files together with the UI change that motivated
   them, so reviewers see code + pixels in one diff.

### Known limitation: statutory-calendar drift (2026-07 state)

Masks keep server-derived dates (journal rows, activity, hashes) stable, but
two dashboard/report surfaces are **client-computed from the browser clock**
(`localTodayIso()` in `apps/web/components/dashboard/use-dashboard-data.ts`)
and are NOT fully masked today:

- the observations widget ("Statutory deadline on `<date>` — N days left"),
- the tax-deadlines widget and the reports statutory tax timeline (which rows
  appear rolls forward as deadlines pass), plus the reports period label.

Small day-to-day text drift stays under the 2% `maxDiffPixelRatio`, but when
a count changes wrap length or a deadline rolls off, the `today`/`reports`
screens reflow and those baselines fail **on both platforms** — that is
calendar movement, not a regression. This is exactly rule 27 debt: the real
fix is `data-visual-mask` + reflow-stable rendering for those regions in
`apps/web` (freezing the browser clock in the spec does not work — the report
pack is fetched by current-month token and the API's demo seed uses real
"now", so a frozen client would query an empty month). Until that lands,
expect to re-baseline `today`/`reports` when the statutory calendar rolls,
reviewing diffs as always.

### When CI goes red on visuals

- Diff looks like your intended UI change → regenerate linux baselines with
  the flow above, review, commit.
- Diff is date/hash-shaped → add the missing `data-visual-mask` (rule 27).
- Only `today`/`reports` fail and the diff shows deadline text/rows moved →
  statutory-calendar drift (see the known limitation above); re-baseline both
  platforms after review, and prefer landing the mask fix.
- "snapshot doesn't exist" → someone added a screen/theme/project without
  generating both platforms' baselines; run both the Windows and the Docker
  flow.
- Whole-page tiny noise on many screens after a dependency bump → check that
  the Docker image tag still matches `@playwright/test` and regenerate.
