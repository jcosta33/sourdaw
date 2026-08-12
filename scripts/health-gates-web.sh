#!/bin/sh
set -eu

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd "$script_dir/.." && pwd)
cd "$repo_root"

run_lint_with_heartbeat() {
    pnpm lint --quiet &
    lint_pid=$!

    (
        sleep_pid=
        trap 'set +e; kill "$sleep_pid" 2>/dev/null; exit 0' TERM
        while kill -0 "$lint_pid" 2>/dev/null; do
            printf '%s\n' 'lint still running...'
            sleep "${LINT_HEARTBEAT_SECONDS:-60}" &
            sleep_pid=$!
            wait "$sleep_pid" 2>/dev/null
        done
    ) &
    heartbeat_pid=$!

    set +e
    wait "$lint_pid"
    lint_status=$?
    set -e

    set +e
    kill "$heartbeat_pid" 2>/dev/null
    wait "$heartbeat_pid" 2>/dev/null
    set -e

    return "$lint_status"
}

pnpm wasm:verify
pnpm deps:validate
pnpm typecheck
pnpm typecheck:test
pnpm typecheck:scripts
run_lint_with_heartbeat
pnpm test:command-schema
pnpm test:collection-scope
pnpm test:barrel-mocks
pnpm test:run --reporter=dot --silent=passed-only
pnpm build
