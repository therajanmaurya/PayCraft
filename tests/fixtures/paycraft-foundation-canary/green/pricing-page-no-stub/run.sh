#!/usr/bin/env bash
# AC-30 — the RENDERED pricing page shows the real product; the stub literals are gone.
#
# Driven through a real browser, not curl: the page is a client component that fetches in
# useEffect, so server HTML only ever contains the loading frame and a curl-based check would
# pass on a page that renders nothing at all.
set -uo pipefail
. "$(cd "$(dirname "$0")/../../lib" && pwd)/dashboard.sh"
require_dashboard || exit $?
RUNNER="$(find_web_debug_runner "$(cd "$(dirname "$0")" && pwd)")" \
  || { echo "SKIP — web-debug runner not found walking up from $(dirname "$0")" >&2; exit 2; }
exec bash "$RUNNER" run "$(cd "$(dirname "$0")" && pwd)/check.ts"
