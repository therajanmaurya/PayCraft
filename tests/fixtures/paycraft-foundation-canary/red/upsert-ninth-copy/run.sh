#!/usr/bin/env bash
# AC-8 RED — a ninth full copy must be REFUSED by the shape lint.
#
# The fixture migration is copied into a THROWAWAY tree rather than into the repo's real
# migrations dir. Writing a file into supabase/migrations to test a lint means a crashed run
# leaves a bogus migration on disk that a later `supabase db reset` would try to apply.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MIG="$(cd "$HERE/../../../../.." && pwd)/supabase/migrations"
GREEN="$HERE/../../green/upsert-composable/run.sh"

TMP="$(mktemp -d -t ac8-red-XXXXXX)"; trap 'rm -rf "$TMP"' EXIT
cp "$MIG"/089_tenant_products_upsert_compose.sql "$TMP/" 2>/dev/null || true
cp "$HERE/fixture/091_ninth_copy.sql" "$TMP/091_ninth_copy.sql"

if out="$(bash "$GREEN" "$TMP" 2>&1)"; then
  echo "AC-8-RED FAIL — the ninth copy slipped through the shape lint" >&2
  printf '%s\n' "$out" >&2; exit 1
fi
printf '%s' "$out" | grep -q '091_ninth_copy.sql' \
  || { echo "AC-8-RED FAIL — refused, but did not identify the offending migration" >&2; printf '%s\n' "$out" >&2; exit 1; }
echo "AC-8-RED PASS — shape lint refused the ninth copy"
