#!/bin/sh
set -eu

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd "$script_dir/.." && pwd)
cd "$repo_root"

# Checked before any build runs, so missing server dependencies fail in
# seconds rather than after the collaboration server build has completed.
if ! npm --prefix server ls --depth=0 --silent --include=dev >/dev/null 2>&1; then
    printf '%s\n' \
        'error: collaboration server dependencies are not installed' \
        'run: npm --prefix server ci --include=dev' >&2
    exit 1
fi

# The collaboration server gate: the node:test suite under `server/` plus the
# production build it ships. The Rust workspace gate lives beside it in
# `scripts/health-gates-rust.sh`, and `pnpm health:server:full` runs both —
# which is what the pull-request validation lane consumes.
(
    cd server
    npm test
    npm run build
)
