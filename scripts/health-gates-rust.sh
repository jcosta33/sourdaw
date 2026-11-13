#!/bin/sh
set -eu

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
repo_root=$(CDPATH= cd "$script_dir/.." && pwd)
cd "$repo_root"

# Checked before any build command runs, so a missing toolchain fails in
# seconds rather than after the gate has already started compiling.
if ! command -v cargo >/dev/null 2>&1; then
    printf '%s\n' \
        'error: cargo is not on PATH — the Rust workspace gate cannot run' \
        'run: rustup show (installs the toolchain pinned in rust-toolchain.toml)' >&2
    exit 1
fi

# Rust workspace gate.
#
# Scope: `--workspace --exclude sourdaw-native` — the library crates under
# `crates/`. `sourdaw-native` is covered by separate platform-specific native
# jobs; its `whisper-rs` Metal feature is scoped to macOS.
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
# What fails this run is decided by the `[workspace.lints]` tables in the root
# `Cargo.toml`, which every crate opts into: a lint at `deny` there is an error
# here, and a lint at `warn` is pending cleanup that reports without failing.
# `-D warnings` is not set, so that table stays the single source of the
# policy. `sourdaw-native` is excluded from this leg and linted by the
# `native-macos` job in `validation.yml` under the same table.
#
# `cargo fmt --check` runs first because it is the cheapest of the three and
# needs no build at all. It was held back until the tree-wide reformat landed
# separately in #1098 (96 files) — a reformat buried inside a CI-config change
# would not have been a reviewable diff. It covers the whole workspace,
# `sourdaw-native` included, even though the two build legs exclude it:
# formatting needs no platform-specific build features.
cargo fmt --all --check
cargo clippy --workspace --exclude sourdaw-native --all-targets --all-features
cargo test --workspace --exclude sourdaw-native --all-features
