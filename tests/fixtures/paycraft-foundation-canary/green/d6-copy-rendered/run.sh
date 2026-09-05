#!/usr/bin/env bash
# T8 / AC-9 affordance — the D6 guarantee is RENDERED beside the active toggle, not merely typed
# into the source. Migration 090 makes the promise true; this makes it visible where the decision
# to disable is actually taken.
set -uo pipefail
. "$(cd "$(dirname "$0")/../../lib" && pwd)/dashboard.sh"
require_dashboard || exit $?
RUNNER="$(find_web_debug_runner "$(cd "$(dirname "$0")" && pwd)")" \
  || { echo "SKIP — web-debug runner not found walking up from $(dirname "$0")" >&2; exit 2; }
exec bash "$RUNNER" run "$(cd "$(dirname "$0")" && pwd)/check.ts"
