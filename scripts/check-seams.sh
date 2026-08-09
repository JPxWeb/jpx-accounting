#!/usr/bin/env bash
# Architectural seam grep gates (read-only).
# Exit non-zero on first violation. Run from repo root: bash scripts/check-seams.sh
# Requires ripgrep (`rg`). Fail closed if rg is missing â€” a silent no-op would
# green-wash Windows/local runs without the tool.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v rg >/dev/null 2>&1; then
  echo "SEAM CHECK FAILED: ripgrep (rg) is required but not on PATH" >&2
  exit 1
fi

fail() {
  echo "SEAM VIOLATION: $1" >&2
  exit 1
}

# Normalize path separators so Windows `apps\web\...` still matches allowlists.
normalize_paths() {
  sed 's|\\|/|g'
}

violations_or_empty() {
  # $1 = rg pattern; remaining args = path allowlist regexes (grep -v style).
  local pattern="$1"
  shift
  local hits
  hits="$(rg -l "$pattern" --glob '*.ts' --glob '*.tsx' apps packages services tests 2>/dev/null | normalize_paths || true)"
  if [[ -z "$hits" ]]; then
    return 0
  fi
  local filtered="$hits"
  local allow
  for allow in "$@"; do
    filtered="$(printf '%s\n' "$filtered" | grep -Ev "$allow" || true)"
  done
  if [[ -n "$(printf '%s' "$filtered" | tr -d '[:space:]')" ]]; then
    printf '%s\n' "$filtered"
    return 1
  fi
  return 0
}

if ! dnd_hits="$(violations_or_empty '@dnd-kit' '^apps/web/components/dashboard/sortable-grid\.tsx$')"; then
  printf '%s\n' "$dnd_hits"
  fail '@dnd-kit imports must live only in apps/web/components/dashboard/sortable-grid.tsx'
fi

if ! ai_hits="$(violations_or_empty "from ['\"]ai['\"]|from ['\"]@ai-sdk" \
  '^apps/web/components/advisor/' \
  '^services/api/src/advisor/')"; then
  printf '%s\n' "$ai_hits"
  fail 'ai / @ai-sdk imports must live only under components/advisor/ and services/api/src/advisor/'
fi

if ! chart_hits="$(violations_or_empty "from ['\"]recharts" '^apps/web/components/reports/charts/')"; then
  printf '%s\n' "$chart_hits"
  fail 'recharts imports must live only under apps/web/components/reports/charts/'
fi

# "use client" modules must not pull MemoryLedgerStore or the heavy domain/store
# subpath (helpers belong on @jpx-accounting/domain/store-shared or the light barrel).
client_store_hits="$(
  rg -l '"use client"' --glob '*.ts' --glob '*.tsx' apps/web 2>/dev/null | normalize_paths || true
)"
if [[ -n "$client_store_hits" ]]; then
  filtered_client_store=""
  while IFS= read -r client_file; do
    [[ -z "$client_file" ]] && continue
    # Ignore // comments that merely mention MemoryLedgerStore.
    if rg -q "from ['\"]@jpx-accounting/domain/store['\"]" "$client_file" 2>/dev/null \
      || rg -n "MemoryLedgerStore" "$client_file" 2>/dev/null | grep -Ev '^[0-9]+:[[:space:]]*//' | grep -q .; then
      filtered_client_store+="${client_file}"$'\n'
    fi
  done <<< "$client_store_hits"
  if [[ -n "$(printf '%s' "$filtered_client_store" | tr -d '[:space:]')" ]]; then
    printf '%s' "$filtered_client_store"
    fail '"use client" files must not import MemoryLedgerStore or @jpx-accounting/domain/store'
  fi
fi

echo "check-seams: all grep gates passed"
