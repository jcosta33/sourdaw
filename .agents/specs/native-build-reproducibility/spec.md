---
type: spec
id: SPEC-native-build-reproducibility
title: Native build reproducibility
status: draft
owner: The Sourdaw team
sources:
    - ../../../Cargo.toml
    - ../../../.cargo/config.toml
    - ../../../rust-toolchain.toml
    - ../../../src-tauri/.cargo/config.toml
    - ../../../package.json
---

# Native build reproducibility

## Intent

Keep native Rust checks, tests, formatting, and release builds reproducible from
the repository root by making the toolchain and workspace-owned build settings
explicit.

## Requirements

### AC-001 - The repository pins its native toolchain

The repository MUST declare an exact Rust toolchain in a root-owned
`rust-toolchain.toml`, including the components required by repository checks
(`rustfmt` and `clippy`), so root `cargo` commands do not depend on ambient
developer toolchain selection.

Verify with: `test -f rust-toolchain.toml && rg -n 'channel|components' rust-toolchain.toml && rustup show active-toolchain`

### AC-002 - Workspace release profiles have one owner

The workspace root MUST be the only Cargo manifest that defines release profile
settings; member manifests contain no competing profile tables.

Verify with: `test "$(rg -l '^\[profile\.' Cargo.toml crates src-tauri --glob 'Cargo.toml')" = 'Cargo.toml'`

### AC-003 - Shared Rust flags have one owner

The workspace-root Cargo config MUST be the only Cargo config that declares
shared Rust flags; nested config contains no competing flags.

Verify with: `test "$(rg -l '^rustflags' .cargo src-tauri/.cargo)" = '.cargo/config.toml'`
