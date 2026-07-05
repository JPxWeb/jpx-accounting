#!/usr/bin/env bash
# Architectural seam grep gates (read-only). Not wired to CI yet — Phase 6.2.
# Exit non-zero on first violation. Run from repo root: bash scripts/check-seams.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail() {
  echo "SEAM VIOLATION: $1" >&2
  exit 1
}

# @dnd-kit — only sortable-grid.tsx
if rg -l '@dnd-kit' --glob '*.ts' --glob '*.tsx' apps packages services tests \
  | rg -v 'apps/web/components/dashboard/sortable-grid.tsx' >/dev/null 2>&1; then
  rg -l '@dnd-kit' --glob '*.ts' --glob '*.tsx' apps packages services tests \
    | rg -v 'apps/web/components/dashboard/sortable-grid.tsx' || true
  fail '@dnd-kit imports must live only in apps/web/components/dashboard/sortable-grid.tsx'
fi

# ai / @ai-sdk — only advisor dirs
if rg -l "from ['\"]ai['\"]|from ['\"]@ai-sdk" --glob '*.ts' --glob '*.tsx' apps services packages tests \
  | rg -v 'apps/web/components/advisor/' \
  | rg -v 'services/api/src/advisor/' >/dev/null 2>&1; then
  rg -l "from ['\"]ai['\"]|from ['\"]@ai-sdk" --glob '*.ts' --glob '*.tsx' apps services packages tests \
    | rg -v 'apps/web/components/advisor/' \
    | rg -v 'services/api/src/advisor/' || true
  fail 'ai / @ai-sdk imports must live only under components/advisor/ and services/api/src/advisor/'
fi

# recharts — only components/reports/charts/
if rg -l "from ['\"]recharts" --glob '*.ts' --glob '*.tsx' apps packages services tests \
  | rg -v 'apps/web/components/reports/charts/' >/dev/null 2>&1; then
  rg -l "from ['\"]recharts" --glob '*.ts' --glob '*.tsx' apps packages services tests \
    | rg -v 'apps/web/components/reports/charts/' || true
  fail 'recharts imports must live only under apps/web/components/reports/charts/'
fi

echo "check-seams: all grep gates passed"
