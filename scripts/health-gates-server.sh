#!/bin/sh
set -eu

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd "$script_dir/.." && pwd)
cd "$repo_root"

# Preconditions are checked before any build runs, so a missing toolchain fails
# in seconds rather than after the collaboration server build has completed.
if ! npm --prefix server ls --depth=0 --silent --include=dev >/dev/null 2>&1; then
    printf '%s\n' \
        'error: collaboration server dependencies are not installed' \
        'run: npm --prefix server ci --include=dev' >&2
    exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
    printf '%s\n' \
        'error: cargo is not on PATH — the Rust workspace gate cannot run' \
        'run: rustup show (installs the toolchain pinned in rust-toolchain.toml)' >&2
    exit 1
fi

(
    cd server
    npm test
    npm run build
)

# Rust workspace gate.
#
# Scope: `--workspace --exclude sourdaw-native` — the library crates under
# `crates/`. `sourdaw-native` is excluded because it cannot build on the
# Linux runner this job uses: its manifest enables `whisper-rs`'s `metal`
# feature unconditionally. Gating it needs a macOS runner; that is left out
# deliberately rather than silently half-done.
#
# `--all-features` exists to compile daw-plugin-host's
# `engine-owned-command-fixture` feature, which is otherwise only reachable
# through sourdaw-native's dev-dependencies and would go ungated here.
#
# DEBUG ON PURPOSE — do not add `--release`. `assert_no_alloc`'s
# `disable_release` feature is on by default, so in a release build
# `assert_no_alloc(f)` is literally `f()`: every RT guard in
# `crates/daw-dsp/tests/device_process_rt.rs` and
# `crates/proof-chamber/tests/reverb_process_rt.rs` becomes a no-op and the run
# passes while proving nothing. A real violation calls `handle_alloc_error`,
# which aborts, so it surfaces as SIGABRT rather than as a test failure. See
# `crates/daw-dsp/CLAUDE.md`.
#
# clippy runs first, and with `--all-targets`, because it is the cheap
# check-only pass that catches a test or bench that stopped compiling —
# `benches/quantum.rs` was broken for an extended period with nothing to catch
# it (repaired in #1084).
#
# `-D warnings` is deliberately NOT set yet: the tree has 239 pre-existing
# clippy warning sites (188 daw-dsp, 17 scoring, 13 proof-chamber, 11
# daw-plugin-host, 9 daw-engine, 1 daw-core). Turning it on now would land a
# permanently red gate, and silencing them with `#[allow]` would be evasion.
# Add `-D warnings` once that cleanup lands on its own.
#
# `cargo fmt --check` runs first because it is the cheapest of the three and
# needs no build at all. It was held back until the tree-wide reformat landed
# separately in #1098 (96 files) — a reformat buried inside a CI-config change
# would not have been a reviewable diff. It covers the whole workspace,
# `sourdaw-native` included, even though the two build legs exclude it:
# formatting needs no toolchain features, and `sourdaw-native` cannot build on
# ubuntu-latest because its manifest unconditionally enables whisper-rs's
# `metal`.
cargo fmt --all --check
cargo clippy --workspace --exclude sourdaw-native --all-targets --all-features
cargo test --workspace --exclude sourdaw-native --all-features
