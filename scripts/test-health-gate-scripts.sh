#!/bin/sh
set -eu

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd "$script_dir/.." && pwd)
temp_root=$(mktemp -d "${TMPDIR:-/tmp}/sourdaw-health-gates.XXXXXX")
temp_root=$(CDPATH= cd "$temp_root" && pwd -P)
fake_bin="$temp_root/bin"

cleanup() {
    rm -rf "$temp_root"
}
trap cleanup 0
trap 'exit 1' 1 2 15

mkdir -p "$fake_bin" "$temp_root/scripts" "$temp_root/server"
cp "$repo_root/scripts/health-gates-web.sh" "$temp_root/scripts/health-gates-web.sh"
cp "$repo_root/scripts/health-gates-server.sh" "$temp_root/scripts/health-gates-server.sh"

printf '%s\n' \
    '#!/bin/sh' \
    'set -eu' \
    'printf "pnpm %s\n" "$*" >> "$COMMAND_LOG"' \
    'if [ "${1:-}" = "lint:full" ]; then' \
    '    exit "${FAKE_LINT_STATUS:-0}"' \
    'fi' \
    'if [ "${1:-}" = "test:collection-scope" ]; then' \
    '    exit "${FAKE_COLLECTION_SCOPE_STATUS:-0}"' \
    'fi' \
    'if [ "${1:-}" = "test:command-schema" ]; then' \
    '    exit "${FAKE_COMMAND_SCHEMA_STATUS:-0}"' \
    'fi' \
    'if [ "${1:-}" = "test:barrel-mocks" ]; then' \
    '    exit "${FAKE_BARREL_MOCKS_STATUS:-0}"' \
    'fi' \
    > "$fake_bin/pnpm"
printf '%s\n' \
    '#!/bin/sh' \
    'set -eu' \
    'printf "npm %s\n" "$*" >> "$COMMAND_LOG"' \
    'if [ "${FAKE_SERVER_DEPS:-ready}" = "missing" ] && [ "${3:-}" = "ls" ]; then' \
    '    exit 1' \
    'fi' \
    'if [ "${NODE_ENV:-}" = "production" ] && [ "${3:-}" = "ls" ]; then' \
    '    case " $* " in *" --include=dev "*) ;; *) exit 42 ;; esac' \
    'fi' \
    'if [ "${1:-}" = "test" ]; then' \
    '    exit "${FAKE_SERVER_TEST_STATUS:-0}"' \
    'fi' \
    > "$fake_bin/npm"
printf '%s\n' \
    '#!/bin/sh' \
    'set -eu' \
    'printf "cargo %s\n" "$*" >> "$COMMAND_LOG"' \
    'case "${1:-}" in' \
    '    clippy) exit "${FAKE_CARGO_CLIPPY_STATUS:-0}" ;;' \
    '    test) exit "${FAKE_CARGO_TEST_STATUS:-0}" ;;' \
    'esac' \
    > "$fake_bin/cargo"
chmod +x "$fake_bin/pnpm" "$fake_bin/npm" "$fake_bin/cargo"

# A PATH that has the fake npm but no cargo at all, used to prove the missing
# toolchain precondition. `sh` and `dirname` are the only external commands
# needed to reach the precondition, so they are the only ones linked in.
no_cargo_bin="$temp_root/bin-no-cargo"
mkdir -p "$no_cargo_bin"
cp "$fake_bin/npm" "$no_cargo_bin/npm"
ln -s "$(command -v sh)" "$no_cargo_bin/sh"
ln -s "$(command -v dirname)" "$no_cargo_bin/dirname"

set +e
PATH="$fake_bin:$PATH" \
    COMMAND_LOG="$temp_root/lint-failure.log" \
    FAKE_LINT_STATUS=37 \
    sh "$temp_root/scripts/health-gates-web.sh" >/dev/null 2>&1
lint_status=$?
set -e
test "$lint_status" -eq 37
printf '%s\n' \
    'pnpm wasm:verify' \
    'pnpm deps:validate' \
    'pnpm typecheck' \
    'pnpm typecheck:test' \
    'pnpm typecheck:scripts' \
    'pnpm typecheck:e2e' \
    'pnpm lint:full' \
    > "$temp_root/expected-lint-failure.log"
diff -u "$temp_root/expected-lint-failure.log" "$temp_root/lint-failure.log"

PATH="$fake_bin:$PATH" \
    COMMAND_LOG="$temp_root/web-success.log" \
    sh "$temp_root/scripts/health-gates-web.sh" >/dev/null
printf '%s\n' \
    'pnpm wasm:verify' \
    'pnpm deps:validate' \
    'pnpm typecheck' \
    'pnpm typecheck:test' \
    'pnpm typecheck:scripts' \
    'pnpm typecheck:e2e' \
    'pnpm lint:full' \
    'pnpm test:command-schema' \
    'pnpm test:collection-scope' \
    'pnpm test:barrel-mocks' \
    'pnpm test:full' \
    'pnpm build' \
    > "$temp_root/expected-web-success.log"
diff -u "$temp_root/expected-web-success.log" "$temp_root/web-success.log"

set +e
PATH="$fake_bin:$PATH" \
    COMMAND_LOG="$temp_root/command-schema-failure.log" \
    FAKE_COMMAND_SCHEMA_STATUS=1 \
    sh "$temp_root/scripts/health-gates-web.sh" >/dev/null 2>&1
command_schema_status=$?
set -e
test "$command_schema_status" -eq 1
printf '%s\n' \
    'pnpm wasm:verify' \
    'pnpm deps:validate' \
    'pnpm typecheck' \
    'pnpm typecheck:test' \
    'pnpm typecheck:scripts' \
    'pnpm typecheck:e2e' \
    'pnpm lint:full' \
    'pnpm test:command-schema' \
    > "$temp_root/expected-command-schema-failure.log"
diff -u "$temp_root/expected-command-schema-failure.log" "$temp_root/command-schema-failure.log"

# A drifting vitest collection scope must fail the gate with the check's own exit
# code, and must stop before the suite runs — running the suite over an unknown
# file set is the outcome the check exists to prevent.
set +e
PATH="$fake_bin:$PATH" \
    COMMAND_LOG="$temp_root/collection-scope-failure.log" \
    FAKE_COLLECTION_SCOPE_STATUS=1 \
    sh "$temp_root/scripts/health-gates-web.sh" >/dev/null 2>&1
collection_scope_status=$?
set -e
test "$collection_scope_status" -eq 1
printf '%s\n' \
    'pnpm wasm:verify' \
    'pnpm deps:validate' \
    'pnpm typecheck' \
    'pnpm typecheck:test' \
    'pnpm typecheck:scripts' \
    'pnpm typecheck:e2e' \
    'pnpm lint:full' \
    'pnpm test:command-schema' \
    'pnpm test:collection-scope' \
    > "$temp_root/expected-collection-scope-failure.log"
diff -u "$temp_root/expected-collection-scope-failure.log" "$temp_root/collection-scope-failure.log"

# A barrel-mock coverage failure must abort the same way. True today only because
# health-gates-web.sh runs under `set -eu`; asserted here so a later refactor that
# swallows a non-zero status cannot pass this file. Same shape as the check above.
set +e
PATH="$fake_bin:$PATH" \
    COMMAND_LOG="$temp_root/barrel-mocks-failure.log" \
    FAKE_BARREL_MOCKS_STATUS=1 \
    sh "$temp_root/scripts/health-gates-web.sh" >/dev/null 2>&1
barrel_mocks_status=$?
set -e
test "$barrel_mocks_status" -eq 1
printf '%s\n' \
    'pnpm wasm:verify' \
    'pnpm deps:validate' \
    'pnpm typecheck' \
    'pnpm typecheck:test' \
    'pnpm typecheck:scripts' \
    'pnpm typecheck:e2e' \
    'pnpm lint:full' \
    'pnpm test:command-schema' \
    'pnpm test:collection-scope' \
    'pnpm test:barrel-mocks' \
    > "$temp_root/expected-barrel-mocks-failure.log"
diff -u "$temp_root/expected-barrel-mocks-failure.log" "$temp_root/barrel-mocks-failure.log"
echo "barrel mock coverage failure stops before the suite: PASS"

set +e
server_output=$(PATH="$fake_bin:$PATH" \
    COMMAND_LOG="$temp_root/server-missing.log" \
    FAKE_SERVER_DEPS=missing \
    sh "$temp_root/scripts/health-gates-server.sh" 2>&1)
server_status=$?
set -e
test "$server_status" -eq 1
case "$server_output" in
    *'run: npm --prefix server ci'*) ;;
    *) exit 1 ;;
esac
printf '%s\n' 'npm --prefix server ls --depth=0 --silent --include=dev' > "$temp_root/expected-server-missing.log"
diff -u "$temp_root/expected-server-missing.log" "$temp_root/server-missing.log"

PATH="$fake_bin:$PATH" \
    COMMAND_LOG="$temp_root/server-success.log" \
    NODE_ENV=production \
    npm_config_omit=dev \
    sh "$temp_root/scripts/health-gates-server.sh" >/dev/null
printf '%s\n' \
    'npm --prefix server ls --depth=0 --silent --include=dev' \
    'npm test' \
    'npm run build' \
    'cargo fmt --all --check' \
    'cargo clippy --workspace --exclude sourdaw --all-targets --all-features' \
    'cargo test --workspace --exclude sourdaw --all-features' \
    > "$temp_root/expected-server-success.log"
diff -u "$temp_root/expected-server-success.log" "$temp_root/server-success.log"

set +e
PATH="$fake_bin:$PATH" \
    COMMAND_LOG="$temp_root/server-test-failure.log" \
    FAKE_SERVER_TEST_STATUS=23 \
    sh "$temp_root/scripts/health-gates-server.sh" >/dev/null 2>&1
server_test_status=$?
set -e
test "$server_test_status" -eq 23
printf '%s\n' \
    'npm --prefix server ls --depth=0 --silent --include=dev' \
    'npm test' \
    > "$temp_root/expected-server-test-failure.log"
diff -u "$temp_root/expected-server-test-failure.log" "$temp_root/server-test-failure.log"

# A missing Rust toolchain must be reported before any build runs, not
# discovered after the collaboration server has already been built.
set +e
no_cargo_output=$(PATH="$no_cargo_bin" \
    COMMAND_LOG="$temp_root/no-cargo.log" \
    sh "$temp_root/scripts/health-gates-server.sh" 2>&1)
no_cargo_status=$?
set -e
test "$no_cargo_status" -eq 1
case "$no_cargo_output" in
    *'error: cargo is not on PATH'*) ;;
    *) exit 1 ;;
esac
printf '%s\n' 'npm --prefix server ls --depth=0 --silent --include=dev' > "$temp_root/expected-no-cargo.log"
diff -u "$temp_root/expected-no-cargo.log" "$temp_root/no-cargo.log"

# A failing Rust workspace must fail the gate with cargo's own exit code, and
# must stop before the remaining legs run.
set +e
PATH="$fake_bin:$PATH" \
    COMMAND_LOG="$temp_root/cargo-clippy-failure.log" \
    FAKE_CARGO_CLIPPY_STATUS=101 \
    sh "$temp_root/scripts/health-gates-server.sh" >/dev/null 2>&1
cargo_clippy_status=$?
set -e
test "$cargo_clippy_status" -eq 101
printf '%s\n' \
    'npm --prefix server ls --depth=0 --silent --include=dev' \
    'npm test' \
    'npm run build' \
    'cargo fmt --all --check' \
    'cargo clippy --workspace --exclude sourdaw --all-targets --all-features' \
    > "$temp_root/expected-cargo-clippy-failure.log"
diff -u "$temp_root/expected-cargo-clippy-failure.log" "$temp_root/cargo-clippy-failure.log"

set +e
PATH="$fake_bin:$PATH" \
    COMMAND_LOG="$temp_root/cargo-test-failure.log" \
    FAKE_CARGO_TEST_STATUS=134 \
    sh "$temp_root/scripts/health-gates-server.sh" >/dev/null 2>&1
cargo_test_status=$?
set -e
test "$cargo_test_status" -eq 134

printf '%s\n' \
    "lint failure exit: $lint_status" \
    'lint failure stops the web gate: PASS' \
    "collection scope failure exit: $collection_scope_status" \
    'collection scope failure stops before the suite: PASS' \
    "missing server dependencies exit: $server_status" \
    'server remediation and production build dependency sequence: PASS' \
    "server test failure exit: $server_test_status" \
    "missing cargo exit: $no_cargo_status" \
    "cargo clippy failure exit: $cargo_clippy_status" \
    "cargo test failure exit (SIGABRT): $cargo_test_status" \
    'rust workspace gate failure propagation: PASS'
